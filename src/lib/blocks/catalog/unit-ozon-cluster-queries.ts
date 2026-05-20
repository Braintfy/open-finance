// PURPOSE: Серверные totals для блоков «Остатки по кластерам» / «Остатки по
// типу склада» / «Кампании» / «Поисковые фразы». Используется в
// /api/blocks/sources для отображения реальных значений в модалке привязок
// (вместо null).
//
// Логика повторяет ядро соответствующих API-routes, но возвращает только
// агрегаты — без построчного breakdown.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  ozonWarehouseStocks,
  ozonClusters,
  ozonPerfCampaigns,
  ozonPerfSkuStats,
  ozonPerfPhrases,
} from '@/lib/db/schema/marketplaces';
import { resolvePeriod, type OzonAnalyticsPeriodPreset } from './unit-ozon-analytics-types';

export type OzonClusterStocksTotals = {
  /** Всего остатков (шт). */
  totalStock: number;
  freeStock: number;
  reservedStock: number;
  promisedStock: number;
  skuCount: number;
  clustersCount: number;
  /** Количество строк ozon_warehouse_stocks (для diagnostic). */
  warehouseStocksCount: number;
};

export async function getOzonClusterStocksTotals(
  tenantId: string,
  accountId: string | null,
): Promise<OzonClusterStocksTotals> {
  const accountCondStocks = accountId
    ? sql`AND ws.account_id = ${accountId}`
    : sql``;
  const accountCondClusters = accountId
    ? sql`AND c.account_id = ${accountId}`
    : sql``;

  type AggRow = {
    total_stock: number | string;
    free_stock: number | string;
    reserved_stock: number | string;
    promised_stock: number | string;
    sku_count: number | string;
    cluster_count: number | string;
    warehouse_stocks_count: number | string;
  };
  const stocksResult = await db.execute<AggRow>(sql`
    SELECT
      COALESCE(SUM(ws.free_to_sell_amount + ws.reserved_amount + ws.promised_amount), 0)::int AS total_stock,
      COALESCE(SUM(ws.free_to_sell_amount), 0)::int AS free_stock,
      COALESCE(SUM(ws.reserved_amount), 0)::int AS reserved_stock,
      COALESCE(SUM(ws.promised_amount), 0)::int AS promised_stock,
      COUNT(DISTINCT ws.sku)::int AS sku_count,
      COUNT(DISTINCT ws.cluster_id)::int AS cluster_count,
      COUNT(*)::int AS warehouse_stocks_count
    FROM ${ozonWarehouseStocks} ws
    WHERE ws.tenant_id = ${tenantId}
      ${accountCondStocks}
  `);
  const stocksRows: AggRow[] = Array.isArray(stocksResult)
    ? (stocksResult as AggRow[])
    : (((stocksResult as unknown) as { rows: AggRow[] }).rows ?? []);
  const stocks = stocksRows[0];

  // Кол-во кластеров берём из ozon_clusters независимо — это справочник.
  type ClusterCountRow = { cnt: number | string };
  const clustersResult = await db.execute<ClusterCountRow>(sql`
    SELECT COUNT(*)::int AS cnt FROM ${ozonClusters} c
    WHERE c.tenant_id = ${tenantId} ${accountCondClusters}
  `);
  const clustersRows: ClusterCountRow[] = Array.isArray(clustersResult)
    ? (clustersResult as ClusterCountRow[])
    : (((clustersResult as unknown) as { rows: ClusterCountRow[] }).rows ?? []);
  const clustersCount = Number(clustersRows[0]?.cnt ?? 0);

  return {
    totalStock: Number(stocks?.total_stock ?? 0),
    freeStock: Number(stocks?.free_stock ?? 0),
    reservedStock: Number(stocks?.reserved_stock ?? 0),
    promisedStock: Number(stocks?.promised_stock ?? 0),
    skuCount: Number(stocks?.sku_count ?? 0),
    clustersCount: clustersCount || Number(stocks?.cluster_count ?? 0),
    warehouseStocksCount: Number(stocks?.warehouse_stocks_count ?? 0),
  };
}

// =============================================================================
// Кампании Ozon Performance (unit.ozon-campaigns)
// =============================================================================

export type OzonCampaignsTotals = {
  campaignsCount: number;
  activeCampaignsCount: number;
  totalExpenseRub: number;
  totalOrders: number;
  totalOrdersRub: number;
  avgDrrPct: number | null;
};

