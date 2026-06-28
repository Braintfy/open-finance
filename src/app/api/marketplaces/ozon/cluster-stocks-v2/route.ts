// PURPOSE: Остатки по географическим кластерам Ozon. Источник —
// ozon_warehouse_stocks (Seller `POST /v2/analytics/stock_on_warehouses`) +
// ozon_clusters (Seller `POST /v1/cluster/list`, маппинг
// warehouse_name → cluster). Опционально — продажи и выручка за период
// из ozon_orders по `raw->>'warehouseName'`.
//
// v0.18.22: оба источника переведены на Seller API. Раньше `cluster/list`
// ошибочно дёргали через Performance API (→ 404) и `stock_on_warehouses`
// бил по deprecated `/v1` (→ 404).

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  ozonWarehouseStocks,
  ozonClusters,
  ozonOrders,
} from '@/lib/db/schema/marketplaces';

export const runtime = 'nodejs';

export type OzonClusterStocksRow = {
  clusterId: string | null;
  clusterName: string;
  clusterType: string | null;
  freeStock: number;
  promisedStock: number;
  reservedStock: number;
  totalStock: number;
  /** Кол-во уникальных (sku, warehouse) комбинаций — приблизительно товарная глубина. */
  skuCount: number;
  /** Заказов за период (если from/to задан). */
  ordersInPeriod: number;
  /** Выручка за период, ₽. */
  revenueInPeriod: number;
  /** Доля от общего остатка. */
  sharePct: number;
};

