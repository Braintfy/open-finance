// PURPOSE: Серверный расчёт агрегатов Ozon-аналитики для cross-block sources.
// Используется в /api/blocks/sources чтобы показывать реальные значения
// в модалке привязок (вместо null). Упрощённая версия full analytics route —
// только totals, без per-product breakdown.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { unitProducts } from '@/lib/db/schema/unit-economics';
import { ozonOrders, ozonTransactions } from '@/lib/db/schema/marketplaces';
import { resolvePeriod, type OzonAnalyticsPeriodPreset } from './unit-ozon-analytics-types';

export type OzonAnalyticsTotals = {
  revenueRub: number;
  adsRub: number;
  totalCostRub: number;
  totalProfitRub: number;
  delivered: number;
  cancelled: number;
  returned: number;
  qtyDelivered: number;
  productsWithSales: number;
  rowsCount: number;
  stockTotal: number;
  avgBuyoutPct: number | null;
  drrPct: number | null;
};

const ADS_FILTER_SQL = sql`(
  lower(operation_type) LIKE '%promot%'
  OR lower(operation_type) LIKE '%advertis%'
  OR lower(operation_type) LIKE '%marketing%'
)`;

/**
 * Быстрый серверный расчёт агрегатов аналитики Ozon.
 * Возвращает только totals (без per-product rows) — ~100ms.
 */
