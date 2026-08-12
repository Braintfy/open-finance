// PURPOSE: Pure-хелперы агрегации блока «Ozon · Остатки по кластерам».
// Резолвят склад заказа → кластер и сливают два независимых источника
// в один набор строк: снапшот остатков (ozon_warehouse_stocks) и заказы
// периода (ozon_orders). Логика вынесена из route.ts, чтобы её можно было
// прогонять тестом (`scripts/test-ozon-cluster-agg.ts`) без auth/HTTP.
//
// Почему нормализация имени склада живёт в JS, а не в SQL:
// дев/прод БД созданы с `--locale=C`, и Postgres `lower()` в C-локали
// НЕ приводит кириллицу к нижнему регистру
// (`lower('Екатеринбург_РФЦ') <> lower('ЕКАТЕРИНБУРГ_РФЦ')`).
// JS `String.prototype.toLowerCase()` — Unicode-aware, поэтому весь
// матчинг склад→кластер делается в Node. Тот же приём уже используется
// в `sync/clusters.ts::loadWarehouseClusterMap` и `sync/warehouse-stocks.ts`.

/** Строка-заглушка для остатков/заказов, чей склад не нашёлся в справочнике. */
export const NO_CLUSTER_ROW_KEY = '__no_cluster__';
/** Строка-заглушка для заказов, у которых склад вообще не указан (FBS). */
export const NO_WAREHOUSE_ROW_KEY = '__no_warehouse__';
/**
 * Псевдо-кластер для собственных складов продавца (Этап 2b).
 *
 * FBS-склады физически не входят в географические кластеры Ozon
 * (`/v1/cluster/list` — это карта фулфилмента Ozon), поэтому в «настоящий»
 * кластер они не резолвятся никогда. Если бы они падали в «Без кластера»,
 * эта строка смешивала бы два разных смысла: «склад Ozon, которого нет в
 * справочнике» (проблема данных, чинится стейджем `clusters`) и «свой склад
 * продавца» (нормальное состояние). Поэтому у них отдельная строка.
 */
export const FBS_ROW_KEY = '__fbs__';

export const NO_CLUSTER_LABEL = 'Без кластера';
export const NO_WAREHOUSE_LABEL = 'Склад не указан';
export const FBS_LABEL = 'FBS (свои склады)';

/** Источник остатка: фулфилмент Ozon или собственный склад продавца. */
export type StockSource = 'FBO' | 'FBS';
/** Фильтр блока/API: `'all'` — оба источника вместе. */
export type StockSourceFilter = 'all' | StockSource;

export function isStockSourceFilter(v: string): v is StockSourceFilter {
  return v === 'all' || v === 'FBO' || v === 'FBS';
}

/**
 * Единая нормализация имени склада для матчинга между источниками.
 *
 * Ozon пишет одно и то же имя по-разному в разных эндпоинтах:
 *  - регистр: `stock_on_warehouses` → «Новосибирск_РФЦ_НОВЫЙ»,
 *    `posting.analytics_data` → «НОВОСИБИРСК_РФЦ_НОВЫЙ»;
 *  - разделители: `cluster/list` → «Ростов_на_Дону_РФЦ»,
 *    postings → «РОСТОВ-НА-ДОНУ_РФЦ»; встречается и пробел
 *    («НИЖНИЙ НОВГОРОД_СППЗ_ГЕНКИНОЙ»).
 *
 * Поэтому схлопываем любую цепочку `[пробел|_|-]` в один `_`. Проверено на
 * боевом справочнике (749 имён): нормализация не склеивает НИ ОДНОЙ пары
 * имён внутри справочника (749 → 749 ключей) и не даёт ни одного ключа,
 * указывающего на два разных кластера.
 */
export function normalizeWarehouseName(name: string | null | undefined): string {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '_');
}

export type ClusterRef = {
  clusterId: string;
  clusterName: string;
  clusterType: string | null;
  /**
   * Каноническое имя склада из справочника (в том регистре, в котором его
   * отдаёт `cluster/list`). Нужно только режиму `groupBy='warehouse'`, чтобы
   * показывать «Екатеринбург_РФЦ_НОВЫЙ», а не «ЕКАТЕРИНБУРГ_РФЦ_НОВЫЙ» из
   * постингов. На резолв кластера не влияет.
   */
  warehouseName?: string;
};

