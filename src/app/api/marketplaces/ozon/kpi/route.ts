// PURPOSE: KPI агрегаты Ozon (выручка/заказы/реклама/ДРР/AOV/CPO) за период
// + delta vs прошлый период + sparkline по дням. Tenant-scoped.
//
// Источник продаж — двухуровневый (как в /analytics/ozon после v0.18.13):
//   - primary: ozon_analytics_daily (Seller `/v1/analytics/data`) — точно как
//     в Seller-кабинете Ozon.
//   - fallback: ozon_orders с broader-фильтром (не cancelled/returned) —
//     используется только когда analytics_daily пустая.
//
// Реклама:
//   - ozon_perf_sku_stats (если есть) — CPC/CPM расход + ozon_perf_cpo_daily — CPO агрегат
//   - fallback на ozon_transactions с эвристикой LIKE '%promot%|advertis|marketing'

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  ozonOrders,
  ozonTransactions,
  ozonPerfSkuStats,
  ozonPerfCpoDaily,
  ozonAnalyticsDaily,
} from '@/lib/db/schema/marketplaces';

export const runtime = 'nodejs';

/** Режим сравнения для delta-бейджей. */
export type CompareMode = 'previous' | 'week-ago';

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
  /** Источник продаж: 'analytics-api' = ozon_analytics_daily, 'orders-fallback' = ozon_orders. */
  ordersSource: 'analytics-api' | 'orders-fallback';
  /** Режим сравнения (echo из query). */
  compareMode: CompareMode;
  /** Человеческий label для UI tooltip'а: "Прошлый период" / "Неделя назад". */
  compareLabel: string;
  /** Диапазон previous (для отладки/tooltip). ISO. */
  previousRange: { from: string; to: string };
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
}): Promise<{
  revenue: number;
  orders: number;
  ads: number;
  byDay: DayAgg[];
  adsSource: 'performance' | 'transactions-heuristic' | 'none';
  ordersSource: 'analytics-api' | 'orders-fallback';
}> {
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
  const accountCondCpo = accountId
    ? sql`AND cd.account_id = ${accountId}`
    : sql``;
  const accountCondTx = accountId ? sql`AND tx.account_id = ${accountId}` : sql``;
  const accountCondAnalytics = accountId
    ? sql`AND ad.account_id = ${accountId}`
    : sql``;

  // Определяем источник продаж: ozon_analytics_daily (primary) → ozon_orders (legacy).
  type CheckRow = { cnt: number };
  const analyticsCheck = await db.execute<CheckRow>(sql`
    SELECT COUNT(*)::int AS cnt FROM ${ozonAnalyticsDaily} ad
    WHERE ad.tenant_id = ${tenantId}
      ${accountCondAnalytics}
      AND ad.date >= ${fromIso}::date
      AND ad.date < ${toIso}::date
    LIMIT 1
  `);
  const analyticsCheckRows: CheckRow[] = Array.isArray(analyticsCheck)
    ? (analyticsCheck as CheckRow[])
    : (((analyticsCheck as unknown) as { rows: CheckRow[] }).rows ?? []);
  const hasAnalyticsData = (analyticsCheckRows[0]?.cnt ?? 0) > 0;
  const ordersSource: 'analytics-api' | 'orders-fallback' = hasAnalyticsData
    ? 'analytics-api'
    : 'orders-fallback';

  type Row = {
    day: string;
    revenue_rub: number;
    orders_count: number;
  };
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
          AND ad.date >= ${fromIso}::date
          AND ad.date < ${toIso}::date
        GROUP BY ad.date
        ORDER BY ad.date
      `
      : sql`
        WITH order_items AS (
          SELECT
            o.id,
            o.status,
            o.cancelled_at,
            o.returned_at,
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
            -- delivered = всё кроме явно отменённого/возвращённого
            -- (включая awaiting_deliver/delivering). На коротком окне строгий
            -- 'delivered' даёт провал — заказы ещё в пути.
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

  // Реклама: UNION CPC/CPM (per-SKU) + CPO (агрегат по магазину).
  // CPC из ozon_perf_sku_stats, CPO из ozon_perf_cpo_daily — суммируются per-day.
  type AdsRow = { day: string; ads_kopecks: number };
  const perfResult = await db.execute<AdsRow>(sql`
    WITH cpc_daily AS (
      SELECT
        ps.date AS day,
        SUM(ps.expense_kopecks) AS kopecks
      FROM ${ozonPerfSkuStats} ps
      WHERE ps.tenant_id = ${tenantId}
        ${accountCondPerf}
        AND ps.date >= ${fromIso}::date
        AND ps.date < ${toIso}::date
      GROUP BY ps.date
    ),
    cpo_daily AS (
      SELECT
        cd.date AS day,
        SUM(cd.expense_kopecks) AS kopecks
      FROM ${ozonPerfCpoDaily} cd
      WHERE cd.tenant_id = ${tenantId}
        ${accountCondCpo}
        AND cd.date >= ${fromIso}::date
        AND cd.date < ${toIso}::date
      GROUP BY cd.date
    ),
    combined AS (
      SELECT day, kopecks FROM cpc_daily
      UNION ALL
      SELECT day, kopecks FROM cpo_daily
    )
    SELECT
      to_char(day, 'YYYY-MM-DD') AS day,
      COALESCE(SUM(kopecks), 0) AS ads_kopecks
    FROM combined
    GROUP BY day
    ORDER BY day
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

  return { revenue, orders, ads, byDay, adsSource, ordersSource };
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
    const compareMode: CompareMode =
      url.searchParams.get('compareMode') === 'week-ago' ? 'week-ago' : 'previous';
    const lengthMs = to.getTime() - from.getTime();
    // previous: эталонный вариант — сдвиг на длину выбранного периода назад.
    // week-ago: сдвиг на 7 дней назад (день-к-дню, учитывает weekly seasonality).
    const shiftMs = compareMode === 'week-ago' ? 7 * 24 * 3600 * 1000 : lengthMs;
    const prevFrom = new Date(from.getTime() - shiftMs);
    const prevTo =
      compareMode === 'week-ago'
        ? new Date(to.getTime() - shiftMs)
        : new Date(from.getTime());
    const compareLabel =
      compareMode === 'week-ago' ? 'Неделя назад' : 'Прошлый период';

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
      ordersSource: current.ordersSource,
      compareMode,
      compareLabel,
      previousRange: { from: prevFrom.toISOString(), to: prevTo.toISOString() },
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