export async function getOzonAnalyticsTotals(
  tenantId: string,
  accountId: string | null,
  periodPreset: OzonAnalyticsPeriodPreset = '30d',
  customFrom: string | null = null,
  customTo: string | null = null,
): Promise<OzonAnalyticsTotals> {
  const period = resolvePeriod(periodPreset, customFrom, customTo);
  const fromIso = period.from.toISOString();
  const toIso = period.to.toISOString();
  const periodDays = Math.max(1, Math.round((period.to.getTime() - period.from.getTime()) / (24 * 3600 * 1000)));

  const accountCondOrders = accountId ? sql`AND o.account_id = ${accountId}` : sql``;
  const accountCondTx = accountId ? sql`AND tx.account_id = ${accountId}` : sql``;
  const accountCondUp = accountId
    ? sql`AND ${unitProducts.marketplaceAccountId} = ${accountId}`
    : sql``;

  type AggRow = {
    revenue_kopecks: string | number;
    ads_kopecks: string | number;
    delivered: string | number;
    cancelled: string | number;
    returned: string | number;
    qty_delivered: string | number;
    products_with_sales: string | number;
    rows_count: string | number;
    stock_total: string | number;
    cost_total_kopecks: string | number;
  };

  const rawResult = await db.execute<AggRow>(sql`
    WITH order_items AS (
      SELECT
        o.id,
        o.status,
        (it->>'offerId')::text AS offer_id,
        COALESCE(NULLIF(it->>'price', '')::numeric, 0) AS item_price_rub,
        COALESCE(NULLIF(it->>'quantity', '')::numeric, 0) AS item_qty
      FROM ${ozonOrders} o
      CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
      WHERE o.tenant_id = ${tenantId}
        ${accountCondOrders}
        AND o.order_created_at >= ${fromIso}::timestamp
        AND o.order_created_at < ${toIso}::timestamp
    ),
    agg_orders AS (
      SELECT
        offer_id,
        COUNT(DISTINCT id) FILTER (WHERE status = 'delivered') AS delivered,
        COUNT(DISTINCT id) FILTER (WHERE status IN ('cancelled', 'canceled')) AS cancelled,
        COUNT(DISTINCT id) FILTER (WHERE status = 'returned') AS returned,
        SUM(item_qty) FILTER (WHERE status = 'delivered') AS qty_delivered,
        SUM(item_qty * item_price_rub) FILTER (WHERE status = 'delivered') AS revenue_rub
      FROM order_items
      WHERE offer_id IS NOT NULL AND offer_id <> ''
      GROUP BY offer_id
    ),
    agg_ads AS (
      SELECT
        SUM(ABS(tx.amount_kopecks)) AS ads_kopecks
      FROM ${ozonTransactions} tx
      WHERE tx.tenant_id = ${tenantId}
        ${accountCondTx}
        AND tx.operation_date >= ${fromIso}::timestamp
        AND tx.operation_date < ${toIso}::timestamp
        AND tx.sku IS NOT NULL
        AND ${ADS_FILTER_SQL}
    ),
    products AS (
      SELECT
        ${unitProducts.article} AS article,
        ${unitProducts.stockMarketplace} AS stock_marketplace,
        ${unitProducts.stockOwn} AS stock_own,
        ${unitProducts.costKopecks} AS cost_kopecks
      FROM ${unitProducts}
      WHERE ${unitProducts.tenantId} = ${tenantId}
        AND ${unitProducts.marketplace} = 'ozon'
        ${accountCondUp}
    )
    SELECT
      COALESCE((SELECT SUM(revenue_rub) * 100 FROM agg_orders), 0) AS revenue_kopecks,
      COALESCE((SELECT ads_kopecks FROM agg_ads), 0) AS ads_kopecks,
      COALESCE((SELECT SUM(delivered) FROM agg_orders), 0) AS delivered,
      COALESCE((SELECT SUM(cancelled) FROM agg_orders), 0) AS cancelled,
      COALESCE((SELECT SUM(returned) FROM agg_orders), 0) AS returned,
      COALESCE((SELECT SUM(qty_delivered) FROM agg_orders), 0) AS qty_delivered,
      COALESCE((SELECT COUNT(*) FROM agg_orders WHERE delivered > 0), 0) AS products_with_sales,
      COALESCE((SELECT COUNT(*) FROM products), 0) AS rows_count,
      COALESCE((SELECT SUM(stock_marketplace + stock_own) FROM products), 0) AS stock_total,
      COALESCE((
        SELECT SUM(
          p.cost_kopecks * COALESCE(ao.qty_delivered, 0)
        )
        FROM products p
        LEFT JOIN agg_orders ao ON ao.offer_id = p.article
      ), 0) AS cost_total_kopecks
  `);

  const rows: AggRow[] = Array.isArray(rawResult)
    ? (rawResult as AggRow[])
    : (((rawResult as unknown) as { rows: AggRow[] }).rows ?? []);

  const row = rows[0];
  if (!row) {
    return {
      revenueRub: 0, adsRub: 0, totalCostRub: 0, totalProfitRub: 0,
      delivered: 0, cancelled: 0, returned: 0, qtyDelivered: 0,
      productsWithSales: 0, rowsCount: 0, stockTotal: 0,
      avgBuyoutPct: null, drrPct: null,
    };
  }

  const revenueRub = Number(row.revenue_kopecks) / 100;
  const adsRub = Number(row.ads_kopecks) / 100;
  const delivered = Number(row.delivered);
  const cancelled = Number(row.cancelled);
  const returned = Number(row.returned);
  const qtyDelivered = Number(row.qty_delivered);
  const totalCostRub = Number(row.cost_total_kopecks) / 100;
  const totalProfitRub = revenueRub - totalCostRub;
  const stockTotal = Number(row.stock_total);
  const rowsCount = Number(row.rows_count);
  const productsWithSales = Number(row.products_with_sales);

  const drrPct = revenueRub > 0 && adsRub > 0 ? (adsRub / revenueRub) * 100 : null;

  // buyout: delivered / (delivered + cancelled + returned)
  const totalOrders = delivered + cancelled + returned;
  const avgBuyoutPct = totalOrders >= 5
    ? Math.round((delivered / totalOrders) * 100 * 10) / 10
    : null;

  return {
    revenueRub, adsRub, totalCostRub, totalProfitRub,
    delivered, cancelled, returned, qtyDelivered,
    productsWithSales, rowsCount, stockTotal,
    avgBuyoutPct, drrPct,
  };
}
