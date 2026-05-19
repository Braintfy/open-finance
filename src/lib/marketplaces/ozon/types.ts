// PURPOSE: Zod-схемы и TS-типы ответов Ozon Seller API.
// Все ответы прогоняются через .safeParse(). Неизвестные поля игнорируются
// (.passthrough() в местах где Ozon добавляет вспомогательные данные).

import { z } from 'zod';

// ---- Общее ---------------------------------------------------------------

export const OzonErrorSchema = z
  .object({
    code: z.string().optional(),
    message: z.string().optional(),
    details: z.array(z.unknown()).optional(),
  })
  .passthrough();

// ---- /v1/seller/info -----------------------------------------------------
// Ozon отдаёт поля иногда в обёртке result, иногда на верхнем уровне.
// Допускаем обе формы; downstream должен брать info.result ?? info.

const SellerInfoBodySchema = z
  .object({
    company_id: z.number().optional(),
    name: z.string().optional(),
    is_enabled: z.boolean().optional(),
  })
  .passthrough();

export const SellerInfoSchema = z
  .object({
    result: SellerInfoBodySchema.optional(),
    company_id: z.number().optional(),
    name: z.string().optional(),
    is_enabled: z.boolean().optional(),
  })
  .passthrough();

// ---- /v3/product/list ----------------------------------------------------

export const ProductListItemSchema = z
  .object({
    product_id: z.number(),
    offer_id: z.string(),
    is_fbo_visible: z.boolean().optional(),
    is_fbs_visible: z.boolean().optional(),
    archived: z.boolean().optional(),
    is_discounted: z.boolean().optional(),
  })
  .passthrough();

export const ProductListResponseSchema = z.object({
  result: z.object({
    items: z.array(ProductListItemSchema),
    total: z.number().optional(),
    last_id: z.string().optional(),
  }),
});

// ---- /v3/product/info/list -----------------------------------------------

export const ProductInfoSchema = z
  .object({
    // Ослаблено: id/offer_id могут быть null для частично заполненных карточек;
    // upsert пропустит такие записи (skipped без fatal).
    id: z.number().nullable().optional(),
    name: z.string().nullable().optional(),
    offer_id: z.string().nullable().optional(),
    barcode: z.string().optional(),
    barcodes: z.array(z.string()).optional(),
    weight: z.number().optional(),
    weight_unit: z.string().optional(),
    depth: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    dimension_unit: z.string().optional(),
    // С 2026-05 Ozon отдаёт primary_image массивом URL.
    // Раньше была строка — поддерживаем обе формы.
    primary_image: z.union([z.string(), z.array(z.string())]).optional(),
    images: z.array(z.string()).optional(),
    sources: z
      .array(
        z
          .object({ sku: z.number().optional(), source: z.string().optional() })
          .passthrough(),
      )
      .optional(),
    status: z
      .object({
        state: z.string().optional(),
        state_name: z.string().optional(),
      })
      .passthrough()
      .optional(),
    visible: z.boolean().optional(),
  })
  .passthrough();

export const ProductInfoListResponseSchema = z.object({
  items: z.array(ProductInfoSchema).optional(),
  result: z
    .object({ items: z.array(ProductInfoSchema).optional() })
    .passthrough()
    .optional(),
});

// ---- /v5/product/info/prices --------------------------------------------

// Ozon в разных версиях/ответах отдаёт денежные поля то строкой, то числом.
// Парсер `parseMoneyRu` принимает оба формата, но Zod-схема должна
// валидировать запрос без падений — поэтому union.
const MoneyValueSchema = z.union([z.string(), z.number()]).optional();

const PriceMoneySchema = z
  .object({
    price: MoneyValueSchema,
    old_price: MoneyValueSchema,
    min_price: MoneyValueSchema,
    currency_code: z.string().optional(),
    auto_action_enabled: z.string().optional(),
    marketing_price: MoneyValueSchema,
    /** Цена с СПП — после маркетинговых акций Ozon. */
    marketing_seller_price: MoneyValueSchema,
  })
  .passthrough();

const CommissionSchema = z
  .object({
    sales_percent_fbo: z.number().optional(),
    sales_percent_fbs: z.number().optional(),
    fbo_fulfillment_amount: z.number().optional(),
    fbo_direct_flow_trans_min_amount: z.number().optional(),
    fbo_direct_flow_trans_max_amount: z.number().optional(),
    fbs_first_mile_min_amount: z.number().optional(),
    fbs_first_mile_max_amount: z.number().optional(),
    fbs_direct_flow_trans_min_amount: z.number().optional(),
    fbs_direct_flow_trans_max_amount: z.number().optional(),
  })
  .passthrough();

