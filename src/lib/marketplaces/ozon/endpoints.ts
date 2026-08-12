// PURPOSE: Типизированные обёртки над Ozon Seller API endpoints.
// Один файл — одна точка для каждого вызова, чтобы при изменении endpoint
// (`/v4` → `/v5` и т.д.) править в одном месте. Используются модулями
// sync/* и API-роутами.
//
// ВАЖНО: при изменении версии endpoint'а или контракта Ozon обновлять:
// 1. этот файл (новая версия пути + новая Zod-схема в types.ts);
// 2. соответствующий sync/*.ts маппинг;
// 3. docs/MARKETPLACES_OZON.md (когда заведём — см. mini-plan в PLAN.md).

import { z } from 'zod';
import { OzonClient, OzonApiError } from './client';
import {
  SellerInfoSchema,
  ProductListResponseSchema,
  ProductInfoListResponseSchema,
  PricesResponseSchema,
  StocksResponseSchema,
  FbsPostingsResponseSchema,
  FboPostingsResponseSchema,
  RealizationResponseSchema,
  TransactionListResponseSchema,
  TurnoverResponseSchema,
  AnalyticsDataResponseSchema,
  StockOnWarehousesResponseSchema,
  WarehouseListResponseSchema,
  StocksByWarehouseFbsResponseSchema,
  type AnalyticsDataResponse,
  type StockOnWarehousesRow,
  type FbsWarehouse,
  type StocksByWarehouseFbsRow,
} from './types';

export const OZON_API_VERSION_MAP = {
  sellerInfo: '/v1/seller/info',
  productList: '/v3/product/list',
  productInfoList: '/v3/product/info/list',
  productInfoPrices: '/v5/product/info/prices',
  productInfoStocks: '/v4/product/info/stocks',
  postingFbsList: '/v3/posting/fbs/list',
  postingFboList: '/v2/posting/fbo/list',
  financeRealization: '/v2/finance/realization',
  financeTransactionList: '/v3/finance/transaction/list',
  analyticsTurnoverStocks: '/v1/analytics/turnover/stocks',
  // v2 заменяет deprecated `/v1/analytics/stock_on_warehouses` (тот же
  // запрос/ответ, новый путь — см. docs.ozon.ru/api/seller).
  analyticsStockOnWarehouses: '/v2/analytics/stock_on_warehouses',
  // Этап 2b LK_V2_PLAN: FBS-склады продавца. `stock_on_warehouses` (выше)
  // отдаёт ТОЛЬКО FBO-склады Ozon, поэтому собственные склады продавца
  // (у крупных селлеров их больше, чем FBO) требуют отдельной пары вызовов:
  // список складов + остатки по ним.
  warehouseList: '/v1/warehouse/list',
  productStocksByWarehouseFbs: '/v1/product/info/stocks-by-warehouse/fbs',
  // Справочник географических кластеров. Раньше пытались бить по
  // Performance API (`/api/client/cluster/list`) — оттуда приходил 404,
  // эндпойнт живёт ТОЛЬКО в Seller API.
  clusterList: '/v1/cluster/list',
  analyticsData: '/v1/analytics/data',
} as const;

/** Все возможные метрики для /v1/analytics/data. */
export const ANALYTICS_METRICS_PREMIUM = [
  'revenue',
  'ordered_units',
  'delivered_units',
  'cancellations',
  'returns',
] as const;

/** Метрики, доступные на базовом тарифе (без Premium Plus). */
export const ANALYTICS_METRICS_BASIC = ['revenue', 'ordered_units'] as const;

export type AnalyticsMetric =
  | 'revenue'
  | 'ordered_units'
  | 'delivered_units'
  | 'cancellations'
  | 'returns';

export type AnalyticsDimension = 'sku' | 'spu' | 'day' | 'week' | 'month';

export async function sellerInfo(client: OzonClient) {
  return client.post(OZON_API_VERSION_MAP.sellerInfo, {}, SellerInfoSchema);
}

export type ProductListFilter = {
  visibility?: 'ALL' | 'VISIBLE' | 'INVISIBLE' | 'EMPTY_STOCK' | 'NOT_MODERATED';
  product_id?: string[];
  offer_id?: string[];
};

