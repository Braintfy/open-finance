// PURPOSE: Серверный расчёт агрегатов Ozon-аналитики для cross-block sources.
// Используется в /api/blocks/sources чтобы показывать реальные значения
// в модалке привязок (вместо null). Упрощённая версия full analytics route —
// только totals + top-1 SKU + опц. previous period (без full per-product
// breakdown который отдаёт /api/marketplaces/analytics/ozon).
//
// Источники данных (порядок приоритета для adsRub):
//   1. ozon_perf_expense_daily (эталон Performance API /statistics/expense)
//   2. ozon_perf_sku_stats + ozon_perf_cpo_daily (CPC + CPO агрегат)
//   3. ozon_transactions (heuristic — fallback)

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { unitProducts } from '@/lib/db/schema/unit-economics';
import {
  ozonOrders,
  ozonPerfSkuStats,
} from '@/lib/db/schema/marketplaces';
import { getOzonAdsTotals } from '@/lib/marketplaces/ozon/ads-totals';
import {
  getPreviousOzonQueryPeriod,
  resolveOzonQueryPeriod,
} from '@/lib/marketplaces/ozon/query-period';
import { type OzonAnalyticsPeriodPreset } from './unit-ozon-analytics-types';

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

  // --- Top-SKU метрики (для модалки связей) ----------------------------
  /** ₽ выручки топ-1 товара (DESC by revenue). */
  top1Revenue: number;
  /** Артикул топ-1 товара. */
  top1Article: string | null;
  /** Название топ-1 товара. */
  top1Name: string | null;
  /** ДРР по топ-1 товару (%, null если ads = 0). */
  top1Drr: number | null;
  /** Расход на топ-1 товара. */
  top1Ads: number;
  /** Средний ДРР по SKU с продажами. */
  avgDrr: number | null;
  /** Максимальный ДРР среди SKU с продажами. */
  maxDrr: number | null;
  /** Стоимость остатков (cost × qty stock) в ₽. */
  totalStockValueRub: number;

  // --- Previous period (опц., только если includePrevious=true) --------
  /** Выручка за тот же диапазон сдвинутый назад. */
  revenuePrev: number | null;
  /** Расход за тот же диапазон сдвинутый назад. */
  adsPrev: number | null;
  /** Заказы за тот же диапазон сдвинутый назад. */
  ordersPrev: number | null;
  /** Δ% выручка к прошлому периоду. */
  deltaRevenuePct: number | null;
  /** Δ% расход к прошлому периоду. */
  deltaAdsPct: number | null;
  /** Δ% заказы к прошлому периоду. */
  deltaOrdersPct: number | null;

  /** Какой источник использован для adsRub. */
  adsSource: 'expense' | 'performance' | 'transactions-heuristic' | 'none';
};

/**
 * Быстрый серверный расчёт агрегатов аналитики Ozon.
 * Возвращает totals + top-1 SKU + опц. previous period — ~150ms.
 */
export async function getOzonAnalyticsTotals(
  tenantId: string,
  accountId: string | null,
  periodPreset: OzonAnalyticsPeriodPreset = '30d',
  customFrom: string | null = null,
  customTo: string | null = null,
  options: { includePrevious?: boolean } = {},
): Promise<OzonAnalyticsTotals> {
  const msc = resolveOzonQueryPeriod(periodPreset, customFrom, customTo);
  const totals = await runAggregate(tenantId, accountId, msc.fromDate, msc.toDateExclusive);

  // --- Previous period (опционально) ------------------------------------
  let revenuePrev: number | null = null;
  let adsPrev: number | null = null;
  let ordersPrev: number | null = null;
  let deltaRevenuePct: number | null = null;
  let deltaAdsPct: number | null = null;
  let deltaOrdersPct: number | null = null;
  if (options.includePrevious) {
    const prev = getPreviousOzonQueryPeriod(msc);
    const prevTotals = await runAggregate(
      tenantId,
      accountId,
      prev.fromDate,
      prev.toDateExclusive,
    );
    revenuePrev = prevTotals.revenueRub;
    adsPrev = prevTotals.adsRub;
    ordersPrev = prevTotals.delivered;
    deltaRevenuePct = computeDeltaPct(totals.revenueRub, revenuePrev);
    deltaAdsPct = computeDeltaPct(totals.adsRub, adsPrev);
    deltaOrdersPct = computeDeltaPct(totals.delivered, ordersPrev);
  }

  return {
    ...totals,
    revenuePrev,
    adsPrev,
    ordersPrev,
    deltaRevenuePct,
    deltaAdsPct,
    deltaOrdersPct,
  };
}