export const PricesItemSchema = z
  .object({
    product_id: z.number(),
    sku: z.number().optional(),
    offer_id: z.string().optional(),
    price: PriceMoneySchema.optional(),
    commissions: CommissionSchema.optional(),
    price_indexes: z
      .object({
        color_index: z.string().optional(),
      })
      .passthrough()
      .optional(),
    marketing_actions: z
      .object({
        actions: z.array(z.unknown()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const PricesResponseSchema = z.object({
  items: z.array(PricesItemSchema).optional(),
  total: z.number().optional(),
  cursor: z.string().optional(),
});

// ---- /v4/product/info/stocks ---------------------------------------------

export const StocksItemSchema = z
  .object({
    product_id: z.number().optional(),
    sku: z.number().optional(),
    offer_id: z.string().optional(),
    stocks: z
      .array(
        z
          .object({
            type: z.string().optional(),
            present: z.number().optional(),
            reserved: z.number().optional(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();

export const StocksResponseSchema = z.object({
  items: z.array(StocksItemSchema).optional(),
  total: z.number().optional(),
  cursor: z.string().optional(),
});

// ---- /v3/posting/fbs/list, /v2/posting/fbo/list --------------------------

export const PostingItemSchema = z
  .object({
    sku: z.number().optional(),
    name: z.string().optional(),
    quantity: z.number().optional(),
    offer_id: z.string().optional(),
    price: z.string().optional(),
  })
  .passthrough();

export const FbsPostingSchema = z
  .object({
    posting_number: z.string(),
    order_id: z.number().optional(),
    order_number: z.string().optional(),
    status: z.string(),
    in_process_at: z.string().optional(),
    created_at: z.string().optional(),
    shipment_date: z.string().optional(),
    delivering_date: z.string().optional(),
    products: z.array(PostingItemSchema).optional(),
    cancellation: z
      .object({
        cancel_reason_id: z.number().optional(),
        cancellation_initiator: z.string().optional(),
        cancellation_type: z.string().optional(),
        cancelled_at: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const FbsPostingsResponseSchema = z.object({
  result: z.object({
    postings: z.array(FbsPostingSchema).optional(),
    has_next: z.boolean().optional(),
  }),
});

export const FboPostingSchema = z
  .object({
    posting_number: z.string(),
    order_id: z.number().optional(),
    order_number: z.string().optional(),
    status: z.string(),
    created_at: z.string().optional(),
    in_process_at: z.string().optional(),
    products: z.array(PostingItemSchema).optional(),
  })
  .passthrough();

export const FboPostingsResponseSchema = z.object({
  result: z.array(FboPostingSchema).optional(),
});

// ---- /v2/finance/realization ---------------------------------------------

export const RealizationRowSchema = z
  .object({
    row_number: z.number().optional(),
    product_id: z.number().optional(),
    sku: z.number().optional(),
    name: z.string().optional(),
    offer_id: z.string().optional(),
    sale: z
      .object({
        sale_qty: z.number().optional(),
        sale_amount: z.number().optional(),
        sale_commission: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const RealizationResponseSchema = z.object({
  result: z
    .object({
      header: z.array(z.unknown()).optional(),
      rows: z.array(RealizationRowSchema).optional(),
    })
    .passthrough()
    .optional(),
});

// ---- /v3/finance/transaction/list -----------------------------------------

export const TransactionOperationSchema = z
  .object({
    operation_id: z.number(),
    operation_type: z.string().optional(),
    operation_date: z.string().optional(),
    operation_type_name: z.string().optional(),
    amount: z.number().optional(),
    posting: z
      .object({
        posting_number: z.string().optional(),
        order_date: z.string().optional(),
      })
      .passthrough()
      .optional(),
    items: z
      .array(z.object({ sku: z.number().optional(), name: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

export const TransactionListResponseSchema = z.object({
  result: z
    .object({
      operations: z.array(TransactionOperationSchema).optional(),
      page_count: z.number().optional(),
      row_count: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

// ---- /v1/analytics/data --------------------------------------------------
// Родной аналитический endpoint Ozon (Seller API). Возвращает агрегированные
// метрики по dimension. См. docs.ozon.ru/api/seller. Лимит 1 req/min.
//
// data[].dimensions — массив объектов в порядке запроса dimension'ов:
//   [{ id: '<sku>', name: '<product name>' }, { id: 'YYYY-MM-DD', name: '...' }]
// data[].metrics — числа в том же порядке, что и в request.metrics.

export const AnalyticsDataDimensionSchema = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
  })
  .passthrough();

export const AnalyticsDataRowSchema = z
  .object({
    dimensions: z.array(AnalyticsDataDimensionSchema).optional(),
    metrics: z.array(z.number()).optional(),
  })
  .passthrough();

export const AnalyticsDataResponseSchema = z
  .object({
    result: z
      .object({
        data: z.array(AnalyticsDataRowSchema).optional(),
        totals: z.array(z.number()).optional(),
      })
      .passthrough()
      .optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();

// ---- /v1/analytics/turnover/stocks ---------------------------------------

export const TurnoverRowSchema = z
  .object({
    sku: z.number().optional(),
    item_code: z.string().optional(),
    item_name: z.string().optional(),
    turnover: z.number().optional(),
    current_stock: z.number().optional(),
    idc: z.number().optional(),
  })
  .passthrough();

export const TurnoverResponseSchema = z.object({
  items: z.array(TurnoverRowSchema).optional(),
  cursor: z.string().optional(),
});

export type ProductListItem = z.infer<typeof ProductListItemSchema>;
export type ProductInfo = z.infer<typeof ProductInfoSchema>;
export type PricesItem = z.infer<typeof PricesItemSchema>;
export type StocksItem = z.infer<typeof StocksItemSchema>;
export type FbsPosting = z.infer<typeof FbsPostingSchema>;
export type FboPosting = z.infer<typeof FboPostingSchema>;
export type RealizationRow = z.infer<typeof RealizationRowSchema>;
export type TransactionOperation = z.infer<typeof TransactionOperationSchema>;
export type TurnoverRow = z.infer<typeof TurnoverRowSchema>;
export type AnalyticsDataRow = z.infer<typeof AnalyticsDataRowSchema>;
export type AnalyticsDataResponse = z.infer<typeof AnalyticsDataResponseSchema>;