export async function productList(
  client: OzonClient,
  args: { filter?: ProductListFilter; last_id?: string; limit?: number },
) {
  return client.post(
    OZON_API_VERSION_MAP.productList,
    {
      filter: args.filter ?? { visibility: 'ALL' },
      last_id: args.last_id ?? '',
      limit: args.limit ?? 1000,
    },
    ProductListResponseSchema,
  );
}

export async function productInfoList(
  client: OzonClient,
  args: { product_id?: number[]; offer_id?: string[]; sku?: number[] },
) {
  return client.post(
    OZON_API_VERSION_MAP.productInfoList,
    {
      product_id: args.product_id ?? [],
      offer_id: args.offer_id ?? [],
      sku: args.sku ?? [],
    },
    ProductInfoListResponseSchema,
  );
}

export async function productInfoPrices(
  client: OzonClient,
  args: { cursor?: string; limit?: number; offer_id?: string[]; product_id?: number[] },
) {
  return client.post(
    OZON_API_VERSION_MAP.productInfoPrices,
    {
      cursor: args.cursor ?? '',
      limit: args.limit ?? 1000,
      filter: {
        offer_id: args.offer_id ?? [],
        product_id: args.product_id ?? [],
        visibility: 'ALL',
      },
    },
    PricesResponseSchema,
  );
}

export async function productInfoStocks(
  client: OzonClient,
  args: { cursor?: string; limit?: number; offer_id?: string[]; product_id?: number[] },
) {
  return client.post(
    OZON_API_VERSION_MAP.productInfoStocks,
    {
      cursor: args.cursor ?? '',
      limit: args.limit ?? 1000,
      filter: {
        offer_id: args.offer_id ?? [],
        product_id: args.product_id ?? [],
        visibility: 'ALL',
      },
    },
    StocksResponseSchema,
  );
}

export async function postingFbsList(
  client: OzonClient,
  args: {
    since: Date;
    to: Date;
    offset?: number;
    limit?: number;
    status?: string;
  },
) {
  return client.post(
    OZON_API_VERSION_MAP.postingFbsList,
    {
      dir: 'DESC',
      filter: {
        since: args.since.toISOString(),
        to: args.to.toISOString(),
        status: args.status ?? '',
      },
      limit: args.limit ?? 1000,
      offset: args.offset ?? 0,
      with: { analytics_data: true, financial_data: true },
    },
    FbsPostingsResponseSchema,
  );
}

export async function postingFboList(
  client: OzonClient,
  args: { since: Date; to: Date; offset?: number; limit?: number },
) {
  return client.post(
    OZON_API_VERSION_MAP.postingFboList,
    {
      dir: 'DESC',
      filter: {
        since: args.since.toISOString(),
        to: args.to.toISOString(),
        status: '',
      },
      limit: args.limit ?? 1000,
      offset: args.offset ?? 0,
      with: { analytics_data: true, financial_data: true },
    },
    FboPostingsResponseSchema,
  );
}

export async function financeRealization(client: OzonClient, args: { date: string }) {
  // date в формате 'YYYY-MM' (Ozon возвращает помесячный отчёт).
  return client.post(
    OZON_API_VERSION_MAP.financeRealization,
    { date: args.date },
    RealizationResponseSchema,
  );
}

export async function financeTransactionList(
  client: OzonClient,
  args: {
    from: Date;
    to: Date;
    page?: number;
    pageSize?: number;
    operationType?: string[];
  },
) {
  return client.post(
    OZON_API_VERSION_MAP.financeTransactionList,
    {
      filter: {
        date: { from: args.from.toISOString(), to: args.to.toISOString() },
        operation_type: args.operationType ?? [],
        posting_number: '',
        transaction_type: 'all',
      },
      page: args.page ?? 1,
      page_size: args.pageSize ?? 1000,
    },
    TransactionListResponseSchema,
  );
}

