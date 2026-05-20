// PURPOSE: Time-series Ozon (выручка/заказы/реклама/ДРР по дням или неделям/месяцам).
// Tenant-scoped. Используется блоком unit.ozon-chart.
//
// Источник продаж — двухуровневый (как в /analytics/ozon после v0.18.13):
//   - primary: ozon_analytics_daily (Seller `/v1/analytics/data`) —
//     родной аналитический endpoint Ozon, цифры совпадают с Seller-кабинетом.
//   - fallback: ozon_orders с broader-фильтром (не cancelled/returned) —
//     используется только когда analytics_daily пустая за выбранный период.
//
// Реклама — UNION CPC/CPM (per-SKU) + CPO (агрегат по магазину).

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  ozonOrders,
  ozonPerfSkuStats,
  ozonPerfCpoDaily,
  ozonPerfExpenseDaily,
  ozonTransactions,
  ozonAnalyticsDaily,
} from '@/lib/db/schema/marketplaces';

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
  adsSource: 'expense' | 'performance' | 'transactions-heuristic' | 'none';
  /** Источник продаж: 'analytics-api' = ozon_analytics_daily, 'orders-fallback' = ozon_orders. */
  ordersSource: 'analytics-api' | 'orders-fallback';
};

function parseGranularity(s: string | null): Granularity {
  if (s === 'week' || s === 'month') return s;
  return 'day';
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
    const gran = parseGranularity(url.searchParams.get('granularity'));
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
    // postgres.js не сериализует Date в raw sql-template'ах — передаём ISO-строки.
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const granLit = sql.raw(`'${gran}'`); // gran проверен на whitelist выше

    const accountCondOrders = accountId
      ? sql`AND o.account_id = ${accountId}`
      : sql``;
    const accountCondPerf = accountId
      ? sql`AND ps.account_id = ${accountId}`
      : sql``;
    const accountCondTx = accountId ? sql`AND tx.account_id = ${accountId}` : sql``;
    const accountCondAnalytics = accountId
      ? sql`AND ad.account_id = ${accountId}`
      : sql``;
    const accountCondCpo = accountId
      ? sql`AND cd.account_id = ${accountId}`
      : sql``;
    const accountCondExp = accountId
      ? sql`AND ex.account_id = ${accountId}`
      : sql``;

    // Определяем источник продаж: ozon_analytics_daily (primary) → ozon_orders (legacy).
    type CheckRow = { cnt: number };
    const analyticsCheck = await db.execute<CheckRow>(sql`
      SELECT COUNT(*)::int AS cnt FROM ${ozonAnalyticsDaily} ad
      WHERE ad.tenant_id = ${session.tenantId}
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

    type Row = { bucket: string; revenue: number; orders: number };
    const ordersResult = await db.execute<Row>(
      hasAnalyticsData
        ? sql`
          SELECT
            to_char(date_trunc(${granLit}, ad.date::timestamp), 'YYYY-MM-DD') AS bucket,
            COALESCE(SUM(ad.revenue_kopecks), 0)::numeric / 100 AS revenue,
            COALESCE(SUM(ad.ordered_units), 0)::int AS orders
          FROM ${ozonAnalyticsDaily} ad
          WHERE ad.tenant_id = ${session.tenantId}
            ${accountCondAnalytics}
            AND ad.date >= ${fromIso}::date
            AND ad.date < ${toIso}::date
          GROUP BY 1
          ORDER BY 1
        `
        : sql`
          WITH order_items AS (
            SELECT
              o.id,
              o.status,
              o.cancelled_at,
              o.returned_at,
              date_trunc(${granLit}, o.order_created_at AT TIME ZONE 'UTC') AS bucket,
              COALESCE(NULLIF(it->>'price', '')::numeric, 0) AS price_rub,
              COALESCE(NULLIF(it->>'quantity', '')::numeric, 0) AS qty
            FROM ${ozonOrders} o
            CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
            WHERE o.tenant_id = ${session.tenantId}
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
            to_char(bucket, 'YYYY-MM-DD') AS bucket,
            COALESCE(SUM(price_rub * qty), 0) AS revenue,
            COUNT(DISTINCT id) AS orders
          FROM order_items
          GROUP BY bucket
          ORDER BY bucket
        `,
    );
    const ordersRows: Row[] = Array.isArray(ordersResult)
      ? (ordersResult as Row[])
      : (((ordersResult as unknown) as { rows: Row[] }).rows ?? []);

    // Реклама — приоритет:
    //  1) `ozon_perf_expense_daily` (эталон Performance API `/statistics/expense`).
    //  2) UNION CPC (`ozon_perf_sku_stats`) + CPO (`ozon_perf_cpo_daily`).
    //  3) Эвристика по `ozon_transactions`.
    type AdsRow = { bucket: string; ads_kopecks: number };
    const expenseResult = await db.execute<AdsRow>(sql`
      SELECT
        to_char(date_trunc(${granLit}, ex.date::timestamp), 'YYYY-MM-DD') AS bucket,
        COALESCE(SUM(ex.total_spent_kopecks), 0) AS ads_kopecks
      FROM ${ozonPerfExpenseDaily} ex
      WHERE ex.tenant_id = ${session.tenantId}
        ${accountCondExp}
        AND ex.date >= ${fromIso}::date
        AND ex.date < ${toIso}::date
      GROUP BY 1
      ORDER BY 1
    `);
    const expenseRows: AdsRow[] = Array.isArray(expenseResult)
      ? (expenseResult as AdsRow[])
      : (((expenseResult as unknown) as { rows: AdsRow[] }).rows ?? []);
    const perfResult = await db.execute<AdsRow>(sql`
      WITH cpc_daily AS (
        SELECT
          ps.date AS day,
          SUM(ps.expense_kopecks) AS kopecks
        FROM ${ozonPerfSkuStats} ps
        WHERE ps.tenant_id = ${session.tenantId}
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
        WHERE cd.tenant_id = ${session.tenantId}
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
        to_char(date_trunc(${granLit}, day::timestamp), 'YYYY-MM-DD') AS bucket,
        COALESCE(SUM(kopecks), 0) AS ads_kopecks
      FROM combined
      GROUP BY 1
      ORDER BY 1
    `);
    const perfRows: AdsRow[] = Array.isArray(perfResult)
      ? (perfResult as AdsRow[])
      : (((perfResult as unknown) as { rows: AdsRow[] }).rows ?? []);

    let adsSource: 'expense' | 'performance' | 'transactions-heuristic' | 'none' = 'none';
    const adsByBucket = new Map<string, number>();
    if (expenseRows.length > 0) {
      adsSource = 'expense';
      for (const r of expenseRows) adsByBucket.set(r.bucket, Number(r.ads_kopecks) / 100);
    } else if (perfRows.length > 0) {
      adsSource = 'performance';
      for (const r of perfRows) adsByBucket.set(r.bucket, Number(r.ads_kopecks) / 100);
    } else {
      const txResult = await db.execute<AdsRow>(sql`
        SELECT
          to_char(date_trunc(${granLit}, tx.operation_date AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS bucket,
          COALESCE(SUM(ABS(tx.amount_kopecks)), 0) AS ads_kopecks
        FROM ${ozonTransactions} tx
        WHERE tx.tenant_id = ${session.tenantId}
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
      for (const r of txRows) adsByBucket.set(r.bucket, Number(r.ads_kopecks) / 100);
    }

    // Merge.
    const buckets = new Map<
      string,
      { date: string; revenue: number; orders: number; ads: number }
    >();
    for (const r of ordersRows) {
      buckets.set(r.bucket, {
        date: r.bucket,
        revenue: Number(r.revenue),
        orders: Number(r.orders),
        ads: 0,
      });
    }
    for (const [bucket, adsRub] of adsByBucket) {
      const existing = buckets.get(bucket);
      if (existing) existing.ads = adsRub;
      else
        buckets.set(bucket, {
          date: bucket,
          revenue: 0,
          orders: 0,
          ads: adsRub,
        });
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
      adsSource,
      ordersSource,
    };
    return NextResponse.json(response);
  } catch (e) {
    console.error('[marketplaces] GET /ozon/timeseries failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
