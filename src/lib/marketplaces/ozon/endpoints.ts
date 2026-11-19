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
  AccrualPostingsResponseSchema,
  type AccrualByDay,
  type AnalyticsDataResponse,
  type StockOnWarehousesRow,
} from './types';
import {
  collectCursorPages,
  parseStocksByWarehouseFbsPage,
  parseWarehouseListPage,
  type FbsWarehouseItem,
  type FbsWarehouseStockRow,
} from './fbs-stocks-map';
import {
  collectLastIdPages,
  parseAccrualByDayPage,
  MAX_ACCRUAL_PAGES_PER_DAY,
} from './accruals-map';

export const OZON_API_VERSION_MAP = {
  sellerInfo: '/v1/seller/info',
  productList: '/v3/product/list',
  productInfoList: '/v3/product/info/list',
  productInfoPrices: '/v5/product/info/prices',
  productInfoStocks: '/v4/product/info/stocks',
  postingFbsList: '/v4/posting/fbs/list',
  postingFboList: '/v3/posting/fbo/list',
  financeRealization: '/v2/finance/realization',
  // LEGACY: отключён Ozon (400 obsolete с 12.09.2026, 404 с 06.10.2026).
  // Замена — financeAccrual* ниже; стейдж `transactions` вне набора по умолчанию.
  financeTransactionList: '/v3/finance/transaction/list',
  // Начисления (бета в справочнике): по дню, справочник типов, по отправлениям.
  financeAccrualByDay: '/v1/finance/accrual/by-day',
  financeAccrualTypes: '/v1/finance/accrual/types',
  financeAccrualPostings: '/v1/finance/accrual/postings',
  analyticsTurnoverStocks: '/v1/analytics/turnover/stocks',
  // v2 заменяет deprecated `/v1/analytics/stock_on_warehouses` (тот же
  // запрос/ответ, новый путь — см. docs.ozon.ru/api/seller).
  // Справочник: «В будущем метод будет отключён. Переключитесь на /v1/analytics/stocks».
  // Формы разные (обязательный skus, кластерные метрики, нет promised_amount и
  // названия склада; есть warehouse_id/warehouse_ids) — перевод отдельной задачей.
  analyticsStockOnWarehouses: '/v2/analytics/stock_on_warehouses',
  // Этап 2b LK_V2_PLAN: FBS-склады продавца. `stock_on_warehouses` (выше)
  // отдаёт ТОЛЬКО FBO-склады Ozon, поэтому собственные склады продавца
  // (у крупных селлеров их больше, чем FBO) требуют отдельной пары вызовов:
  // список складов + остатки по ним.
  warehouseList: '/v2/warehouse/list',
  productStocksByWarehouseFbs: '/v2/product/info/stocks-by-warehouse/fbs',
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

/** Максимум `limit` у /v4/posting/fbs/list и /v3/posting/fbo/list (справочник: [1..100]). */
export const POSTING_LIST_PAGE_LIMIT = 100;

/** Cursor-пагинация: первая страница — `cursor: ''`, дальше — из ответа. */
export async function postingFbsList(
  client: OzonClient,
  args: { since: Date; to: Date; cursor?: string; limit?: number },
) {
  return client.post(
    OZON_API_VERSION_MAP.postingFbsList,
    {
      sort_dir: 'DESC',
      filter: {
        since: args.since.toISOString(),
        to: args.to.toISOString(),
      },
      limit: args.limit ?? POSTING_LIST_PAGE_LIMIT,
      cursor: args.cursor ?? '',
      with: { analytics_data: true, financial_data: true },
    },
    FbsPostingsResponseSchema,
  );
}

export async function postingFboList(
  client: OzonClient,
  args: { since: Date; to: Date; cursor?: string; limit?: number },
) {
  return client.post(
    OZON_API_VERSION_MAP.postingFboList,
    {
      sort_dir: 'DESC',
      filter: {
        since: args.since.toISOString(),
        to: args.to.toISOString(),
      },
      limit: args.limit ?? POSTING_LIST_PAGE_LIMIT,
      cursor: args.cursor ?? '',
      with: { analytics_data: true, financial_data: true },
    },
    FboPostingsResponseSchema,
  );
}

/**
 * Отчёт о реализации товаров за месяц (приложение к УПД).
 *
 * ТЕЛО ЗАПРОСА — `{ year, month }` ЧИСЛАМИ. До v0.51.1 слали `{ date: 'YYYY-MM' }`
 * (форма v1) и получали 400 «Request validation error: invalid
 * GetRealizationReportRequestV2.Year: value must be inside range [2000, 9999]»,
 * а стейдж глотал ошибку — таблица `ozon_realization` месяцами стояла пустой.
 * Строки (`{ year: '2026' }`) grpc-gateway тоже принимает, но числа — канон доки.
 *
 * `{ strict: true }` осознанно: схема ответа держит денежные поля обязательными,
 * и провал Zod здесь ОБЯЗАН уронить стейдж. Lenient-режим (default) отдал бы raw,
 * маппинг получил бы `undefined` и записал нули — ровно тот тихий баг, который
 * и прятал поломку.
 *
 * Текущий месяц Ozon не отдаёт — вызывать только для закрытых месяцев.
 */
export async function financeRealization(
  client: OzonClient,
  args: { year: number; month: number },
) {
  return client.post(
    OZON_API_VERSION_MAP.financeRealization,
    { year: args.year, month: args.month },
    RealizationResponseSchema,
    { strict: true },
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

// ---- Начисления /v1/finance/accrual/* --------------------------------------

/**
 * Одна страница начислений за день — `POST /v1/finance/accrual/by-day`.
 * Запрос `{ date: 'YYYY-MM-DD', last_id }` (оба required; первая страница —
 * `last_id: ''`), ответ `{ accruals, last_id }`.
 *
 * Схему здесь НЕ передаём: ответ валидирует чистый `parseAccrualByDayPage`
 * (accruals-map.ts) — расхождение формы попадает в StageResult, а не в
 * console.warn, и окно дня при этом не заменяется.
 */
export async function financeAccrualByDayPage(
  client: OzonClient,
  args: { date: string; lastId: string },
): Promise<unknown> {
  return client.post<unknown>(OZON_API_VERSION_MAP.financeAccrualByDay, {
    date: args.date,
    last_id: args.lastId,
  });
}

/**
 * Все начисления за день: last_id-пагинация до пустой страницы.
 * `complete=false` — выборка оборвана, окно дня заменять нельзя.
 */
export async function getFinanceAccrualsByDay(
  client: OzonClient,
  args: { date: string },
): Promise<{
  accruals: AccrualByDay[];
  shapeOk: boolean;
  complete: boolean;
  pages: number;
  warnings: string[];
}> {
  const r = await collectLastIdPages<AccrualByDay>({
    label: `/v1/finance/accrual/by-day ${args.date}`,
    maxPages: MAX_ACCRUAL_PAGES_PER_DAY,
    fetchPage: (lastId) => financeAccrualByDayPage(client, { date: args.date, lastId }),
    parse: parseAccrualByDayPage,
  });
  return { accruals: r.items, shapeOk: r.shapeOk, complete: r.complete, pages: r.pages, warnings: r.warnings };
}

/**
 * Справочник типов начислений — `POST /v1/finance/accrual/types` (тела
 * запроса справочник не описывает — шлём `{}`). Валидирует `mapAccrualTypes`.
 */
export async function financeAccrualTypes(client: OzonClient): Promise<unknown> {
  return client.post<unknown>(OZON_API_VERSION_MAP.financeAccrualTypes, {});
}

/** Максимум номеров в запросе `/v1/finance/accrual/postings` (справочник: [1..200]). */
export const ACCRUAL_POSTINGS_MAX = 200;

/**
 * Начисления по отправлениям — `POST /v1/finance/accrual/postings`
 * (`posting_numbers` 1..200). Единственный из методов с количеством.
 * Стейджем пока не вызывается (by-day не отдаёт номер отправления); `strict`,
 * чтобы будущий потребитель не получил нули при дрейфе формы.
 */
export async function financeAccrualPostings(
  client: OzonClient,
  args: { postingNumbers: string[] },
) {
  if (args.postingNumbers.length === 0 || args.postingNumbers.length > ACCRUAL_POSTINGS_MAX) {
    throw new Error(
      `/v1/finance/accrual/postings: нужно от 1 до ${ACCRUAL_POSTINGS_MAX} номеров, передано ${args.postingNumbers.length}`,
    );
  }
  return client.post(
    OZON_API_VERSION_MAP.financeAccrualPostings,
    { posting_numbers: args.postingNumbers },
    AccrualPostingsResponseSchema,
    { strict: true },
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

export type { FbsWarehouseItem, FbsWarehouseStockRow };

/** Предохранитель от бесконечной курсорной пагинации. */
const FBS_MAX_PAGES = 100;
/** `limit` у `/v2/warehouse/list` — максимум 200 (справочник). */
const WAREHOUSE_LIST_LIMIT = 200;
/** `limit` у `/v2/product/info/stocks-by-warehouse/fbs` — максимум 1000. */
const FBS_STOCKS_PAGE_LIMIT = 1000;

/**
 * Список собственных складов продавца (FBS/rFBS) — Seller API
 * `POST /v2/warehouse/list` (замена `/v1/warehouse/list`, отключаемого
 * 07.04.2026). Запрос `{ limit, cursor }`, ответ `{ warehouses, cursor, has_next }`.
 *
 * Клиент lenient (Zod fail → warn + raw), но дрейф формы НЕ глотается:
 * `warnings` содержит замечания парсера, `shapeOk=false` — признак того, что
 * пустой список нельзя трактовать как «складов нет».
 */
export async function getFbsWarehouseListDetailed(
  client: OzonClient,
): Promise<{
  items: FbsWarehouseItem[];
  shapeOk: boolean;
  complete: boolean;
  warnings: string[];
}> {
  return collectCursorPages<FbsWarehouseItem>({
    label: '/v2/warehouse/list',
    maxPages: FBS_MAX_PAGES,
    fetchPage: (cursor) =>
      client.post(
        OZON_API_VERSION_MAP.warehouseList,
        cursor ? { limit: WAREHOUSE_LIST_LIMIT, cursor } : { limit: WAREHOUSE_LIST_LIMIT },
        WarehouseListResponseSchema,
      ),
    parse: parseWarehouseListPage,
  });
}

/** Совместимая обёртка (диагностический скрипт): только элементы. */
export async function getFbsWarehouseList(
  client: OzonClient,
): Promise<FbsWarehouseItem[]> {
  return (await getFbsWarehouseListDetailed(client)).items;
}

/**
 * Максимум SKU в одном запросе `/v2/product/info/stocks-by-warehouse/fbs`
 * (справочник: `sku` <= 1000; оставляем 500 с запасом). Строк в ответе может
 * быть больше (SKU × склады) — они добираются курсором.
 */
export const FBS_STOCKS_SKU_CHUNK = 500;

/**
 * Остатки по собственным складам продавца — Seller API
 * `POST /v2/product/info/stocks-by-warehouse/fbs` (замена `/v1/...`,
 * отключаемого 07.04.2026). Запрос `{ sku: string[], limit, cursor }`,
 * ответ `{ products: [{ sku, offer_id, product_id, present, reserved,
 * free_stock, warehouse_id, warehouse_name }], cursor, has_next }`.
 * SKU без остатков на FBS в ответе просто не появляются. Строки без
 * sku/warehouse_id/present/reserved не пишутся и попадают в `warnings`.
 */
export async function getStocksByWarehouseFbsDetailed(
  client: OzonClient,
  args: { sku: string[] },
): Promise<{
  rows: FbsWarehouseStockRow[];
  shapeOk: boolean;
  /** false — пагинация оборвана: строки неполные, снапшот заменять нельзя. */
  complete: boolean;
  warnings: string[];
}> {
  if (args.sku.length === 0) return { rows: [], shapeOk: true, complete: true, warnings: [] };
  const r = await collectCursorPages<FbsWarehouseStockRow>({
    label: '/v2/product/info/stocks-by-warehouse/fbs',
    maxPages: FBS_MAX_PAGES,
    fetchPage: (cursor) =>
      client.post(
        OZON_API_VERSION_MAP.productStocksByWarehouseFbs,
        cursor
          ? { sku: args.sku, limit: FBS_STOCKS_PAGE_LIMIT, cursor }
          : { sku: args.sku, limit: FBS_STOCKS_PAGE_LIMIT },
        StocksByWarehouseFbsResponseSchema,
      ),
    parse: (data) => {
      const p = parseStocksByWarehouseFbsPage(data);
      return { ...p, items: p.rows };
    },
  });
  return { rows: r.items, shapeOk: r.shapeOk, complete: r.complete, warnings: r.warnings };
}

/** Совместимая обёртка (диагностический скрипт): только строки. */
export async function getStocksByWarehouseFbs(
  client: OzonClient,
  args: { sku: string[] },
): Promise<FbsWarehouseStockRow[]> {
  return (await getStocksByWarehouseFbsDetailed(client, args)).rows;
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