/** Агрегат остатков по кластеру (из ozon_warehouse_stocks). */
export type ClusterStockAgg = {
  clusterId: string | null;
  clusterName: string | null;
  clusterType: string | null;
  free: number;
  promised: number;
  reserved: number;
  /** COUNT(DISTINCT sku) внутри кластера. */
  skuCount: number;
  /** `'FBS'` уводит строку в псевдо-кластер «FBS». По умолчанию 'FBO'. */
  source?: StockSource;
};

/** Заказы периода, сгруппированные по имени склада (сырое имя из raw). */
export type OrdersByWarehouse = {
  warehouseName: string | null;
  orders: number;
  revenueRub: number;
};

type Bucket = { orders: number; revenue: number };

export type ResolvedOrders = {
  /** clusterId → заказы/выручка. */
  byClusterId: Map<string, Bucket>;
  /** Склад известен, но не нашёлся ни в справочнике, ни в снапшоте остатков. */
  unknownWarehouse: Bucket;
  /** Склад не указан вовсе (FBS-постинги без analytics_data). */
  noWarehouse: Bucket;
  /** Заказы со складов продавца (псевдо-кластер «FBS»). */
  fbs: Bucket;
  /** Имена складов, которые не удалось сопоставить (для диагностики в meta). */
  unresolvedWarehouses: string[];
  /** Справочные данные кластеров, встреченных при резолве (для строк без остатков). */
  refs: Map<string, ClusterRef>;
};

function emptyBucket(): Bucket {
  return { orders: 0, revenue: 0 };
}

function addTo(bucket: Bucket, orders: number, revenue: number): void {
  bucket.orders += orders;
  bucket.revenue += revenue;
}

/** Заказы периода, схлопнутые до пары (кластер, склад). */
export type WarehouseOrdersBucket = {
  /** Ключ строки кластера: `clusterId` | `__no_cluster__` | `__no_warehouse__`. */
  rowKey: string;
  clusterId: string | null;
  clusterName: string;
  clusterType: string | null;
  /** Нормализованное имя склада (`''` — склада в заказе нет вовсе). */
  warehouseKey: string;
  /** Имя склада для показа: каноническое из справочника, иначе сырое. */
  warehouseName: string;
  orders: number;
  revenue: number;
};

/**
 * Раскладывает заказы периода по ПАРАМ (кластер, склад) — самый детальный
 * уровень. `resolveOrdersToClusters()` — свёртка этого же результата, поэтому
 * режимы `groupBy='cluster'` и `groupBy='warehouse'` физически не могут
 * разъехаться в цифрах.
 *
 * Приоритет резолва:
 *  1. `directory` — свежий справочник `ozon_clusters` (склад→кластер).
 *     Это главный источник: он покрывает ВСЕ склады Ozon, а не только те,
 *     где у продавца сейчас лежит товар.
 *  2. `stockFallback` — снапшот `ozon_warehouse_stocks.cluster_id`. Нужен
 *     если стейдж `clusters` ещё не гонялся или справочник неполный
 *     (например, CIS-кластеры на аккаунте без доступа к CLUSTER_TYPE_CIS).
 *
 * Раньше резолв шёл ТОЛЬКО через снапшот остатков — из-за этого любой склад,
 * с которого были продажи, но нет текущего остатка, падал в «Без кластера».
 *
 * `fbsWarehouses` (Этап 2b) — нормализованные имена собственных складов
 * продавца (из снапшота `source='FBS'`). Проверяется ПЕРЕД справочником:
 * иначе заказ с FBS-склада оседал бы в «Без кластера», пока его остаток
 * лежит в строке «FBS», и одна и та же физическая точка была бы разорвана
 * между двумя строками таблицы.
 */
