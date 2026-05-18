// PURPOSE: KPI агрегаты Ozon (выручка/заказы/реклама/ДРР/AOV/CPO) за период
// + delta vs прошлый период + sparkline по дням. Tenant-scoped.
//
// Источники:
//   - ozon_orders (delivered) — выручка, заказы, AOV
//   - ozon_perf_sku_stats (если есть) — расход на рекламу + заказы по рекламе
//   - fallback на ozon_transactions с эвристикой LIKE '%promot%|advertis|marketing'

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  ozonOrders,
  ozonTransactions,
  ozonPerfSkuStats,
} from '@/lib/db/schema/marketplaces';

export const runtime = 'nodejs';

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
  /** День → revenue/orders/ads для sparkline. */
  byDay: Array<{ date: string; revenueRub: number; orders: number; adsRub: number }>;
  /** Источник рекламных данных (для бейджа "приблизительно"). */
  adsSource: 'performance' | 'transactions-heuristic' | 'none';
};

type DayAgg = {
  date: string;
  revenue_rub: number;
  orders_count: number;
  ads_kopecks: number;
};

async function getAggregateForRange(args: {
  tenantId: string;
  accountId: string | null;
  from: Date;
  to: Date;
}): Promise<{ revenue: number; orders: number; ads: number; byDay: DayAgg[]; adsSource: 'performance' | 'transactions-heuristic' | 'none' }> {
  const { tenantId, accountId, from, to } = args;
  // postgres.js не сериализует Date в raw sql-template'ах — передаём ISO-строки.
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  const accountCondOrders = accountId
    ? sql`AND o.account_id = ${accountId}`
    : sql``;
  const accountCondPerf = accountId
    ? sql`AND ps.account_id = ${accountId}`
    : sql``;
  const accountCondTx = accountId ? sql`AND tx.account_id = ${accountId}` : sql``;

  type Row = {
    day: string;
    revenue_rub: number;
    orders_count: number;
  };
  const ordersResult = await db.execute<Row>(sql`
    WITH order_items AS (
      SELECT
        o.id,
        o.status,
        date_trunc('day', o.order_created_at AT TIME ZONE 'UTC') AS day,
        (it->>'offerId')::text AS offer_id,
        COALESCE(NULLIF(it->>'price', '')::numeric, 0) AS price_rub,
        COALESCE(NULLIF(it->>'quantity', '')::numeric, 0) AS qty
      FROM ${ozonOrders} o
      CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
      WHERE o.tenant_id = ${tenantId}
        ${accountCondOrders}
        AND o.order_created_at >= ${fromIso}::timestamp
        AND o.order_created_at < ${toIso}::timestamp
        AND o.status = 'delivered'
    )
    SELECT
      to_char(day, 'YYYY-MM-DD') AS day,
      COALESCE(SUM(price_rub * qty), 0) AS revenue_rub,
      COUNT(DISTINCT id) AS orders_count
    FROM order_items
    GROUP BY day
    ORDER BY day
  `);
  const ordersRows: Row[] = Array.isArray(ordersResult)
    ? (ordersResult as Row[])
    : (((ordersResult as unknown) as { rows: Row[] }).rows ?? []);

  // Реклама из ozon_perf_sku_stats (если есть данные за период).
  type AdsRow = { day: string; ads_kopecks: number };
  const perfResult = await db.execute<AdsRow>(sql`
    SELECT
      to_char(ps.date, 'YYYY-MM-DD') AS day,
      COALESCE(SUM(ps.expense_kopecks), 0) AS ads_kopecks
    FROM ${ozonPerfSkuStats} ps
    WHERE ps.tenant_id = ${tenantId}
      ${accountCondPerf}
      AND ps.date >= ${fromIso}::date
      AND ps.date < ${toIso}::date
    GROUP BY ps.date
    ORDER BY ps.date
  `);
  const perfRows: AdsRow[] = Array.isArray(perfResult)
    ? (perfResult as AdsRow[])
    : (((perfResult as unknown) as { rows: AdsRow[] }).rows ?? []);

  let adsSource: 'performance' | 'transactions-heuristic' | 'none' = 'none';
  let adsByDay = new Map<string, number>();
  if (perfRows.length > 0) {
    adsSource = 'performance';
    for (const r of perfRows) adsByDay.set(r.day, Number(r.ads_kopecks) / 100);
  } else {
    // Fallback: эвристика по транзакциям.
    const txResult = await db.execute<AdsRow>(sql`
      SELECT
        to_char(date_trunc('day', tx.operation_date AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
        COALESCE(SUM(ABS(tx.amount_kopecks)), 0) AS ads_kopecks
      FROM ${ozonTransactions} tx
      WHERE tx.tenant_id = ${tenantId}
        ${accountCondTx}
        AND tx.operation_date >= ${fromIso}::timestamp
        AND tx.operation_date < ${toIso}::timestamp
        AND (
          lower(tx.operation_type) LIKE '%promot%'
          OR lower(tx.operation_type) LIKE '%advertis%'
          OR lower(tx.operation_type) LIKE '%marketing%'
        )
      GROUP BY 1
      ORDER BY 1
    `);
    const txRows: AdsRow[] = Array.isArray(txResult)
      ? (txResult as AdsRow[])
      : (((txResult as unknown) as { rows: AdsRow[] }).rows ?? []);
    if (txRows.length > 0) adsSource = 'transactions-heuristic';
    adsByDay = new Map(txRows.map((r) => [r.day, Number(r.ads_kopecks) / 100]));
  }

  // Merge by day.
  const dayMap = new Map<string, DayAgg>();
  for (const r of ordersRows) {
    dayMap.set(r.day, {
      date: r.day,
      revenue_rub: Number(r.revenue_rub),
      orders_count: Number(r.orders_count),
      ads_kopecks: 0,
    });
  }
  for (const [day, adsRub] of adsByDay) {
    const existing = dayMap.get(day);
    if (existing) {
      existing.ads_kopecks = adsRub * 100;
    } else {
      dayMap.set(day, {
        date: day,
        revenue_rub: 0,
        orders_count: 0,
        ads_kopecks: adsRub * 100,
      });
    }
  }
  const byDay = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  const revenue = byDay.reduce((s, r) => s + r.revenue_rub, 0);
  const orders = byDay.reduce((s, r) => s + r.orders_count, 0);
  const ads = byDay.reduce((s, r) => s + r.ads_kopecks / 100, 0);

  return { revenue, orders, ads, byDay, adsSource };
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const accountId = url.searchParams.get('accountId');
    const fromStr = url.searchParams.get('from');
    const toStr = url.searchParams.get('to');
    if (!fromStr || !toStr) {
      return NextResponse.json(
        { ok: false, error: 'from/to required (ISO)' },
        { status: 400 },
      );
    }
    const from = new Date(fromStr);
    const to = new Date(toStr);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      return NextResponse.json({ ok: false, error: 'Invalid date' }, { status: 400 });
    }
    const lengthMs = to.getTime() - from.getTime();
    const prevFrom = new Date(from.getTime() - lengthMs);
    const prevTo = new Date(from.getTime());

    const [current, previous] = await Promise.all([
      getAggregateForRange({ tenantId: session.tenantId, accountId, from, to }),
      getAggregateForRange({
        tenantId: session.tenantId,
        accountId,
        from: prevFrom,
        to: prevTo,
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
      byDay: current.byDay.map((d) => ({
        date: d.date,
        revenueRub: d.revenue_rub,
        orders: d.orders_count,
        adsRub: d.ads_kopecks / 100,
      })),
      adsSource: current.adsSource,
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
