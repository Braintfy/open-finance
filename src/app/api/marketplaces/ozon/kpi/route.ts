// PURPOSE: KPI агрегаты Ozon (выручка/заказы/реклама/ДРР/AOV/CPO) за период
// + delta vs прошлый период + sparkline по дням. Tenant-scoped.
//
// Период — MSC YYYY-MM-DD (`fromDate` / `toDateExclusive`).
// Реклама — единый модуль `getOzonAdsTotals`.

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { ozonOrders, ozonAnalyticsDaily } from '@/lib/db/schema/marketplaces';
import { getOzonAdsTotals, type OzonAdsSource } from '@/lib/marketplaces/ozon/ads-totals';
import {
  getPreviousOzonQueryPeriod,
  parseOzonPeriodFromRequest,
  shiftOzonQueryPeriod,
  shiftOzonQueryPeriodMonths,
  type OzonQueryPeriod,
} from '@/lib/marketplaces/ozon/query-period';

export const runtime = 'nodejs';

export type CompareMode = 'previous' | 'week-ago' | 'month-ago';

export type OzonKpiResponse = {
  ok: true;
  current: {
    revenueRub: number;
    orders: number;
    adsRub: number;
    drrPct: number | null;
    aovRub: number | null;
    cpoRub: number | null;
  };
  previous: {
    revenueRub: number;
    orders: number;
    adsRub: number;
    drrPct: number | null;
    aovRub: number | null;
    cpoRub: number | null;
  };
  byDay: Array<{ date: string; revenueRub: number; orders: number; adsRub: number }>;
  adsSource: OzonAdsSource;
  ordersSource: 'analytics-api' | 'orders-fallback';
  compareMode: CompareMode;
  compareLabel: string;
  previousRange: { fromDate: string; toDateExclusive: string };
  period: OzonQueryPeriod;
  adsBreakdown: {
    expenseRub: number;
    cpcRub: number;
    cpoRub: number;
    moneyRub: number;
    bonusRub: number;
  };
  reconciliationGapPct: number | null;
};

type DayAgg = {
  date: string;
  revenue_rub: number;
  orders_count: number;
};