export function resolveOrdersToWarehouses(
  rows: OrdersByWarehouse[],
  directory: Map<string, ClusterRef>,
  stockFallback: Map<string, ClusterRef>,
  fbsWarehouses?: ReadonlySet<string>,
): WarehouseOrdersBucket[] {
  // Один и тот же склад приходит из SQL несколькими строками (разный регистр
  // сырого имени) — схлопываем по нормализованному ключу.
  const out = new Map<string, WarehouseOrdersBucket>();

  for (const row of rows) {
    const orders = Number(row.orders ?? 0);
    const revenue = Number(row.revenueRub ?? 0);
    const warehouseKey = normalizeWarehouseName(row.warehouseName);
    const rawName = (row.warehouseName ?? '').trim();

    let seed: Omit<WarehouseOrdersBucket, 'orders' | 'revenue'>;
    if (!warehouseKey) {
      seed = {
        rowKey: NO_WAREHOUSE_ROW_KEY,
        clusterId: null,
        clusterName: NO_WAREHOUSE_LABEL,
        clusterType: null,
        warehouseKey: '',
        warehouseName: NO_WAREHOUSE_LABEL,
      };
    } else if (fbsWarehouses?.has(warehouseKey)) {
      seed = {
        rowKey: FBS_ROW_KEY,
        clusterId: null,
        clusterName: FBS_LABEL,
        clusterType: null,
        warehouseKey,
        warehouseName: rawName,
      };
    } else {
      const ref = directory.get(warehouseKey) ?? stockFallback.get(warehouseKey) ?? null;
      seed = ref
        ? {
            rowKey: ref.clusterId,
            clusterId: ref.clusterId,
            clusterName: ref.clusterName,
            clusterType: ref.clusterType,
            warehouseKey,
            warehouseName: ref.warehouseName ?? rawName,
          }
        : {
            rowKey: NO_CLUSTER_ROW_KEY,
            clusterId: null,
            clusterName: NO_CLUSTER_LABEL,
            clusterType: null,
            warehouseKey,
            warehouseName: rawName,
          };
    }

    const mapKey = `${seed.rowKey}\x00${seed.warehouseKey}`;
    let bucket = out.get(mapKey);
    if (!bucket) {
      bucket = { ...seed, orders: 0, revenue: 0 };
      out.set(mapKey, bucket);
    }
    bucket.orders += orders;
    bucket.revenue += revenue;
  }

  return Array.from(out.values());
}

/** Свёртка пар (кластер, склад) до кластеров. */
export function foldWarehouseOrdersToClusters(
  buckets: WarehouseOrdersBucket[],
): ResolvedOrders {
  const byClusterId = new Map<string, Bucket>();
  const refs = new Map<string, ClusterRef>();
  const unknownWarehouse = emptyBucket();
  const noWarehouse = emptyBucket();
  const fbs = emptyBucket();
  const unresolved = new Set<string>();

  for (const b of buckets) {
    if (b.rowKey === NO_WAREHOUSE_ROW_KEY) {
      addTo(noWarehouse, b.orders, b.revenue);
      continue;
    }
    if (b.rowKey === FBS_ROW_KEY) {
      addTo(fbs, b.orders, b.revenue);
      continue;
    }
    if (b.rowKey === NO_CLUSTER_ROW_KEY) {
      addTo(unknownWarehouse, b.orders, b.revenue);
      if (b.warehouseName) unresolved.add(b.warehouseName);
      continue;
    }
    const clusterId = b.clusterId as string;
    if (!refs.has(clusterId)) {
      refs.set(clusterId, {
        clusterId,
        clusterName: b.clusterName,
        clusterType: b.clusterType,
      });
    }
    let bucket = byClusterId.get(clusterId);
    if (!bucket) {
      bucket = emptyBucket();
      byClusterId.set(clusterId, bucket);
    }
    addTo(bucket, b.orders, b.revenue);
  }

  return {
    byClusterId,
    unknownWarehouse,
    noWarehouse,
    fbs,
    unresolvedWarehouses: Array.from(unresolved).sort(),
    refs,
  };
}

/** Раскладывает заказы периода по кластерам (свёртка `resolveOrdersToWarehouses`). */
export function resolveOrdersToClusters(
  rows: OrdersByWarehouse[],
  directory: Map<string, ClusterRef>,
  stockFallback: Map<string, ClusterRef>,
  fbsWarehouses?: ReadonlySet<string>,
): ResolvedOrders {
  return foldWarehouseOrdersToClusters(
    resolveOrdersToWarehouses(rows, directory, stockFallback, fbsWarehouses),
  );
}

/** Агрегат остатков по конкретному складу (из ozon_warehouse_stocks). */
export type WarehouseStockAgg = {
  warehouseName: string;
  clusterId: string | null;
  clusterName: string | null;
  clusterType: string | null;
  free: number;
  promised: number;
  reserved: number;
  /** COUNT(DISTINCT sku) в пределах склада. */
  skuCount: number;
  /** `'FBS'` уводит склад в псевдо-кластер «FBS». По умолчанию 'FBO'. */
  source?: StockSource;
};

/**
 * Ключ строки-кластера для агрегата остатков.
 *
 * Единая точка для обоих разрезов: `buildClusterRows` (кластеры) и
 * `attachWarehousesToClusters` (склады) обязаны раскладывать один и тот же
 * остаток в одну и ту же строку, иначе Σ складов перестанет сходиться
 * с кластером.
 */