export async function analyticsTurnoverStocks(
  client: OzonClient,
  args: { cursor?: string; limit?: number; sku?: number[] },
) {
  return client.post(
    OZON_API_VERSION_MAP.analyticsTurnoverStocks,
    {
      cursor: args.cursor ?? '',
      limit: args.limit ?? 1000,
      sku: args.sku ?? [],
    },
    TurnoverResponseSchema,
  );
}

/**
 * Получает остатки по складам через `/v2/analytics/stock_on_warehouses`.
 * Отдаёт строки `(sku, item_code, item_name, warehouse_name, *_amount)` —
 * **по конкретным FBO-складам**. Маппинг склад→географический кластер
 * выполняется отдельно через Seller API `/v1/cluster/list`
 * (см. `getClusterListSeller` ниже).
 *
 * Пагинация — по `offset/limit` (max 1000 на запрос).
 *
 * История путей:
 *  - `/v1/analytics/stock_on_warehouses` — снят с поддержки (404 на новых
 *    аккаунтах).
 *  - `/v2/analytics/stock_on_warehouses` — текущий путь, контракт совпадает
 *    с v1: ответ `{ result: { rows: [...] } }`.
 */
export async function analyticsStockOnWarehouses(
  client: OzonClient,
  args: { limit?: number; offset?: number; warehouseType?: 'ALL' | 'FULFILLMENT' | 'CROSSDOCK' },
): Promise<{ rows: StockOnWarehousesRow[] }> {
  const data = (await client.post(
    OZON_API_VERSION_MAP.analyticsStockOnWarehouses,
    {
      limit: Math.min(Math.max(args.limit ?? 1000, 1), 1000),
      offset: Math.max(args.offset ?? 0, 0),
      warehouse_type: args.warehouseType ?? 'ALL',
    },
    StockOnWarehousesResponseSchema,
  )) as
    | { result?: { rows?: StockOnWarehousesRow[] }; rows?: StockOnWarehousesRow[] }
    | undefined;

  const rows = data?.result?.rows ?? data?.rows ?? [];
  return { rows };
}

// ---- FBS-склады продавца (Этап 2b) ---------------------------------------

/** Нормализованный элемент справочника FBS/rFBS-складов продавца. */
export type FbsWarehouseItem = {
  /** int64 из Ozon, храним строкой (в JSON он приходит и числом, и строкой). */
  warehouseId: string;
  name: string;
  /**
   * `'rFBS'` если склад помечен `is_rfbs`, иначе `'FBS'`. Пишется в
   * `ozon_warehouse_stocks.warehouse_type` — по нему в блоке видно, что
   * склад собственный, а не фулфилмент Ozon.
   */
  warehouseType: 'FBS' | 'rFBS';
  status: string | null;
};

/**
 * Список собственных складов продавца (FBS/rFBS) — Seller API
 * `POST /v1/warehouse/list`. Тело запроса пустое.
 *
 * Ответ у Ozon встречается в трёх формах (все поддержаны схемой):
 * `{result: [...]}`, `{result: {warehouses: [...]}}`, `{warehouses: [...]}`.
 *
 * Клиент намеренно lenient (без `{strict: true}`): схема целиком из
 * `.optional()` + `.passthrough()`, а провал справочника складов не должен
 * ронять весь стейдж — остатки FBS всё равно несут `warehouse_name`.
 */
export async function getFbsWarehouseList(
  client: OzonClient,
): Promise<FbsWarehouseItem[]> {
  const data = (await client.post(
    OZON_API_VERSION_MAP.warehouseList,
    {},
    WarehouseListResponseSchema,
  )) as
    | {
        result?: FbsWarehouse[] | { warehouses?: FbsWarehouse[] };
        warehouses?: FbsWarehouse[];
      }
    | undefined;

  const list: FbsWarehouse[] = Array.isArray(data?.result)
    ? data.result
    : (data?.result as { warehouses?: FbsWarehouse[] } | undefined)?.warehouses ??
      data?.warehouses ??
      [];

  const out: FbsWarehouseItem[] = [];
  for (const w of list) {
    const id = w.warehouse_id !== undefined ? String(w.warehouse_id) : '';
    if (!id) continue;
    out.push({
      warehouseId: id,
      name: (w.name ?? '').trim() || `Склад ${id}`,
      warehouseType: w.is_rfbs === true ? 'rFBS' : 'FBS',
      status: w.status ?? null,
    });
  }
  return out;
}

