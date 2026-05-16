// PURPOSE: Типизированные обёртки над Ozon Seller API endpoints.
// Один файл — одна точка для каждого вызова, чтобы при изменении endpoint
// (`/v4` → `/v5` и т.д.) править в одном месте. Используются модулями
// sync/* и API-роутами.
//
// ВАЖНО: при изменении версии endpoint'а или контракта Ozon обновлять:
// 1. этот файл (новая версия пути + новая Zod-схема в types.ts);
// 2. соответствующий sync/*.ts маппинг;
// 3. docs/MARKETPLACES_OZON.md (когда заведём — см. mini-plan в PLAN.md).

import { OzonClient } from './client';
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
} as const;

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
