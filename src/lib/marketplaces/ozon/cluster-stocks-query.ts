// PURPOSE: DB-слой блока «Ozon · Остатки по кластерам». Собирает два
// независимых источника — снапшот остатков `ozon_warehouse_stocks` и заказы
// периода `ozon_orders` — и отдаёт готовый payload для API-роута
// `/api/marketplaces/ozon/cluster-stocks-v2`.
//
// Вынесено из route.ts, чтобы ту же логику мог прогонять smoke-тест
// `scripts/test-ozon-cluster-agg.ts` без auth/HTTP (иначе SQL в тесте
// пришлось бы дублировать — и он бы разъехался с боевым).
//
// Резолв склад→кластер живёт в pure-модуле `cluster-agg.ts` (Node, не SQL:
// в C-локали БД `lower()` не трогает кириллицу).
//
// Этап 2b LK_V2_PLAN: фильтр `source` ('all' | 'FBO' | 'FBS'). Он режет ОБА
// источника сразу — остатки по `ozon_warehouse_stocks.source` и заказы по
// `ozon_orders.scheme`; иначе в разрезе «FBS» висели бы FBO-заказы без
// единого остатка.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  ozonWarehouseStocks,
  ozonClusters,
  ozonOrders,
} from '@/lib/db/schema/marketplaces';
import { loadWarehouseClusterMap } from './sync/clusters';
import {
  attachWarehousesToClusters,
  buildClusterRows,
  foldWarehouseOrdersToClusters,
  normalizeWarehouseName,
  resolveOrdersToWarehouses,
  DEFAULT_WAREHOUSE_LIMIT,
  type ClusterAggRow,
  type ClusterRef,
  type ClusterStockAgg,
  type OrdersByWarehouse,
  type ResolvedOrders,
  type StockSource,
  type StockSourceFilter,
  type WarehouseOrdersBucket,
  type WarehouseSortKey,
  type WarehouseStockAgg,
} from './cluster-agg';

/** Разрез ответа: только кластеры или кластеры с вложенными складами. */
export type OzonClusterStocksGroupBy = 'cluster' | 'warehouse';

export type { StockSourceFilter };

export type OzonClusterStocksTotals = {
  freeStock: number;
  promisedStock: number;
  reservedStock: number;
  totalStock: number;
  skuCount: number;
  ordersInPeriod: number;
  revenueInPeriod: number;
};

export type OzonClusterStocksMeta = {
  warehouseStocksCount: number;
  clustersCount: number;
  /** ISO-дата последнего fetch warehouse_stocks (null если не было). */
  lastWarehouseStocksFetchAt: string | null;
  /**
   * Диагностика «Без кластера». Раньше единственный ключ `__none__` смешивал
   * два разных смысла — теперь они разведены и видны наружу.
   */
  unresolved: {
    /** Заказы, у которых имя склада есть, но кластер не нашёлся. */
    unknownWarehouseOrders: number;
    unknownWarehouseRevenue: number;
    /** Заказы вообще без имени склада (FBS-постинги без analytics_data). */
    noWarehouseOrders: number;
    noWarehouseRevenue: number;
    /** Имена складов, не сопоставленные ни со справочником, ни с остатками. */
    warehouses: string[];
  };
  /**
   * Диагностика разреза по складам (`groupBy='warehouse'`, иначе `null`).
   * `soldOutWithOrders` — те самые склады, выбитые в ноль, но продававшие:
   * до Этапа 2a их вообще не было видно.
   */
  warehouses: {
    total: number;
    withStock: number;
    withOrders: number;
    soldOutWithOrders: number;
  } | null;
  /**
   * Что вообще есть у аккаунта по источникам — считается ДО применения
   * фильтра `source`, чтобы UI мог показать «FBS не синхронизирован»
   * вместо пустой таблицы.
   */
  bySource: { fbo: number; fbs: number };
  /** Применённый фильтр источника. */
  source: StockSourceFilter;
};

export type OzonClusterStocksPayload = {
  rows: ClusterAggRow[];
  totals: OzonClusterStocksTotals;
  meta: OzonClusterStocksMeta;
  groupBy: OzonClusterStocksGroupBy;
};