/**
 * Максимум SKU в одном запросе `/v1/product/info/stocks-by-warehouse/fbs`.
 * Пагинации у метода нет — «страница» задаётся размером списка SKU,
 * поэтому вызывающий код (стейдж) режет свой список на чанки.
 */
export const FBS_STOCKS_SKU_CHUNK = 500;

/** Остаток одного SKU на одном FBS-складе. */
export type FbsWarehouseStockRow = {
  sku: string;
  productId: string | null;
  warehouseId: string;
  warehouseName: string;
  /** Доступно к продаже. */
  present: number;
  reserved: number;
  raw: Record<string, unknown>;
};

/**
 * Остатки по собственным складам продавца — Seller API
 * `POST /v1/product/info/stocks-by-warehouse/fbs`.
 *
 * Вход: массив SKU (int64; отправляем строками — grpc-gateway принимает обе
 * формы). Пагинации нет: сколько SKU передали, столько и обработается,
 * поэтому длинные списки режутся по `FBS_STOCKS_SKU_CHUNK`.
 *
 * Ответ: `{ result: [{ sku | fbs_sku, product_id, present, reserved,
 * warehouse_id, warehouse_name }] }`. `fbs_sku` — legacy-идентификатор до
 * унификации FBO/FBS SKU (2022); читаем `sku`, при его отсутствии — `fbs_sku`.
 * SKU без остатков на FBS в ответе просто не появляются.
 */
export async function getStocksByWarehouseFbs(
  client: OzonClient,
  args: { sku: string[] },
): Promise<FbsWarehouseStockRow[]> {
  if (args.sku.length === 0) return [];
  const data = (await client.post(
    OZON_API_VERSION_MAP.productStocksByWarehouseFbs,
    { sku: args.sku },
    StocksByWarehouseFbsResponseSchema,
  )) as { result?: StocksByWarehouseFbsRow[] } | undefined;

  const rows = data?.result ?? [];
  const out: FbsWarehouseStockRow[] = [];
  for (const r of rows) {
    const skuRaw = r.sku ?? r.fbs_sku;
    const sku = skuRaw !== undefined && skuRaw !== null ? String(skuRaw) : '';
    const warehouseId = r.warehouse_id !== undefined ? String(r.warehouse_id) : '';
    if (!sku || !warehouseId) continue;
    out.push({
      sku,
      productId: r.product_id !== undefined ? String(r.product_id) : null,
      warehouseId,
      warehouseName: (r.warehouse_name ?? '').trim(),
      present: Number(r.present ?? 0),
      reserved: Number(r.reserved ?? 0),
      raw: r as unknown as Record<string, unknown>,
    });
  }
  return out;
}

// ---- /v1/cluster/list (Seller API) ---------------------------------------

const ClusterWarehouseSellerSchema = z
  .object({
    warehouse_id: z.union([z.string(), z.number()]).optional(),
    name: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();

const LogisticClusterSellerSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    warehouses: z.array(ClusterWarehouseSellerSchema).optional(),
  })
  .passthrough();

const ClusterSellerSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    name: z.string().optional(),
    type: z.string().optional(),
    // У некоторых аккаунтов кластер — это сразу контейнер складов.
    warehouses: z.array(ClusterWarehouseSellerSchema).optional(),
    // У других — складские группы спрятаны на один уровень глубже.
    logistic_clusters: z.array(LogisticClusterSellerSchema).optional(),
  })
  .passthrough();

const ClusterListSellerResponseSchema = z
  .object({
    clusters: z.array(ClusterSellerSchema).optional(),
    // На некоторых аккаунтах поле называется `list` — поддерживаем оба варианта.
    list: z.array(ClusterSellerSchema).optional(),
  })
  .passthrough();

export type ClusterListItem = {
  clusterId: string;
  clusterName: string;
  clusterType: string | null;
  /** Имена ВСЕХ складов кластера (включая вложенные logistic_clusters). */
  warehouseNames: string[];
};