export async function getOzonCampaignsTotals(
  tenantId: string,
  accountId: string | null,
  periodPreset: OzonAnalyticsPeriodPreset = '30d',
  customFrom: string | null = null,
  customTo: string | null = null,
): Promise<OzonCampaignsTotals> {
  const accountCondCamp = accountId ? sql`AND ${ozonPerfCampaigns.accountId} = ${accountId}` : sql``;
  const accountCondPerf = accountId ? sql`AND ${ozonPerfSkuStats.accountId} = ${accountId}` : sql``;

  const period = resolvePeriod(periodPreset, customFrom, customTo);
  const fromIso = period.from.toISOString();
  const toIso = period.to.toISOString();

  // 1. Кампании (counts).
  type CampRow = { total: number | string; active: number | string };
  const campResult = await db.execute<CampRow>(sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ${ozonPerfCampaigns.state} LIKE '%RUNNING%')::int AS active
    FROM ${ozonPerfCampaigns}
    WHERE ${ozonPerfCampaigns.tenantId} = ${tenantId}
      ${accountCondCamp}
  `);
  const campRows: CampRow[] = Array.isArray(campResult)
    ? (campResult as CampRow[])
    : (((campResult as unknown) as { rows: CampRow[] }).rows ?? []);
  const campaignsCount = Number(campRows[0]?.total ?? 0);
  const activeCampaignsCount = Number(campRows[0]?.active ?? 0);

  // 2. Расход и заказы из perf_sku_stats за период.
  type StatsRow = {
    expense_kopecks: number | string;
    orders: number | string;
    orders_kopecks: number | string;
  };
  const statsResult = await db.execute<StatsRow>(sql`
    SELECT
      COALESCE(SUM(${ozonPerfSkuStats.expenseKopecks}), 0)::bigint AS expense_kopecks,
      COALESCE(SUM(${ozonPerfSkuStats.orders}), 0)::int AS orders,
      COALESCE(SUM(${ozonPerfSkuStats.ordersKopecks}), 0)::bigint AS orders_kopecks
    FROM ${ozonPerfSkuStats}
    WHERE ${ozonPerfSkuStats.tenantId} = ${tenantId}
      ${accountCondPerf}
      AND ${ozonPerfSkuStats.date} >= ${fromIso}::date
      AND ${ozonPerfSkuStats.date} < ${toIso}::date
  `);
  const statsRows: StatsRow[] = Array.isArray(statsResult)
    ? (statsResult as StatsRow[])
    : (((statsResult as unknown) as { rows: StatsRow[] }).rows ?? []);
  const expenseKopecks = Number(statsRows[0]?.expense_kopecks ?? 0);
  const orders = Number(statsRows[0]?.orders ?? 0);
  const ordersKopecks = Number(statsRows[0]?.orders_kopecks ?? 0);

  const totalExpenseRub = expenseKopecks / 100;
  const totalOrdersRub = ordersKopecks / 100;
  const avgDrrPct =
    totalOrdersRub > 0 && totalExpenseRub > 0
      ? Math.round((totalExpenseRub / totalOrdersRub) * 100 * 10) / 10
      : null;

  return {
    campaignsCount,
    activeCampaignsCount,
    totalExpenseRub,
    totalOrders: orders,
    totalOrdersRub,
    avgDrrPct,
  };
}

// =============================================================================
// Поисковые фразы Ozon Performance (unit.ozon-search-phrases)
// =============================================================================

export type OzonSearchPhrasesTotals = {
  phrasesCount: number;
  totalExpenseRub: number;
  totalOrders: number;
  totalClicks: number;
  totalViews: number;
  avgCtrPct: number | null;
};

export async function getOzonSearchPhrasesTotals(
  tenantId: string,
  accountId: string | null,
  periodPreset: OzonAnalyticsPeriodPreset = '30d',
  customFrom: string | null = null,
  customTo: string | null = null,
): Promise<OzonSearchPhrasesTotals> {
  const accountCondPhr = accountId ? sql`AND ${ozonPerfPhrases.accountId} = ${accountId}` : sql``;
  const period = resolvePeriod(periodPreset, customFrom, customTo);
  const fromIso = period.from.toISOString();
  const toIso = period.to.toISOString();

  type AggRow = {
    phrases: number | string;
    expense_kopecks: number | string;
    orders: number | string;
    clicks: number | string;
    views: number | string;
  };
  const result = await db.execute<AggRow>(sql`
    SELECT
      COUNT(DISTINCT ${ozonPerfPhrases.phrase})::int AS phrases,
      COALESCE(SUM(${ozonPerfPhrases.expenseKopecks}), 0)::bigint AS expense_kopecks,
      COALESCE(SUM(${ozonPerfPhrases.orders}), 0)::int AS orders,
      COALESCE(SUM(${ozonPerfPhrases.clicks}), 0)::int AS clicks,
      COALESCE(SUM(${ozonPerfPhrases.views}), 0)::int AS views
    FROM ${ozonPerfPhrases}
    WHERE ${ozonPerfPhrases.tenantId} = ${tenantId}
      ${accountCondPhr}
      AND ${ozonPerfPhrases.date} >= ${fromIso}::date
      AND ${ozonPerfPhrases.date} < ${toIso}::date
  `);
  const rows: AggRow[] = Array.isArray(result)
    ? (result as AggRow[])
    : (((result as unknown) as { rows: AggRow[] }).rows ?? []);
  const r = rows[0];
  const views = Number(r?.views ?? 0);
  const clicks = Number(r?.clicks ?? 0);
  const avgCtrPct = views > 0 ? Math.round((clicks / views) * 100 * 10) / 10 : null;
  return {
    phrasesCount: Number(r?.phrases ?? 0),
    totalExpenseRub: Number(r?.expense_kopecks ?? 0) / 100,
    totalOrders: Number(r?.orders ?? 0),
    totalClicks: clicks,
    totalViews: views,
    avgCtrPct,
  };
}