/** Приводит `db.execute` к массиву строк (drizzle отдаёт либо массив, либо `{rows}`). */
function toRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  return ((result as { rows?: T[] })?.rows ?? []) as T[];
}

export async function loadOzonClusterStocks(args: {
  tenantId: string;
  /** `null` — все Ozon-аккаунты тенанта. */
  accountId: string | null;
  /** ISO-границы периода. Оба обязательны, иначе заказы не считаются. */
  fromIso: string | null;
  toIso: string | null;
  /** `'warehouse'` — к каждому кластеру достраивается список складов. */
  groupBy?: OzonClusterStocksGroupBy;
  /** Топ-N складов на кластер (только для `groupBy='warehouse'`). */
  warehouseLimit?: number;
  /** Метрика отбора топ-N складов (совпадает с сортировкой таблицы). */
  warehouseSort?: WarehouseSortKey;
  warehouseSortDir?: 'asc' | 'desc';
  /**
   * Источник остатков: `'all'` (по умолчанию), `'FBO'` (фулфилмент Ozon),
   * `'FBS'` (свои склады продавца). Фильтрует и остатки
   * (`ozon_warehouse_stocks.source`), и заказы периода
   * (`ozon_orders.scheme`) — иначе при `source='FBS'` в таблице оставались
   * бы FBO-заказы без единого остатка.
   */
  source?: StockSourceFilter;
}): Promise<OzonClusterStocksPayload> {
  const { tenantId, accountId, fromIso, toIso } = args;
  const groupBy: OzonClusterStocksGroupBy = args.groupBy ?? 'cluster';
  const source: StockSourceFilter = args.source ?? 'all';
  const hasPeriod = Boolean(fromIso && toIso);

  const accountCondStocks = accountId ? sql`AND ws.account_id = ${accountId}` : sql``;
  const accountCondClusters = accountId ? sql`AND c.account_id = ${accountId}` : sql``;
  const accountCondOrders = accountId ? sql`AND o.account_id = ${accountId}` : sql``;
  const sourceCondStocks = source === 'all' ? sql`` : sql`AND ws.source = ${source}`;
  // `ozon_orders.scheme` хранится в нижнем регистре ('fbo'/'fbs'), а source —
  // в верхнем (см. OzonStockSource). Сравнение через lower() безопасно:
  // значения латиницей, C-локаль БД их приводит корректно.
  const sourceCondOrders =
    source === 'all' ? sql`` : sql`AND lower(o.scheme) = ${source.toLowerCase()}`;

  // Диагностика: сколько строк в исходных таблицах для этого account.
  // Фронт по ней показывает «какие стейджи sync нужно запустить»
  // вместо пустого графика.
  //
  // Счётчики по источникам (`fbo_count`/`fbs_count`) НЕ фильтруются: по ним
  // UI отличает «FBS-стейдж не запускали» от «FBS-остатков нет».
  const srcMatch = source === 'all' ? sql`TRUE` : sql`ws.source = ${source}`;
  type DiagRow = {
    warehouse_stocks_count: number;
    distinct_sku_count: number;
    last_fetch: string | null;
    fbo_count: number;
    fbs_count: number;
  };
  const diagRows = toRows<DiagRow>(
    await db.execute<DiagRow>(sql`
      SELECT
        COUNT(*) FILTER (WHERE ${srcMatch})::int AS warehouse_stocks_count,
        COUNT(DISTINCT ws.sku) FILTER (WHERE ${srcMatch})::int AS distinct_sku_count,
        (MAX(ws.fetched_at) FILTER (WHERE ${srcMatch}))::text AS last_fetch,
        COUNT(*) FILTER (WHERE ws.source = 'FBO')::int AS fbo_count,
        COUNT(*) FILTER (WHERE ws.source = 'FBS')::int AS fbs_count
      FROM ${ozonWarehouseStocks} ws
      WHERE ws.tenant_id = ${tenantId}
        ${accountCondStocks}
    `),
  );
  const warehouseStocksCount = Number(diagRows[0]?.warehouse_stocks_count ?? 0);
  // Глобальный distinct: сумма per-cluster distinct задваивала бы SKU,
  // которые лежат сразу в нескольких кластерах.
  const distinctSkuCount = Number(diagRows[0]?.distinct_sku_count ?? 0);
  const lastWarehouseStocksFetchAt = diagRows[0]?.last_fetch ?? null;
  const bySource = {
    fbo: Number(diagRows[0]?.fbo_count ?? 0),
    fbs: Number(diagRows[0]?.fbs_count ?? 0),
  };

  type ClusterCountRow = { clusters_count: number };
  const clusterCountRows = toRows<ClusterCountRow>(
    await db.execute<ClusterCountRow>(sql`
      SELECT COUNT(*)::int AS clusters_count
      FROM ${ozonClusters} c
      WHERE c.tenant_id = ${tenantId}
        ${accountCondClusters}
    `),
  );
  const clustersCount = Number(clusterCountRows[0]?.clusters_count ?? 0);

  // `source` в GROUP BY: у FBS-строк cluster_id всегда NULL, и без источника
  // они слились бы с нерезолвнутыми FBO в одну строку «Без кластера».
  type StockAggRow = {
    cluster_id: string | null;
    cluster_name: string | null;
    cluster_type: string | null;
    source: StockSource;
    free: number;
    promised: number;
    reserved: number;
    sku_count: number;
  };
  const stockAggRows = toRows<StockAggRow>(
    await db.execute<StockAggRow>(sql`
      SELECT
        ws.cluster_id AS cluster_id,
        ws.cluster_name AS cluster_name,
        ws.cluster_type AS cluster_type,
        ws.source AS source,
        COALESCE(SUM(ws.free_to_sell_amount), 0)::bigint AS free,
        COALESCE(SUM(ws.promised_amount), 0)::bigint AS promised,
        COALESCE(SUM(ws.reserved_amount), 0)::bigint AS reserved,
        COUNT(DISTINCT ws.sku)::int AS sku_count
      FROM ${ozonWarehouseStocks} ws
      WHERE ws.tenant_id = ${tenantId}
        ${accountCondStocks}
        ${sourceCondStocks}
      GROUP BY ws.cluster_id, ws.cluster_name, ws.cluster_type, ws.source
    `),
  );
  const stocks: ClusterStockAgg[] = stockAggRows.map((r) => ({
    clusterId: r.cluster_id,
    clusterName: r.cluster_name,
    clusterType: r.cluster_type,
    source: r.source === 'FBS' ? 'FBS' : 'FBO',
    free: Number(r.free ?? 0),
    promised: Number(r.promised ?? 0),
    reserved: Number(r.reserved ?? 0),
    skuCount: Number(r.sku_count ?? 0),
  }));

  // Разрез по складам: тот же снапшот, но GROUP BY доходит до склада.
  // Отдельный запрос (а не пересчёт cluster-агрегата в Node) нужен ради
  // честного COUNT(DISTINCT sku) на каждом уровне: один SKU лежит на
  // нескольких складах, поэтому per-warehouse distinct не складывается в
  // per-cluster distinct.
  let warehouseStocks: WarehouseStockAgg[] = [];
  if (groupBy === 'warehouse') {
    type WarehouseStockRow = {
      warehouse_name: string;
      cluster_id: string | null;
      cluster_name: string | null;
      cluster_type: string | null;
      source: StockSource;
      free: number;
      promised: number;
      reserved: number;
      sku_count: number;
    };
    const warehouseStockRows = toRows<WarehouseStockRow>(
      await db.execute<WarehouseStockRow>(sql`
        SELECT
          ws.warehouse_name AS warehouse_name,
          ws.cluster_id AS cluster_id,
          ws.cluster_name AS cluster_name,
          ws.cluster_type AS cluster_type,
          ws.source AS source,
          COALESCE(SUM(ws.free_to_sell_amount), 0)::bigint AS free,
          COALESCE(SUM(ws.promised_amount), 0)::bigint AS promised,
          COALESCE(SUM(ws.reserved_amount), 0)::bigint AS reserved,
          COUNT(DISTINCT ws.sku)::int AS sku_count
        FROM ${ozonWarehouseStocks} ws
        WHERE ws.tenant_id = ${tenantId}
          ${accountCondStocks}
          ${sourceCondStocks}
        GROUP BY ws.warehouse_name, ws.cluster_id, ws.cluster_name, ws.cluster_type, ws.source
      `),
    );
    warehouseStocks = warehouseStockRows.map((r) => ({
      warehouseName: r.warehouse_name,
      clusterId: r.cluster_id,
      clusterName: r.cluster_name,
      clusterType: r.cluster_type,
      source: r.source === 'FBS' ? 'FBS' : 'FBO',
      free: Number(r.free ?? 0),
      promised: Number(r.promised ?? 0),
      reserved: Number(r.reserved ?? 0),
      skuCount: Number(r.sku_count ?? 0),
    }));
  }

  // Опц. продажи за период. SQL только группирует заказы по СЫРОМУ имени
  // склада (десятки строк) — резолв склад→кластер делается в Node.
  let resolvedOrders: ResolvedOrders | null = null;
  let warehouseOrders: WarehouseOrdersBucket[] | null = null;
  if (hasPeriod && fromIso && toIso) {
    type OrderWarehouseRow = {
      warehouse_name: string | null;
      orders: number;
      revenue_rub: number;
    };
    const ordersRows = toRows<OrderWarehouseRow>(
      await db.execute<OrderWarehouseRow>(sql`
        SELECT
          NULLIF(
            btrim(
              COALESCE(
                o.raw->'analytics_data'->>'warehouse_name',
                -- legacy-путь: живых данных с ним нет, оставлен как страховка
                o.raw->>'warehouseName',
                ''
              )
            ),
            ''
          ) AS warehouse_name,
          COUNT(DISTINCT o.id)::int AS orders,
          COALESCE(
            SUM(
              COALESCE(NULLIF(it->>'price', '')::numeric, 0)
              * COALESCE(NULLIF(it->>'quantity', '')::numeric, 0)
            ),
            0
          )::numeric AS revenue_rub
        FROM ${ozonOrders} o
        CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
        WHERE o.tenant_id = ${tenantId}
          ${accountCondOrders}
          ${sourceCondOrders}
          AND o.order_created_at >= ${fromIso}::timestamp
          AND o.order_created_at < ${toIso}::timestamp
          AND o.cancelled_at IS NULL
          AND o.returned_at IS NULL
        GROUP BY 1
      `),
    );

    // Справочник кластеров — главный источник резолва (свежий, покрывает все
    // склады Ozon, а не только те, где сейчас лежит товар).
    const directory = await loadWarehouseClusterMap(tenantId, accountId);

    // Снапшот остатков — fallback на случай устаревшего/неполного справочника.
    type WarehouseRow = {
      warehouse_name: string;
      cluster_id: string | null;
      cluster_name: string | null;
      cluster_type: string | null;
    };
    const warehouseRows = toRows<WarehouseRow>(
      await db.execute<WarehouseRow>(sql`
        SELECT DISTINCT
          ws.warehouse_name AS warehouse_name,
          ws.cluster_id AS cluster_id,
          ws.cluster_name AS cluster_name,
          ws.cluster_type AS cluster_type
        FROM ${ozonWarehouseStocks} ws
        WHERE ws.tenant_id = ${tenantId}
          ${accountCondStocks}
          AND ws.cluster_id IS NOT NULL
      `),
    );
    const stockFallback = new Map<string, ClusterRef>();
    for (const w of warehouseRows) {
      const key = normalizeWarehouseName(w.warehouse_name);
      if (!key || !w.cluster_id) continue;
      stockFallback.set(key, {
        clusterId: w.cluster_id,
        clusterName: w.cluster_name ?? `Кластер ${w.cluster_id}`,
        clusterType: w.cluster_type,
      });
    }

    // Имена собственных складов продавца: заказ с такого склада должен лечь
    // в ту же строку «FBS», где лежит его остаток, а не в «Без кластера»
    // (в справочник кластеров Ozon свои склады не входят).
    // При `source='FBO'` набор не нужен — FBS-заказы уже отфильтрованы.
    const fbsWarehouses = new Set<string>();
    if (source !== 'FBO') {
      type FbsWarehouseRow = { warehouse_name: string };
      const fbsRows = toRows<FbsWarehouseRow>(
        await db.execute<FbsWarehouseRow>(sql`
          SELECT DISTINCT ws.warehouse_name AS warehouse_name
          FROM ${ozonWarehouseStocks} ws
          WHERE ws.tenant_id = ${tenantId}
            ${accountCondStocks}
            AND ws.source = 'FBS'
        `),
      );
      for (const r of fbsRows) {
        const key = normalizeWarehouseName(r.warehouse_name);
        if (key) fbsWarehouses.add(key);
      }
    }

    const ordersByWarehouse: OrdersByWarehouse[] = ordersRows.map((r) => ({
      warehouseName: r.warehouse_name,
      orders: Number(r.orders ?? 0),
      revenueRub: Number(r.revenue_rub ?? 0),
    }));
    // Один резолв на оба разреза: cluster-агрегат — свёртка warehouse-агрегата,
    // поэтому groupBy='cluster' и groupBy='warehouse' не могут разъехаться.
    warehouseOrders = resolveOrdersToWarehouses(
      ordersByWarehouse,
      directory,
      stockFallback,
      fbsWarehouses,
    );
    resolvedOrders = foldWarehouseOrdersToClusters(warehouseOrders);
  }

  const clusterRows = buildClusterRows(stocks, resolvedOrders);
  const rows =
    groupBy === 'warehouse'
      ? attachWarehousesToClusters(clusterRows, warehouseStocks, warehouseOrders, {
          limitPerCluster: args.warehouseLimit ?? DEFAULT_WAREHOUSE_LIMIT,
          sortKey: args.warehouseSort,
          sortDir: args.warehouseSortDir,
        })
      : clusterRows;

  // Диагностика объединения «склады с остатком ∪ склады с заказами».
  let warehousesMeta: OzonClusterStocksMeta['warehouses'] = null;
  if (groupBy === 'warehouse') {
    const withStock = new Set<string>();
    for (const s of warehouseStocks) {
      const key = normalizeWarehouseName(s.warehouseName);
      if (key) withStock.add(key);
    }
    const withOrders = new Set<string>();
    for (const b of warehouseOrders ?? []) {
      // `''` — заказ вообще без склада (FBS-постинг), это не склад.
      if (b.warehouseKey) withOrders.add(b.warehouseKey);
    }
    let soldOutWithOrders = 0;
    for (const key of withOrders) if (!withStock.has(key)) soldOutWithOrders += 1;
    warehousesMeta = {
      total: new Set([...withStock, ...withOrders]).size,
      withStock: withStock.size,
      withOrders: withOrders.size,
      soldOutWithOrders,
    };
  }

  const totals = rows.reduce<OzonClusterStocksTotals>(
    (acc, r) => {
      acc.freeStock += r.freeStock;
      acc.promisedStock += r.promisedStock;
      acc.reservedStock += r.reservedStock;
      acc.totalStock += r.totalStock;
      acc.ordersInPeriod += r.ordersInPeriod;
      acc.revenueInPeriod += r.revenueInPeriod;
      return acc;
    },
    {
      freeStock: 0,
      promisedStock: 0,
      reservedStock: 0,
      totalStock: 0,
      // НЕ сумма по строкам: один SKU лежит в нескольких кластерах.
      skuCount: distinctSkuCount,
      ordersInPeriod: 0,
      revenueInPeriod: 0,
    },
  );

  return {
    rows,
    totals,
    groupBy,
    meta: {
      warehouseStocksCount,
      clustersCount,
      lastWarehouseStocksFetchAt,
      warehouses: warehousesMeta,
      bySource,
      source,
      unresolved: {
        unknownWarehouseOrders: resolvedOrders?.unknownWarehouse.orders ?? 0,
        unknownWarehouseRevenue: resolvedOrders?.unknownWarehouse.revenue ?? 0,
        noWarehouseOrders: resolvedOrders?.noWarehouse.orders ?? 0,
        noWarehouseRevenue: resolvedOrders?.noWarehouse.revenue ?? 0,
        warehouses: resolvedOrders?.unresolvedWarehouses ?? [],
      },
    },
  };
}