/**
 * Справочник географических кластеров Ozon (Москва, СПб, Юг, Урал и т.д.)
 * с привязкой имён складов к каждому кластеру.
 *
 * Используется в blocks `Остатки по типу склада` и `Остатки по кластерам`
 * для агрегации остатков по географии.
 *
 * Документация: docs.ozon.ru/api/seller, метод `/v1/cluster/list`. Это
 * **Seller API**, а не Performance API (исторически ошибочно вызывали
 * через Performance клиент — отсюда 404).
 *
 * Параметры:
 *  - `clusterIds` — фильтр по ID кластеров. Если пусто (`[]`) — все.
 *  - `clusterType` — `CLUSTER_TYPE_OZON` или `CLUSTER_TYPE_CIS`
 *    (Казахстан/Беларусь: АСТАНА_РФЦ, МИНСК_МПСЦ). Стейдж `clusters`
 *    запрашивает ОБА и мержит: аккаунт может отгружать и в РФ, и в СНГ.
 *
 * `client.post()` намеренно остаётся lenient (без `{ strict: true }`):
 * схема целиком из `.optional()` + `.passthrough()`, поэтому Zod здесь
 * почти не может упасть, а если Ozon поменяет форму ответа — лучше отдать
 * raw и разобрать что сможем, чем потерять весь справочник кластеров
 * и уронить резолв склад→кластер во всём блоке остатков.
 */
export async function getClusterListSeller(
  client: OzonClient,
  args?: { clusterIds?: string[]; clusterType?: 'CLUSTER_TYPE_OZON' | 'CLUSTER_TYPE_CIS' },
): Promise<ClusterListItem[]> {
  const data = (await client.post(
    OZON_API_VERSION_MAP.clusterList,
    {
      cluster_ids: args?.clusterIds ?? [],
      cluster_type: args?.clusterType ?? 'CLUSTER_TYPE_OZON',
    },
    ClusterListSellerResponseSchema,
  )) as
    | {
        clusters?: Array<z.infer<typeof ClusterSellerSchema>>;
        list?: Array<z.infer<typeof ClusterSellerSchema>>;
      }
    | undefined;

  const list = data?.clusters ?? data?.list ?? [];
  const out: ClusterListItem[] = [];
  for (const c of list) {
    const id = c.id !== undefined ? String(c.id) : '';
    if (!id) continue;
    const warehouseNames: string[] = [];
    for (const w of c.warehouses ?? []) {
      const name = (w.name ?? '').trim();
      if (name) warehouseNames.push(name);
    }
    for (const lc of c.logistic_clusters ?? []) {
      for (const w of lc.warehouses ?? []) {
        const name = (w.name ?? '').trim();
        if (name) warehouseNames.push(name);
      }
    }
    out.push({
      clusterId: id,
      clusterName: (c.name ?? '').trim() || `Кластер ${id}`,
      clusterType: c.type ?? null,
      // dedup на случай если склад торчит и на верхнем уровне и в logistic_clusters.
      warehouseNames: Array.from(new Set(warehouseNames)),
    });
  }
  return out;
}

/**
 * Запрашивает агрегированные метрики продаж через `/v1/analytics/data`.
 *
 * Это родной аналитический endpoint Ozon (Seller API), он же используется
 * в Seller-кабинете в разделе «Аналитика → Графики». В отличие от FBO/FBS
 * postings (которые мы выкачиваем как заказы), этот endpoint возвращает
 * агрегированные финальные числа — те самые, что показывает Ozon на своих
 * дашбордах.
 *
 * Лимит: **1 запрос в минуту** на аккаунт. Если делаем несколько запросов
 * подряд (например, при пагинации) — нужно `await sleep(60_000)` между ними.
 *
 * Метрики:
 *  - `revenue` (₽), `ordered_units` (шт.) — всем продавцам.
 *  - `delivered_units`, `cancellations`, `returns`, и десятки прочих —
 *    только Premium Plus / Pro. На базовом тарифе Ozon ответит 400
 *    InvalidArgument; вызывающий код должен поймать ошибку и переключиться
 *    на минимальный набор. См. `analyticsDataWithFallback()`.
 *
 * Без Premium даты ограничены последними 3 месяцами.
 *
 * docs.ozon.ru/api/seller — Analytics Data.
 */