function stockRowKey(s: { clusterId: string | null; source?: StockSource }): string {
  if (s.clusterId) return s.clusterId;
  return s.source === 'FBS' ? FBS_ROW_KEY : NO_CLUSTER_ROW_KEY;
}

/** Строка склада внутри кластера (`groupBy='warehouse'`). */
export type WarehouseAggRow = {
  warehouseName: string;
  freeStock: number;
  promisedStock: number;
  reservedStock: number;
  totalStock: number;
  /**
   * Уникальных SKU на складе. ВНИМАНИЕ: сумма по складам кластера ≥ skuCount
   * кластера — один SKU лежит на нескольких складах. Единственная метрика,
   * которая НЕ складывается (остальные складываются точно).
   */
  skuCount: number;
  ordersInPeriod: number;
  revenueInPeriod: number;
  /** Доля от ОБЩЕГО остатка (тот же знаменатель, что у кластеров). */
  sharePct: number;
};

/** Свёрнутый «хвост» складов, не попавших в топ-N. */
export type HiddenWarehousesAgg = Omit<WarehouseAggRow, 'warehouseName'> & {
  count: number;
};

/** Метрики склада, по которым сервер отбирает топ-N. */
export const WAREHOUSE_SORT_KEYS = [
  'warehouseName',
  'totalStock',
  'freeStock',
  'reservedStock',
  'promisedStock',
  'skuCount',
  'ordersInPeriod',
  'revenueInPeriod',
] as const;
export type WarehouseSortKey = (typeof WAREHOUSE_SORT_KEYS)[number];

export function isWarehouseSortKey(v: string): v is WarehouseSortKey {
  return (WAREHOUSE_SORT_KEYS as readonly string[]).includes(v);
}

/** Дефолтный лимит складов на кластер: у крупных продавцов их сотни. */
export const DEFAULT_WAREHOUSE_LIMIT = 20;
export const MAX_WAREHOUSE_LIMIT = 200;

export type ClusterAggRow = {
  /**
   * Стабильный ключ строки: `clusterId` либо `__no_cluster__` /
   * `__no_warehouse__`. У обеих псевдо-строк `clusterId === null`, поэтому
   * различить их можно только по нему (React key, привязка складов, expand).
   */
  rowKey: string;
  clusterId: string | null;
  clusterName: string;
  clusterType: string | null;
  freeStock: number;
  promisedStock: number;
  reservedStock: number;
  totalStock: number;
  /** Уникальных SKU в кластере (COUNT DISTINCT, не число строк sku×склад). */
  skuCount: number;
  ordersInPeriod: number;
  revenueInPeriod: number;
  sharePct: number;
  /** Заполняется только при `groupBy='warehouse'` (топ-N по выбранной метрике). */
  warehouses?: WarehouseAggRow[];
  /** Всего складов в кластере ДО применения лимита. */
  warehousesTotal?: number;
  /** Свёрнутый хвост сверх лимита (`null`, если всё поместилось). */
  hiddenWarehouses?: HiddenWarehousesAgg | null;
};

/**
 * Сливает остатки и заказы в итоговый набор строк.
 *
 * Множество строк = кластеры с остатком ∪ кластеры с заказами за период.
 * Без объединения выручка кластеров, где товар распродан в ноль, просто
 * исчезала бы из ответа и `totals.revenueInPeriod` не сходился с фактом.
 *
 * Три отдельные псевдо-строки вместо прежней общей «Без кластера»:
 *  - «Без кластера»     — склад известен, но его нет в справочнике кластеров;
 *  - «Склад не указан»  — у заказа вообще нет имени склада (FBS-постинги
 *    без `analytics_data`);
 *  - «FBS (свои склады)» — собственные склады продавца (Этап 2b): в кластеры
 *    Ozon они не входят по своей природе, а не из-за пробела в данных.
 */
