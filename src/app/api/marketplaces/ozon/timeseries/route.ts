// PURPOSE: Time-series Ozon (выручка/заказы/реклама/ДРР по дням или неделям/месяцам).
// Tenant-scoped. Период — MSC YYYY-MM-DD. Реклама — getOzonAdsTotals.

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { ozonOrders, ozonAnalyticsDaily } from '@/lib/db/schema/marketplaces';
import { getOzonAdsTotals, type OzonAdsSource } from '@/lib/marketplaces/ozon/ads-totals';
import {
  parseOzonPeriodFromRequest,
  type OzonQueryPeriod,
} from '@/lib/marketplaces/ozon/query-period';

export const runtime = 'nodejs';

export type Granularity = 'day' | 'week' | 'month';

export type OzonTimeseriesResponse = {
  ok: true;
  granularity: Granularity;
  points: Array<{
    date: string;
    revenueRub: number;
    orders: number;
    adsRub: number;
    drrPct: number | null;
    aovRub: number | null;
  }>;
  adsSource: OzonAdsSource;
  ordersSource: 'analytics-api' | 'orders-fallback';
  period: OzonQueryPeriod;
  reconciliationGapPct: number | null;
};

function parseGranularity(s: string | null): Granularity {
  if (s === 'week' || s === 'month') return s;
  return 'day';
}

function bucketKey(isoDate: string, gran: Granularity): string {
  const d = new Date(isoDate + 'T00:00:00Z');
  if (gran === 'day') return isoDate;
  if (gran === 'week') {
    const day = d.getUTCDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }
  return isoDate.slice(0, 7) + '-01';
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const accountId = url.searchParams.get('accountId');
    const period = parseOzonPeriodFromRequest(
      url.searchParams.get('fromDate'),
      url.searchParams.get('toDateExclusive'),
      url.searchParams.get('from'),
      url.searchParams.get('to'),
    );
    const gran = parseGranularity(url.searchParams.get('granularity'));
    if (!period) {
      return NextResponse.json(
        { ok: false, error: 'fromDate/toDateExclusive required (YYYY-MM-DD MSC)' },
        { status: 400 },
      );
    }
    const { fromDate, toDateExclusive } = period;

    const accountCondOrders = accountId ? sql`AND o.account_id = ${accountId}` : sql``;
    const accountCondAnalytics = accountId ? sql`AND ad.account_id = ${accountId}` : sql``;

    type CheckRow = { cnt: number };
    const analyticsCheck = await db.execute<CheckRow>(sql`
      SELECT COUNT(*)::int AS cnt FROM ${ozonAnalyticsDaily} ad
      WHERE ad.tenant_id = ${session.tenantId}
        ${accountCondAnalytics}
        AND ad.date >= ${fromDate}::date
        AND ad.date < ${toDateExclusive}::date
      LIMIT 1
    `);
    const analyticsCheckRows: CheckRow[] = Array.isArray(analyticsCheck)
      ? (analyticsCheck as CheckRow[])
      : (((analyticsCheck as unknown) as { rows: CheckRow[] }).rows ?? []);
    const hasAnalyticsData = (analyticsCheckRows[0]?.cnt ?? 0) > 0;
    const ordersSource: 'analytics-api' | 'orders-fallback' = hasAnalyticsData
      ? 'analytics-api'
      : 'orders-fallback';

    type Row = { day: string; revenue: number; orders: number };
    const ordersResult = await db.execute<Row>(
      hasAnalyticsData
        ? sql`
          SELECT
            to_char(ad.date, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(ad.revenue_kopecks), 0)::numeric / 100 AS revenue,
            COALESCE(SUM(ad.ordered_units), 0)::int AS orders
          FROM ${ozonAnalyticsDaily} ad
          WHERE ad.tenant_id = ${session.tenantId}
            ${accountCondAnalytics}
            AND ad.date >= ${fromDate}::date
            AND ad.date < ${toDateExclusive}::date
          GROUP BY ad.date
          ORDER BY ad.date
        `
        : sql`
          WITH order_items AS (
            SELECT
              o.id,
              date_trunc('day', o.order_created_at AT TIME ZONE 'UTC') AS day,
              COALESCE(NULLIF(it->>'price', '')::numeric, 0) AS price_rub,
              COALESCE(NULLIF(it->>'quantity', '')::numeric, 0) AS qty
            FROM ${ozonOrders} o
            CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
            WHERE o.tenant_id = ${session.tenantId}
              ${accountCondOrders}
              AND o.order_created_at >= ${fromDate}::timestamp
              AND o.order_created_at < ${toDateExclusive}::timestamp
              AND o.cancelled_at IS NULL
              AND o.returned_at IS NULL
              AND lower(o.status) NOT LIKE '%cancel%'
              AND lower(o.status) NOT LIKE '%return%'
          )
          SELECT
            to_char(day, 'YYYY-MM-DD') AS day,
            COALESCE(SUM(price_rub * qty), 0) AS revenue,
            COUNT(DISTINCT id) AS orders
          FROM order_items
          GROUP BY day
          ORDER BY day
        `,
    );
    const ordersRows: Row[] = Array.isArray(ordersResult)
      ? (ordersResult as Row[])
      : (((ordersResult as unknown) as { rows: Row[] }).rows ?? []);

    const ads = await getOzonAdsTotals({
      tenantId: session.tenantId,
      accountId,
      fromDate,
      toDateExclusive,
    });

    const buckets = new Map<
      string,
      { date: string; revenue: number; orders: number; ads: number }
    >();

    for (const r of ordersRows) {
      const key = bucketKey(r.day, gran);
      const existing = buckets.get(key) ?? {
        date: key,
        revenue: 0,
        orders: 0,
        ads: 0,
      };
      existing.revenue += Number(r.revenue);
      existing.orders += Number(r.orders);
      buckets.set(key, existing);
    }

    for (const r of ads.byDay) {
      const key = bucketKey(r.date, gran);
      const existing = buckets.get(key) ?? {
        date: key,
        revenue: 0,
        orders: 0,
        ads: 0,
      };
      existing.ads += r.adsRub;
      buckets.set(key, existing);
    }

    const points = Array.from(buckets.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((p) => ({
        date: p.date,
        revenueRub: p.revenue,
        orders: p.orders,
        adsRub: p.ads,
        drrPct: p.revenue > 0 ? (p.ads / p.revenue) * 100 : null,
        aovRub: p.orders > 0 ? p.revenue / p.orders : null,
      }));

    const response: OzonTimeseriesResponse = {
      ok: true,
      granularity: gran,
      points,
      adsSource: ads.adsSource,
      ordersSource,
      period,
      reconciliationGapPct: ads.reconciliationGapPct,
    };
    return NextResponse.json(response);
  } catch (e) {
    console.error('[marketplaces] GET /ozon/timeseries failed:', e);
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}