function computeDeltaPct(curr: number, prev: number | null): number | null {
  if (prev === null || !Number.isFinite(prev) || prev === 0) return null;
  return Math.round(((curr - prev) / prev) * 1000) / 10;
}

type CoreTotals = Omit<
  OzonAnalyticsTotals,
  | 'revenuePrev'
  | 'adsPrev'
  | 'ordersPrev'
  | 'deltaRevenuePct'
  | 'deltaAdsPct'
  | 'deltaOrdersPct'
>;

async function runAggregate(
  tenantId: string,
  accountId: string | null,
  fromDate: string,
  toDateExclusive: string,
): Promise<CoreTotals> {
  const accountCondOrders = accountId ? sql`AND o.account_id = ${accountId}` : sql``;
  const accountCondPerf = accountId ? sql`AND ps.account_id = ${accountId}` : sql``;
  const accountCondUp = accountId
    ? sql`AND ${unitProducts.marketplaceAccountId} = ${accountId}`
    : sql``;

  const adsTotals = await getOzonAdsTotals({
    tenantId,
    accountId,
    fromDate,
    toDateExclusive,
  });
  const adsRub = adsTotals.adsRub;
  const adsSource = adsTotals.adsSource;
  type PerProductRow = {
    product_id: string;
    article: string | null;
    name: string;
    stock_marketplace: number | string;
    stock_own: number | string;
    cost_kopecks: number | string;
    delivered: number | string;
    cancelled: number | string;
    returned: number | string;
    qty_delivered: number | string;
    revenue_kopecks: number | string;
    ads_kopecks: number | string;
  };
  const productResult = await db.execute<PerProductRow>(sql`
    WITH order_items AS (
      SELECT
        o.id,
        o.status,
        o.cancelled_at,
        o.returned_at,
        (it->>'offerId')::text AS offer_id,
        COALESCE(NULLIF(it->>'price', '')::numeric, 0) AS item_price_rub,
        COALESCE(NULLIF(it->>'quantity', '')::numeric, 0) AS item_qty
      FROM ${ozonOrders} o
      CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
      WHERE o.tenant_id = ${tenantId}
        ${accountCondOrders}
        AND o.order_created_at >= ${fromDate}::timestamp
        AND o.order_created_at < ${toDateExclusive}::timestamp
    ),
    agg_orders AS (
      SELECT
        offer_id,
        COUNT(DISTINCT id) FILTER (
          WHERE cancelled_at IS NULL
            AND returned_at IS NULL
            AND lower(status) NOT LIKE '%cancel%'
            AND lower(status) NOT LIKE '%return%'
        ) AS delivered,
        COUNT(DISTINCT id) FILTER (
          WHERE cancelled_at IS NOT NULL OR lower(status) LIKE '%cancel%'
        ) AS cancelled,
        COUNT(DISTINCT id) FILTER (
          WHERE returned_at IS NOT NULL OR lower(status) LIKE '%return%'
        ) AS returned,
        SUM(item_qty) FILTER (
          WHERE cancelled_at IS NULL
            AND returned_at IS NULL
            AND lower(status) NOT LIKE '%cancel%'
            AND lower(status) NOT LIKE '%return%'
        ) AS qty_delivered,
        SUM(item_qty * item_price_rub) FILTER (
          WHERE cancelled_at IS NULL
            AND returned_at IS NULL
            AND lower(status) NOT LIKE '%cancel%'
            AND lower(status) NOT LIKE '%return%'
        ) AS revenue_rub
      FROM order_items
      WHERE offer_id IS NOT NULL AND offer_id <> ''
      GROUP BY offer_id
    ),
    agg_ads_sku AS (
      SELECT
        ps.sku,
        MIN(ps.raw->>'offer_id') FILTER (WHERE COALESCE(ps.raw->>'offer_id', '') <> '') AS offer_id,
        MIN(ps.raw->>'Артикул') FILTER (WHERE COALESCE(ps.raw->>'Артикул', '') <> '') AS article_raw,
        SUM(ps.expense_kopecks) AS ads_kopecks
      FROM ${ozonPerfSkuStats} ps
      WHERE ps.tenant_id = ${tenantId}
        ${accountCondPerf}
        AND ps.date >= ${fromDate}::date
        AND ps.date < ${toDateExclusive}::date
      GROUP BY ps.sku
    )
    SELECT
      ${unitProducts.id}::text AS product_id,
      ${unitProducts.article} AS article,
      ${unitProducts.name} AS name,
      ${unitProducts.stockMarketplace} AS stock_marketplace,
      ${unitProducts.stockOwn} AS stock_own,
      ${unitProducts.costKopecks} AS cost_kopecks,
      COALESCE(ao.delivered, 0)::int AS delivered,
      COALESCE(ao.cancelled, 0)::int AS cancelled,
      COALESCE(ao.returned, 0)::int AS returned,
      COALESCE(ao.qty_delivered, 0) AS qty_delivered,
      COALESCE(ao.revenue_rub * 100, 0) AS revenue_kopecks,
      COALESCE(ad.ads_kopecks, 0) AS ads_kopecks
    FROM ${unitProducts}
    LEFT JOIN agg_orders ao ON ao.offer_id = ${unitProducts.article}
    LEFT JOIN LATERAL (
      SELECT SUM(ads.ads_kopecks) AS ads_kopecks
      FROM agg_ads_sku ads
      WHERE ads.sku = ${unitProducts.sku}
         OR ads.offer_id = ${unitProducts.article}
         OR ads.article_raw = ${unitProducts.article}
    ) ad ON TRUE
    WHERE ${unitProducts.tenantId} = ${tenantId}
      AND ${unitProducts.marketplace} = 'ozon'
      ${accountCondUp}
    ORDER BY revenue_kopecks DESC NULLS LAST, name ASC
  `);

  const productRows: PerProductRow[] = Array.isArray(productResult)
    ? (productResult as PerProductRow[])
    : (((productResult as unknown) as { rows: PerProductRow[] }).rows ?? []);

  let revenueRub = 0;
  let deliveredSum = 0;
  let cancelledSum = 0;
  let returnedSum = 0;
  let qtyDeliveredSum = 0;
  let totalCostKopecks = 0;
  let stockTotalSum = 0;
  let totalStockValueKopecks = 0;
  let productsWithSales = 0;

  let top1Revenue = 0;
  let top1Article: string | null = null;
  let top1Name: string | null = null;
  let top1AdsKopecks = 0;

  const drrValues: number[] = [];

  for (const p of productRows) {
    const revRub = Number(p.revenue_kopecks) / 100;
    const adsK = Number(p.ads_kopecks);
    const delivered = Number(p.delivered);
    const stock = Number(p.stock_marketplace) + Number(p.stock_own);

    revenueRub += revRub;
    deliveredSum += delivered;
    cancelledSum += Number(p.cancelled);
    returnedSum += Number(p.returned);
    qtyDeliveredSum += Number(p.qty_delivered);
    totalCostKopecks += Number(p.cost_kopecks) * Number(p.qty_delivered);
    stockTotalSum += stock;
    totalStockValueKopecks += Number(p.cost_kopecks) * stock;
    if (revRub > 0) productsWithSales += 1;

    // Top-1 product (rows уже отсортированы DESC by revenue).
    if (top1Revenue === 0 && revRub > 0) {
      top1Revenue = revRub;
      top1Article = p.article;
      top1Name = p.name;
      top1AdsKopecks = adsK;
    }

    if (revRub > 0 && adsK > 0) {
      drrValues.push((adsK / 100 / revRub) * 100);
    }
  }

  const top1Drr =
    top1Revenue > 0 && top1AdsKopecks > 0
      ? Math.round(((top1AdsKopecks / 100 / top1Revenue) * 100) * 10) / 10
      : null;
  const top1Ads = top1AdsKopecks / 100;

  const avgDrr =
    drrValues.length > 0
      ? Math.round((drrValues.reduce((s, v) => s + v, 0) / drrValues.length) * 10) / 10
      : null;
  const maxDrr =
    drrValues.length > 0 ? Math.round(Math.max(...drrValues) * 10) / 10 : null;

  const totalCostRub = totalCostKopecks / 100;
  const totalProfitRub = revenueRub - totalCostRub;
  const totalStockValueRub = totalStockValueKopecks / 100;

  const drrPct = revenueRub > 0 && adsRub > 0 ? (adsRub / revenueRub) * 100 : null;
  const totalOrders = deliveredSum + cancelledSum + returnedSum;
  const avgBuyoutPct =
    totalOrders >= 5
      ? Math.round((deliveredSum / totalOrders) * 100 * 10) / 10
      : null;

  return {
    revenueRub,
    adsRub,
    totalCostRub,
    totalProfitRub,
    delivered: deliveredSum,
    cancelled: cancelledSum,
    returned: returnedSum,
    qtyDelivered: qtyDeliveredSum,
    productsWithSales,
    rowsCount: productRows.length,
    stockTotal: stockTotalSum,
    avgBuyoutPct,
    drrPct,
    top1Revenue,
    top1Article,
    top1Name,
    top1Drr,
    top1Ads,
    avgDrr,
    maxDrr,
    totalStockValueRub,
    adsSource,
  };
}