export async function analyticsData(
  client: OzonClient,
  args: {
    /** YYYY-MM-DD. */
    dateFrom: string;
    /** YYYY-MM-DD. */
    dateTo: string;
    /** До 14 метрик. */
    metrics: ReadonlyArray<AnalyticsMetric>;
    /** До 2 dimension'ов. Пример: ['sku', 'day']. */
    dimension: ReadonlyArray<AnalyticsDimension>;
    filters?: Array<Record<string, unknown>>;
    sort?: Array<{ key: string; order: 'ASC' | 'DESC' }>;
    /** Max 1000. */
    limit?: number;
    offset?: number;
  },
): Promise<AnalyticsDataResponse> {
  return client.post(
    OZON_API_VERSION_MAP.analyticsData,
    {
      date_from: args.dateFrom,
      date_to: args.dateTo,
      metrics: [...args.metrics],
      dimension: [...args.dimension],
      filters: args.filters ?? [],
      sort: args.sort ?? [],
      limit: Math.min(Math.max(args.limit ?? 1000, 1), 1000),
      offset: Math.max(args.offset ?? 0, 0),
    },
    AnalyticsDataResponseSchema,
  );
}

/**
 * Эвристика: ошибка от Ozon вызвана отсутствием подписки Premium Plus
 * (а не битыми параметрами или сетью). Тогда стейдж аналитики деградирует
 * до базовых метрик `revenue` + `ordered_units`.
 *
 * Точного кода ответа Ozon нет: он отвечает 400 InvalidArgument либо 403
 * Forbidden, иногда с message «metric ... is not available for current
 * subscription» / «access denied». Поэтому смотрим на статус + текст.
 */
export function isPremiumPlusUnavailableError(e: unknown): boolean {
  if (!(e instanceof OzonApiError)) return false;
  if (e.status !== 400 && e.status !== 403) return false;
  const haystack = `${e.message} ${describeBody(e.body)}`.toLowerCase();
  return (
    haystack.includes('subscription') ||
    haystack.includes('premium') ||
    haystack.includes('not available') ||
    haystack.includes('access denied') ||
    haystack.includes('forbidden') ||
    /metric/.test(haystack)
  );
}

function describeBody(body: unknown): string {
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (typeof body === 'object') {
    try {
      return JSON.stringify(body).slice(0, 500);
    } catch {
      return '';
    }
  }
  return String(body);
}

export type AnalyticsDataTier = 'premium-plus' | 'basic';

/**
 * Запрашивает `/v1/analytics/data` сначала с полным набором Premium Plus
 * метрик; при ошибке подписки автоматически деградирует до базовых
 * `revenue` + `ordered_units`.
 *
 * Возвращает результат вместе с `tier`, чтобы вызывающий код мог:
 *  1) проставить лейбл `account.metadata.ozonAnalyticsTier`,
 *  2) понять, нужно ли заполнять `cancellations`/`returns` из orders fallback.
 */
export async function analyticsDataWithFallback(
  client: OzonClient,
  args: {
    dateFrom: string;
    dateTo: string;
    dimension: ReadonlyArray<AnalyticsDimension>;
    limit?: number;
    offset?: number;
  },
): Promise<{ tier: AnalyticsDataTier; metrics: ReadonlyArray<AnalyticsMetric>; response: AnalyticsDataResponse }> {
  try {
    const response = await analyticsData(client, {
      ...args,
      metrics: ANALYTICS_METRICS_PREMIUM,
    });
    return { tier: 'premium-plus', metrics: ANALYTICS_METRICS_PREMIUM, response };
  } catch (e) {
    if (!isPremiumPlusUnavailableError(e)) throw e;
    const response = await analyticsData(client, {
      ...args,
      metrics: ANALYTICS_METRICS_BASIC,
    });
    return { tier: 'basic', metrics: ANALYTICS_METRICS_BASIC, response };
  }
}