export type OzonClusterStocksResponse = {
  ok: true;
  rows: OzonClusterStocksRow[];
  totals: {
    freeStock: number;
    promisedStock: number;
    reservedStock: number;
    totalStock: number;
    skuCount: number;
    ordersInPeriod: number;
    revenueInPeriod: number;
  };
  period: { from: string; to: string } | null;
  /**
   * Диагностика для empty-state UI. Когда `rows.length === 0`, фронт
   * показывает actionable card («Запустите sync-стейджи: clusters +
   * warehouseStocks») вместо пустого графика.
   */
  meta: {
    warehouseStocksCount: number;
    clustersCount: number;
    /** ISO-дата последнего fetch warehouse_stocks (null если не было). */
    lastWarehouseStocksFetchAt: string | null;
  };
};

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
    const hasPeriod = Boolean(fromStr && toStr);
    const fromIso = fromStr ?? null;
    const toIso = toStr ?? null;

    const accountCondStocks = accountId
      ? sql`AND ws.account_id = ${accountId}`
      : sql``;
    const accountCondClusters = accountId
      ? sql`AND c.account_id = ${accountId}`
      : sql``;
    const accountCondOrders = accountId
      ? sql`AND o.account_id = ${accountId}`
      : sql``;

    // Диагностика: сколько строк в исходных таблицах для этого account.
    // Используется фронтом чтобы показать «какие стейджи sync нужно
    // запустить» вместо пустого графика.
    type DiagRow = { warehouse_stocks_count: number; last_fetch: string | null };
    const diagResult = await db.execute<DiagRow>(sql`
      SELECT
        COUNT(*)::int AS warehouse_stocks_count,
        MAX(ws.fetched_at)::text AS last_fetch
      FROM ${ozonWarehouseStocks} ws
      WHERE ws.tenant_id = ${session.tenantId}
        ${accountCondStocks}
    `);
    const diagRows: DiagRow[] = Array.isArray(diagResult)
      ? (diagResult as DiagRow[])
      : (((diagResult as unknown) as { rows: DiagRow[] }).rows ?? []);
    const warehouseStocksCount = Number(diagRows[0]?.warehouse_stocks_count ?? 0);
    const lastWarehouseStocksFetchAt = diagRows[0]?.last_fetch ?? null;

    type ClusterCountRow = { clusters_count: number };
    const clustersResult = await db.execute<ClusterCountRow>(sql`
      SELECT COUNT(*)::int AS clusters_count
      FROM ${ozonClusters} c
      WHERE c.tenant_id = ${session.tenantId}
        ${accountCondClusters}
    `);
    const clusterCountRows: ClusterCountRow[] = Array.isArray(clustersResult)
      ? (clustersResult as ClusterCountRow[])
      : (((clustersResult as unknown) as { rows: ClusterCountRow[] }).rows ?? []);
    const clustersCount = Number(clusterCountRows[0]?.clusters_count ?? 0);

    type StockAggRow = {
      cluster_id: string | null;
      cluster_name: string | null;
      cluster_type: string | null;
      free: number;
      promised: number;
      reserved: number;
      sku_count: number;
    };
    const stocksResult = await db.execute<StockAggRow>(sql`
      SELECT
        ws.cluster_id AS cluster_id,
        ws.cluster_name AS cluster_name,
        ws.cluster_type AS cluster_type,
        COALESCE(SUM(ws.free_to_sell_amount), 0)::bigint AS free,
        COALESCE(SUM(ws.promised_amount), 0)::bigint AS promised,
        COALESCE(SUM(ws.reserved_amount), 0)::bigint AS reserved,
        COUNT(*)::int AS sku_count
      FROM ${ozonWarehouseStocks} ws
      WHERE ws.tenant_id = ${session.tenantId}
        ${accountCondStocks}
      GROUP BY ws.cluster_id, ws.cluster_name, ws.cluster_type
    `);
    const stockAggRows: StockAggRow[] = Array.isArray(stocksResult)
      ? (stocksResult as StockAggRow[])
      : (((stocksResult as unknown) as { rows: StockAggRow[] }).rows ?? []);

    // Опц. продажи за период по кластеру (через warehouse_name из ozon_orders.raw).
    let ordersByCluster = new Map<string, { orders: number; revenue: number }>();
    if (hasPeriod && fromIso && toIso) {
      type OrderClusterRow = {
        cluster_key: string | null;
        orders: number;
        revenue_rub: number;
      };
      const ordersResult = await db.execute<OrderClusterRow>(sql`
        WITH order_items AS (
          SELECT
            o.id,
            (o.raw->>'warehouseName')::text AS warehouse_name,
            COALESCE(NULLIF(it->>'price', '')::numeric, 0) AS price_rub,
            COALESCE(NULLIF(it->>'quantity', '')::numeric, 0) AS qty
          FROM ${ozonOrders} o
          CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
          WHERE o.tenant_id = ${session.tenantId}
            ${accountCondOrders}
            AND o.order_created_at >= ${fromIso}::timestamp
            AND o.order_created_at < ${toIso}::timestamp
            AND o.cancelled_at IS NULL
            AND o.returned_at IS NULL
        ),
        -- Pre-aggregate per (order_id, warehouse_name) to avoid N-multiplication
        -- when ozon_warehouse_stocks has multiple SKU rows for the same warehouse.
        order_sums AS (
          SELECT
            id,
            warehouse_name,
            SUM(price_rub * qty) AS total_rub
          FROM order_items
          GROUP BY id, warehouse_name
        ),
        -- Resolve cluster per warehouse (DISTINCT ON prevents stock-row duplication)
        warehouse_cluster AS (
          SELECT DISTINCT ON (ws.warehouse_name)
            ws.warehouse_name,
            ws.cluster_id
          FROM ${ozonWarehouseStocks} ws
          WHERE ws.tenant_id = ${session.tenantId}
            ${accountCondStocks}
        )
        SELECT
          COALESCE(wc.cluster_id, '__none__') AS cluster_key,
          COUNT(DISTINCT os.id)::int AS orders,
          COALESCE(SUM(os.total_rub), 0)::numeric AS revenue_rub
        FROM order_sums os
        LEFT JOIN warehouse_cluster wc ON wc.warehouse_name = os.warehouse_name
        GROUP BY COALESCE(wc.cluster_id, '__none__')
      `);
      const ordersRows: OrderClusterRow[] = Array.isArray(ordersResult)
        ? (ordersResult as OrderClusterRow[])
        : (((ordersResult as unknown) as { rows: OrderClusterRow[] }).rows ?? []);
      ordersByCluster = new Map(
        ordersRows.map((r) => [
          r.cluster_key === '__none__' ? '' : r.cluster_key ?? '',
          {
            orders: Number(r.orders ?? 0),
            revenue: Number(r.revenue_rub ?? 0),
          },
        ]),
      );
    }

    const grandTotalStock = stockAggRows.reduce(
      (s, r) => s + Number(r.free ?? 0) + Number(r.promised ?? 0) + Number(r.reserved ?? 0),
      0,
    );

    const rows: OzonClusterStocksRow[] = stockAggRows
      .map((r) => {
        const free = Number(r.free ?? 0);
        const promised = Number(r.promised ?? 0);
        const reserved = Number(r.reserved ?? 0);
        const total = free + promised + reserved;
        const clusterKey = r.cluster_id ?? '';
        const ord = ordersByCluster.get(clusterKey) ?? { orders: 0, revenue: 0 };
        return {
          clusterId: r.cluster_id,
          clusterName: r.cluster_name ?? 'Без кластера',
          clusterType: r.cluster_type,
          freeStock: free,
          promisedStock: promised,
          reservedStock: reserved,
          totalStock: total,
          skuCount: Number(r.sku_count ?? 0),
          ordersInPeriod: ord.orders,
          revenueInPeriod: ord.revenue,
          sharePct: grandTotalStock > 0 ? (total / grandTotalStock) * 100 : 0,
        };
      })
      .sort((a, b) => b.totalStock - a.totalStock);

    const totals = rows.reduce(
      (acc, r) => {
        acc.freeStock += r.freeStock;
        acc.promisedStock += r.promisedStock;
        acc.reservedStock += r.reservedStock;
        acc.totalStock += r.totalStock;
        acc.skuCount += r.skuCount;
        acc.ordersInPeriod += r.ordersInPeriod;
        acc.revenueInPeriod += r.revenueInPeriod;
        return acc;
      },
      {
        freeStock: 0,
        promisedStock: 0,
        reservedStock: 0,
        totalStock: 0,
        skuCount: 0,
        ordersInPeriod: 0,
        revenueInPeriod: 0,
      },
    );

    return NextResponse.json({
      ok: true,
      rows,
      totals,
      period: hasPeriod && fromIso && toIso ? { from: fromIso, to: toIso } : null,
      meta: {
        warehouseStocksCount,
        clustersCount,
        lastWarehouseStocksFetchAt,
      },
    } satisfies OzonClusterStocksResponse);
  } catch (e) {
    console.error('[marketplaces] GET /ozon/cluster-stocks-v2 failed:', e);
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}