export function buildClusterRows(
  stocks: ClusterStockAgg[],
  orders: ResolvedOrders | null,
): ClusterAggRow[] {
  const rows = new Map<string, ClusterAggRow>();

  const ensure = (
    key: string,
    seed: Pick<ClusterAggRow, 'clusterId' | 'clusterName' | 'clusterType'>,
  ): ClusterAggRow => {
    let row = rows.get(key);
    if (!row) {
      row = {
        rowKey: key,
        ...seed,
        freeStock: 0,
        promisedStock: 0,
        reservedStock: 0,
        totalStock: 0,
        skuCount: 0,
        ordersInPeriod: 0,
        revenueInPeriod: 0,
        sharePct: 0,
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const s of stocks) {
    const key = stockRowKey(s);
    const row = ensure(key, {
      clusterId: s.clusterId,
      clusterName: s.clusterId
        ? s.clusterName ?? `Кластер ${s.clusterId}`
        : key === FBS_ROW_KEY
          ? FBS_LABEL
          : NO_CLUSTER_LABEL,
      clusterType: s.clusterType,
    });
    row.freeStock += Number(s.free ?? 0);
    row.promisedStock += Number(s.promised ?? 0);
    row.reservedStock += Number(s.reserved ?? 0);
    row.skuCount += Number(s.skuCount ?? 0);
  }

  if (orders) {
    for (const [clusterId, bucket] of orders.byClusterId) {
      const ref = orders.refs.get(clusterId) ?? null;
      const row = ensure(clusterId, {
        clusterId,
        clusterName: ref?.clusterName ?? `Кластер ${clusterId}`,
        clusterType: ref?.clusterType ?? null,
      });
      row.ordersInPeriod += bucket.orders;
      row.revenueInPeriod += bucket.revenue;
    }

    if (orders.unknownWarehouse.orders > 0 || orders.unknownWarehouse.revenue > 0) {
      const row = ensure(NO_CLUSTER_ROW_KEY, {
        clusterId: null,
        clusterName: NO_CLUSTER_LABEL,
        clusterType: null,
      });
      row.ordersInPeriod += orders.unknownWarehouse.orders;
      row.revenueInPeriod += orders.unknownWarehouse.revenue;
    }

    if (orders.noWarehouse.orders > 0 || orders.noWarehouse.revenue > 0) {
      const row = ensure(NO_WAREHOUSE_ROW_KEY, {
        clusterId: null,
        clusterName: NO_WAREHOUSE_LABEL,
        clusterType: null,
      });
      row.ordersInPeriod += orders.noWarehouse.orders;
      row.revenueInPeriod += orders.noWarehouse.revenue;
    }

    if (orders.fbs.orders > 0 || orders.fbs.revenue > 0) {
      const row = ensure(FBS_ROW_KEY, {
        clusterId: null,
        clusterName: FBS_LABEL,
        clusterType: null,
      });
      row.ordersInPeriod += orders.fbs.orders;
      row.revenueInPeriod += orders.fbs.revenue;
    }
  }

  const out = Array.from(rows.values());
  let grandTotal = 0;
  for (const row of out) {
    row.totalStock = row.freeStock + row.promisedStock + row.reservedStock;
    grandTotal += row.totalStock;
  }
  for (const row of out) {
    row.sharePct = grandTotal > 0 ? (row.totalStock / grandTotal) * 100 : 0;
  }

  out.sort(
    (a, b) => b.totalStock - a.totalStock || b.revenueInPeriod - a.revenueInPeriod,
  );
  return out;
}

function emptyWarehouseRow(warehouseName: string): WarehouseAggRow {
  return {
    warehouseName,
    freeStock: 0,
    promisedStock: 0,
    reservedStock: 0,
    totalStock: 0,
    skuCount: 0,
    ordersInPeriod: 0,
    revenueInPeriod: 0,
    sharePct: 0,
  };
}

function compareWarehouses(
  a: WarehouseAggRow,
  b: WarehouseAggRow,
  key: WarehouseSortKey,
  dir: 'asc' | 'desc',
): number {
  if (key === 'warehouseName') {
    const cmp = a.warehouseName.localeCompare(b.warehouseName, 'ru');
    return dir === 'asc' ? cmp : -cmp;
  }
  const av = a[key];
  const bv = b[key];
  const cmp = av - bv;
  if (cmp !== 0) return dir === 'asc' ? cmp : -cmp;
  // Тай-брейк не зависит от направления — сортировка стабильна между запросами.
  return (
    b.totalStock - a.totalStock ||
    b.revenueInPeriod - a.revenueInPeriod ||
    a.warehouseName.localeCompare(b.warehouseName, 'ru')
  );
}

/**
 * Достраивает к строкам кластеров разрез по складам (`groupBy='warehouse'`).
 *
 * Инвариант: строки кластеров приходят из `buildClusterRows()` и НЕ
 * пересчитываются — цифры кластеров при `groupBy='warehouse'` побитово те же,
 * что при `groupBy='cluster'`. Склады лишь распределяют их внутри кластера:
 * Σ(показанные склады) + hiddenWarehouses == кластер (кроме `skuCount`, см.
 * `WarehouseAggRow.skuCount`).
 *
 * Множество складов кластера = склады с остатком ∪ склады с заказами периода,
 * поэтому склад, выбитый в ноль, но продававший, остаётся видимым (остаток 0,
 * выручка > 0). Привязка склада к кластеру: у остатков — `ws.cluster_id`
 * снапшота (тот же источник, что у cluster-агрегата), у заказов — резолв
 * справочником (`resolveOrdersToWarehouses`).
 *
 * Лимит: у крупных продавцов складов сотни, поэтому отдаём топ-N по ТОЙ ЖЕ
 * метрике, по которой пользователь сортирует таблицу (иначе склад с нулевым
 * остатком и большой выручкой обрезался бы при сортировке по выручке).
 */
export function attachWarehousesToClusters(
  clusterRows: ClusterAggRow[],
  stocks: WarehouseStockAgg[],
  orders: WarehouseOrdersBucket[] | null,
  opts?: {
    limitPerCluster?: number;
    sortKey?: WarehouseSortKey;
    sortDir?: 'asc' | 'desc';
  },
): ClusterAggRow[] {
  const limit = Math.max(
    1,
    Math.min(MAX_WAREHOUSE_LIMIT, opts?.limitPerCluster ?? DEFAULT_WAREHOUSE_LIMIT),
  );
  const sortKey: WarehouseSortKey = opts?.sortKey ?? 'totalStock';
  const sortDir: 'asc' | 'desc' = opts?.sortDir ?? 'desc';

  // rowKey кластера → нормализованное имя склада → строка склада.
  const byRow = new Map<string, Map<string, WarehouseAggRow>>();
  const ensure = (
    rowKey: string,
    warehouseKey: string,
    displayName: string,
  ): WarehouseAggRow => {
    let group = byRow.get(rowKey);
    if (!group) {
      group = new Map();
      byRow.set(rowKey, group);
    }
    let row = group.get(warehouseKey);
    if (!row) {
      row = emptyWarehouseRow(displayName);
      group.set(warehouseKey, row);
    }
    return row;
  };

  for (const s of stocks) {
    const rowKey = stockRowKey(s);
    const warehouseKey = normalizeWarehouseName(s.warehouseName);
    const row = ensure(rowKey, warehouseKey, (s.warehouseName ?? '').trim() || '—');
    row.freeStock += Number(s.free ?? 0);
    row.promisedStock += Number(s.promised ?? 0);
    row.reservedStock += Number(s.reserved ?? 0);
    row.skuCount += Number(s.skuCount ?? 0);
  }

  for (const b of orders ?? []) {
    const row = ensure(b.rowKey, b.warehouseKey, b.warehouseName);
    row.ordersInPeriod += b.orders;
    row.revenueInPeriod += b.revenue;
  }

  let grandTotal = 0;
  for (const row of clusterRows) grandTotal += row.totalStock;

  return clusterRows.map((cluster) => {
    const group = byRow.get(cluster.rowKey);
    const all = group ? Array.from(group.values()) : [];
    for (const w of all) {
      w.totalStock = w.freeStock + w.promisedStock + w.reservedStock;
      w.sharePct = grandTotal > 0 ? (w.totalStock / grandTotal) * 100 : 0;
    }
    all.sort((a, b) => compareWarehouses(a, b, sortKey, sortDir));

    const shown = all.slice(0, limit);
    const rest = all.slice(limit);
    const hidden: HiddenWarehousesAgg | null =
      rest.length === 0
        ? null
        : rest.reduce<HiddenWarehousesAgg>(
            (acc, w) => {
              acc.count += 1;
              acc.freeStock += w.freeStock;
              acc.promisedStock += w.promisedStock;
              acc.reservedStock += w.reservedStock;
              acc.totalStock += w.totalStock;
              acc.skuCount += w.skuCount;
              acc.ordersInPeriod += w.ordersInPeriod;
              acc.revenueInPeriod += w.revenueInPeriod;
              acc.sharePct += w.sharePct;
              return acc;
            },
            {
              count: 0,
              freeStock: 0,
              promisedStock: 0,
              reservedStock: 0,
              totalStock: 0,
              skuCount: 0,
              ordersInPeriod: 0,
              revenueInPeriod: 0,
              sharePct: 0,
            },
          );

    return {
      ...cluster,
      warehouses: shown,
      warehousesTotal: all.length,
      hiddenWarehouses: hidden,
    };
  });
}