async function getOrdersForRange(args: {
  tenantId: string;
  accountId: string | null;
  fromDate: string;
  toDateExclusive: string;
}): Promise<{
  revenue: number;
  orders: number;
  byDay: DayAgg[];
  ordersSource: 'analytics-api' | 'orders-fallback';
}> {
  const { tenantId, accountId, fromDate, toDateExclusive } = args;
  const accountCondOrders = accountId ? sql`AND o.account_id = ${accountId}` : sql``;
  const accountCondAnalytics = accountId ? sql`AND ad.account_id = ${accountId}` : sql``;

  type CheckRow = { cnt: number };
  const analyticsCheck = await db.execute<CheckRow>(sql`
    SELECT COUNT(*)::int AS cnt FROM ${ozonAnalyticsDaily} ad
    WHERE ad.tenant_id = ${tenantId}
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

  type Row = { day: string; revenue_rub: number; orders_count: number };
  const ordersResult = await db.execute<Row>(
    hasAnalyticsData
      ? sql`
        SELECT
          to_char(ad.date, 'YYYY-MM-DD') AS day,
          COALESCE(SUM(ad.revenue_kopecks), 0)::numeric / 100 AS revenue_rub,
          COALESCE(SUM(ad.ordered_units), 0)::int AS orders_count
        FROM ${ozonAnalyticsDaily} ad
        WHERE ad.tenant_id = ${tenantId}
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
          WHERE o.tenant_id = ${tenantId}
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
          COALESCE(SUM(price_rub * qty), 0) AS revenue_rub,
          COUNT(DISTINCT id) AS orders_count
        FROM order_items
        GROUP BY day
        ORDER BY day
      `,
  );
  const ordersRows: Row[] = Array.isArray(ordersResult)
    ? (ordersResult as Row[])
    : (((ordersResult as unknown) as { rows: Row[] }).rows ?? []);

  const byDay = ordersRows.map((r) => ({
    date: r.day,
    revenue_rub: Number(r.revenue_rub),
    orders_count: Number(r.orders_count),
  }));
  const revenue = byDay.reduce((s, r) => s + r.revenue_rub, 0);
  const orders = byDay.reduce((s, r) => s + r.orders_count, 0);
  return { revenue, orders, byDay, ordersSource };
}

async function getAggregateForRange(args: {
  tenantId: string;
  accountId: string | null;
  fromDate: string;
  toDateExclusive: string;
}) {
  const [orders, ads] = await Promise.all([
    getOrdersForRange(args),
    getOzonAdsTotals(args),
  ]);

  const dayMap = new Map<
    string,
    { date: string; revenueRub: number; orders: number; adsRub: number }
  >();
  for (const r of orders.byDay) {
    dayMap.set(r.date, {
      date: r.date,
      revenueRub: r.revenue_rub,
      orders: r.orders_count,
      adsRub: 0,
    });
  }
  for (const r of ads.byDay) {
    const existing = dayMap.get(r.date);
    if (existing) existing.adsRub = r.adsRub;
    else
      dayMap.set(r.date, {
        date: r.date,
        revenueRub: 0,
        orders: 0,
        adsRub: r.adsRub,
      });
  }

  return {
    revenue: orders.revenue,
    orders: orders.orders,
    ads: ads.adsRub,
    byDay: Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date)),
    adsSource: ads.adsSource,
    ordersSource: orders.ordersSource,
    adsBreakdown: ads.breakdown,
    reconciliationGapPct: ads.reconciliationGapPct,
  };
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
    if (!period) {
      return NextResponse.json(
        { ok: false, error: 'fromDate/toDateExclusive required (YYYY-MM-DD MSC)' },
        { status: 400 },
      );
    }

    const compareModeParam = url.searchParams.get('compareMode');
    const compareMode: CompareMode =
      compareModeParam === 'week-ago'
        ? 'week-ago'
        : compareModeParam === 'month-ago'
          ? 'month-ago'
          : 'previous';
    const prevPeriod =
      compareMode === 'week-ago'
        ? shiftOzonQueryPeriod(period, -7)
        : compareMode === 'month-ago'
          ? shiftOzonQueryPeriodMonths(period, -1)
          : getPreviousOzonQueryPeriod(period);
    const compareLabel =
      compareMode === 'week-ago'
        ? 'Неделя назад'
        : compareMode === 'month-ago'
          ? 'Месяц назад'
          : 'Прошлый период';

    const [current, previous] = await Promise.all([
      getAggregateForRange({
        tenantId: session.tenantId,
        accountId,
        fromDate: period.fromDate,
        toDateExclusive: period.toDateExclusive,
      }),
      getAggregateForRange({
        tenantId: session.tenantId,
        accountId,
        fromDate: prevPeriod.fromDate,
        toDateExclusive: prevPeriod.toDateExclusive,
      }),
    ]);

    function deriveKpi(r: { revenue: number; orders: number; ads: number }) {
      const drrPct = r.revenue > 0 ? (r.ads / r.revenue) * 100 : null;
      const aovRub = r.orders > 0 ? r.revenue / r.orders : null;
      const cpoRub = r.orders > 0 ? r.ads / r.orders : null;
      return {
        revenueRub: r.revenue,
        orders: r.orders,
        adsRub: r.ads,
        drrPct,
        aovRub,
        cpoRub,
      };
    }

    const response: OzonKpiResponse = {
      ok: true,
      current: deriveKpi(current),
      previous: deriveKpi(previous),
      byDay: current.byDay,
      adsSource: current.adsSource,
      ordersSource: current.ordersSource,
      compareMode,
      compareLabel,
      previousRange: {
        fromDate: prevPeriod.fromDate,
        toDateExclusive: prevPeriod.toDateExclusive,
      },
      period,
      adsBreakdown: current.adsBreakdown,
      reconciliationGapPct: current.reconciliationGapPct,
    };

    return NextResponse.json(response);
  } catch (e) {
    console.error('[marketplaces] GET /ozon/kpi failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
