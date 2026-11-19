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
            // Живой ответ (2026-11-19): SKU лежит здесь, у каждой записи остатка,
            // а `item.sku` верхнего уровня Ozon не присылает. У одного товара
            // бывает несколько SKU (разные записи fbs с разными sku).
            sku: z.union([z.number(), z.string()]).optional(),
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

// ---- /v4/posting/fbs/list, /v3/posting/fbo/list --------------------------
//
// Оба метода (с 2026-04-30) — cursor-пагинация (`cursor` + `has_next`),
// массив лежит в корне ответа (`postings`), НЕ в `result` как у v3/v2.
// `limit` 1..100. Даты — RFC3339 date-time в UTC («2026-05-04T06:44:37Z»).
// Цена товара: FBS v4 — объект `{ amount: "300", currency: "RUB" }`,
// FBO v3 — строка «29990.00». Денежные/ключевые поля (posting_number,
// status, sku, quantity, price) — ОБЯЗАТЕЛЬНЫЕ: отсутствие = смена контракта.

/** Денежное значение: строка-число или `{ amount, currency }`. */
/** Число и строка допускаются оба (int64/decimal у grpc-gateway бывают строкой);
 *  строгую проверку значения делает маппер orders-map.ts. */
export const OzonMoneySchema = z.union([
  z.string(),
  z.number(),
  z
    .object({ amount: z.union([z.string(), z.number()]), currency: z.string().optional() })
    .passthrough(),
]);

export const PostingItemSchema = z
  .object({
    sku: z.union([z.number(), z.string()]),
    name: z.string().optional(),
    quantity: z.union([z.number(), z.string()]),
    offer_id: z.string(),
    price: OzonMoneySchema,
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
    // Приходит null (справочник: "delivering_date": null) — не строка.
    delivering_date: z.string().nullable().optional(),
    products: z.array(PostingItemSchema),
    cancellation: z
      .object({
        cancel_reason_id: z.number().optional(),
        cancellation_initiator: z.string().optional(),
        cancellation_type: z.string().optional(),
        cancelled_at: z.string().nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

export const FbsPostingsResponseSchema = z.object({
  postings: z.array(FbsPostingSchema),
  has_next: z.boolean(),
  cursor: z.string().optional(),
});

export const FboPostingSchema = z
  .object({
    posting_number: z.string(),
    order_id: z.number().optional(),
    order_number: z.string().optional(),
    status: z.string(),
    created_at: z.string().optional(),
    in_process_at: z.string().optional(),
    products: z.array(PostingItemSchema),
  })
  .passthrough();

export const FboPostingsResponseSchema = z.object({
  postings: z.array(FboPostingSchema),
  has_next: z.boolean(),
  cursor: z.string().optional(),
});

// ---- /v2/finance/realization ---------------------------------------------
//
// ФОРМА v2 (снята с живого API, июль 2026 — 2854 строки). Раньше здесь лежала
// схема v1 (`row_number`/`sku`/`sale.sale_qty`), и это был тихий баг: все поля
// были `.optional()` + `.passthrough()`, поэтому ответ v2 «успешно» парсился
// в сплошные `undefined`, а маппинг писал нули. Отсюда правило ниже.
//
// ПРАВИЛО: денежные поля — БЕЗ `.optional()`. Пусть следующее расхождение
// формы падает громко (стейдж отдаёт error → виден в UI), чем пишет нули.
// `.passthrough()` оставлен: Ozon регулярно доносит новые поля выплат
// (`pick_up_point_coinvestment` появился позже `bank_coinvestment`).
//
// Ответ: `{ result: { header: {...}, rows: [...] } }` — header ОБЪЕКТ, не массив.

/** Товар строки отчёта. `sku` — int64, grpc-gateway отдаёт и числом, и строкой. */
export const RealizationItemSchema = z
  .object({
    sku: z.union([z.number(), z.string()]),
    name: z.string().optional(),
    offer_id: z.string().optional(),
    barcode: z.string().optional(),
  })
  .passthrough();

/**
 * Блок начислений строки: `delivery_commission` (реализация) либо
 * `return_commission` (возвраты, бывает `null`). Структура одинаковая.
 *
 * Расшифровка полей (docs.ozon.ru/api/seller → FinanceAPI_FinanceRealizationV2,
 * сверено с фактическим ответом):
 *  - `quantity` — количество товара;
 *  - `price_per_instance` — цена реализации за единицу (та, что заплатил
 *    покупатель после скидок Ozon);
 *  - `amount` — сумма реализации (= `price_per_instance` × `quantity`);
 *  - `bonus` — баллы за скидки (компенсирует Ozon → это выручка продавца);
 *  - `compensation` — доплата за счёт Ozon;
 *  - `bank_coinvestment` / `stars` / `pick_up_point_coinvestment` — выплаты по
 *    механикам партнёрской лояльности (зелёные цены / звёзды / ПВЗ);
 *  - `standard_fee` — базовое вознаграждение Ozon (фактическое удержание);
 *  - `commission` — вознаграждение с учётом скидок и наценок (у обычных строк 0);
 *  - `total` — ИТОГО К НАЧИСЛЕНИЮ продавцу по строке.
 *
 * Проверенная на живом ответе арифметика:
 *   amount + bonus + bank_coinvestment (+ прочие выплаты) − standard_fee = total
 *   standard_fee / (seller_price_per_instance × quantity) = commission_ratio
 */
export const RealizationCommissionSchema = z
  .object({
    quantity: z.number(),
    price_per_instance: z.number(),
    amount: z.number(),
    standard_fee: z.number(),
    commission: z.number(),
    bonus: z.number(),
    total: z.number(),
    // Выплаты по механикам лояльности появились в API позже основного набора,
    // поэтому допускаем отсутствие (трактуем как 0), но НЕ допускаем для них
    // строк/null — это уже смена формы.
    compensation: z.number().optional(),
    bank_coinvestment: z.number().optional(),
    stars: z.number().optional(),
    pick_up_point_coinvestment: z.number().optional(),
  })
  .passthrough();

export const RealizationRowSchema = z
  .object({
    rowNumber: z.number().optional(),
    item: RealizationItemSchema,
    /** Цена продавца с учётом его скидки (до вычета вознаграждения Ozon). */
    seller_price_per_instance: z.number(),
    delivery_commission: RealizationCommissionSchema.nullable().optional(),
    /** Заполнен только у строк с возвратами, иначе `null`. */
    return_commission: RealizationCommissionSchema.nullable().optional(),
    /** Доля вознаграждения Ozon в цене продавца (0.41 = 41%). */
    commission_ratio: z.number().optional(),
  })
  .passthrough();

/** Шапка документа (реквизиты УПД). Кладётся в `ozon_realization.raw`. */
export const RealizationHeaderSchema = z
  .object({
    number: z.string().optional(),
    doc_date: z.string().optional(),
    start_date: z.string().optional(),
    stop_date: z.string().optional(),
    contract_date: z.string().optional(),
    contract_number: z.string().optional(),
    payer_name: z.string().optional(),
    payer_inn: z.string().optional(),
    payer_kpp: z.string().optional(),
    receiver_name: z.string().optional(),
    receiver_inn: z.string().optional(),
    receiver_kpp: z.string().optional(),
    currency_sys_name: z.string().optional(),
    doc_amount: z.number().optional(),
    vat_amount: z.number().optional(),
  })
  .passthrough();

export const RealizationResponseSchema = z
  .object({
    result: z
      .object({
        header: RealizationHeaderSchema.optional(),
        rows: z.array(RealizationRowSchema).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// ---- /v3/finance/transaction/list -----------------------------------------
// LEGACY: метод отключён Ozon (400 obsolete с 12.09.2026, 404 с 06.10.2026).
// Схема оставлена для стейджа `transactions` (вне набора по умолчанию) и
// истории в ozon_transactions. Замена — /v1/finance/accrual/* ниже.

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

// ---- /v1/finance/accrual/{by-day,types,postings} ---------------------------
// Замена `/v3/finance/transaction/list` (справочник: «Метод устаревает и будет
// отключён 6 июля 2026 года. Переключитесь на /v1/finance/accrual/postings,
// /v1/finance/accrual/types, /v1/finance/accrual/by-day»; на проде с 12.09.2026
// — 400 obsolete, с 06.10.2026 — 404). Методы помечены в справочнике бета.
//
// Справочник раскрывает только верхний уровень схем; вложенные объекты взяты
// из ПРИМЕРОВ ответа (Redoc). Описаний вложенных полей (знак суммы, зона даты,
// значения enum `accrued_category`, что такое `unit_number`) в справочнике НЕТ —
// см. шапку accruals-map.ts.
//
// ПРАВИЛО (v0.54.0): денежные и ключевые поля — БЕЗ `.optional()`, вызов —
// `{ strict: true }`. Дрейф формы обязан ронять день, а не писать нули.

/** Деньги Ozon: `{ amount: "string", currency: "string" }`. Число тоже принимаем. */
export const AccrualMoneySchema = z
  .object({
    amount: z.union([z.string(), z.number()]),
    currency: z.string().nullable().optional(),
  })
  .passthrough();

/**
 * Деньги, где справочник сам показывает `amount: null` (услуги доставки в
 * примере by-day). null не превращается в 0 — маппинг пропускает строку с
 * предупреждением.
 */
const AccrualMoneyNullableSchema = z
  .object({
    amount: z.union([z.string(), z.number()]).nullable(),
    currency: z.string().nullable().optional(),
  })
  .passthrough();

/** int32/int64 у grpc-gateway бывает строкой. */
const AccrualIntSchema = z.union([z.number(), z.string()]);

/** Сбор по товару: `item_fees.fees[].fees[]`. */
export const AccrualFeeSchema = z
  .object({
    accrued: AccrualMoneySchema,
    type_id: AccrualIntSchema,
  })
  .passthrough();

export const AccrualItemFeesSchema = z
  .object({
    fees: z
      .array(
        z
          .object({
            sku: AccrualIntSchema,
            quantity: AccrualIntSchema.nullable().optional(),
            fees: z.array(AccrualFeeSchema),
          })
          .passthrough(),
      )
      .nullable()
      .optional(),
  })
  .passthrough();

/** Разбивка комиссии по товару отправления (`posting.products[].commission`). */
export const AccrualProductCommissionSchema = z
  .object({
    bonus: AccrualMoneySchema.nullable().optional(),
    coinvestment: AccrualMoneySchema.nullable().optional(),
    commission: AccrualMoneySchema.nullable().optional(),
    commission_ratio: z.union([z.string(), z.number()]).nullable().optional(),
    sale_amount: AccrualMoneySchema.nullable().optional(),
    sale_commission: AccrualMoneySchema.nullable().optional(),
    sale_price: AccrualMoneySchema.nullable().optional(),
    seller_price: AccrualMoneySchema.nullable().optional(),
  })
  .passthrough();

export const AccrualPostingProductSchema = z
  .object({
    sku: AccrualIntSchema,
    quantity: AccrualIntSchema.nullable().optional(),
    commission: AccrualProductCommissionSchema.nullable().optional(),
    delivery: z
      .object({
        services: z
          .array(
            z
              .object({
                accrued: AccrualMoneyNullableSchema,
                type_id: AccrualIntSchema,
              })
              .passthrough(),
          )
          .nullable()
          .optional(),
        total_accrued: AccrualMoneySchema.nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

/** Одно начисление из `/v1/finance/accrual/by-day`. */
export const AccrualByDaySchema = z
  .object({
    /** Итог начисления — ключевое денежное поле, обязательно. */
    total_amount: AccrualMoneySchema,
    /**
     * Устойчивый id начисления (живой ответ 2026-11-19). number; строкой тоже.
     * Не обязателен: справочник его не описывал.
     */
    accrual_id: AccrualIntSchema.nullable().optional(),
    /**
     * В ЖИВОМ ответе верхнего `type_id` НЕТ (только в строках: item_fees,
     * non_item_fee, posting.products[].delivery.services). Поле из справочника
     * оставлено необязательным на случай, если Ozon его вернёт.
     */
    type_id: AccrualIntSchema.nullable().optional(),
    /** Дата начисления. Формат и зона в справочнике не описаны. */
    date: z.string(),
    accrued_category: z.string().nullable().optional(),
    unit_number: z.string().nullable().optional(),
    item_fees: AccrualItemFeesSchema.nullable().optional(),
    non_item_fee: z
      .object({
        accrued: AccrualMoneySchema,
        type_id: AccrualIntSchema,
      })
      .passthrough()
      .nullable()
      .optional(),
    posting: z
      .object({
        delivery_schema: z.string().nullable().optional(),
        delivery_speed: z.union([z.number(), z.string()]).nullable().optional(),
        products: z.array(AccrualPostingProductSchema).nullable().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

/**
 * Ответ `/v1/finance/accrual/by-day`: `{ accruals: [...], last_id }` — верхний
 * уровень, без обёртки `result` (пример ответа в справочнике).
 * `accruals` ОБЯЗАТЕЛЕН: тело без него (`{}`, `{accruals:null}`,
 * `{result:{...}}`, `{code,message}` с HTTP 200) — дрейф формы, а не «пустой
 * день». Иначе синк заменил бы уже записанный день пустым набором. Если живой
 * API опускает пустой массив, день станет красным (видно), а не тихо стёртым.
 */
export const AccrualByDayResponseSchema = z
  .object({
    accruals: z.array(AccrualByDaySchema),
    last_id: z.string().nullable().optional(),
  })
  .passthrough();

/** Ответ `/v1/finance/accrual/types`: `{ accrual_types: [{ id, name, description }] }`. */
export const AccrualTypesResponseSchema = z
  .object({
    accrual_types: z.array(
      z
        .object({
          id: AccrualIntSchema,
          name: z.string(),
          description: z.string().nullable().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

/**
 * Ответ `/v1/finance/accrual/postings` (запрос `posting_numbers` 1..200):
 * начисления по отправлениям — единственный из трёх методов с КОЛИЧЕСТВОМ.
 * Стейджем пока не используется (номер отправления by-day отдаёт в
 * `unit_number` у POSTING, количество — в `quantity`; см. accruals-map.ts).
 * Клиент заведён для обогащения после проверки живого ответа.
 */
export const AccrualPostingsResponseSchema = z
  .object({
    posting_accruals: z.array(
      z
        .object({
          posting_number: z.string(),
          accruals: z.array(
            z
              .object({
                accrual_date: z.string(),
                accrued: AccrualMoneySchema,
                quantity: AccrualIntSchema.nullable().optional(),
                seller_price: AccrualMoneySchema.nullable().optional(),
                sku: AccrualIntSchema,
                type_id: AccrualIntSchema,
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type AccrualByDay = z.infer<typeof AccrualByDaySchema>;
export type AccrualByDayResponse = z.infer<typeof AccrualByDayResponseSchema>;
export type AccrualTypesResponse = z.infer<typeof AccrualTypesResponseSchema>;
export type AccrualPostingsResponse = z.infer<typeof AccrualPostingsResponseSchema>;

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

// ---- /v1/analytics/stock_on_warehouses ------------------------------------

export const StockOnWarehousesRowSchema = z
  .object({
    sku: z.number().optional(),
    item_code: z.string().optional(),
    item_name: z.string().optional(),
    warehouse_name: z.string().optional(),
    free_to_sell_amount: z.number().optional(),
    promised_amount: z.number().optional(),
    reserved_amount: z.number().optional(),
  })
  .passthrough();

export const StockOnWarehousesResponseSchema = z
  .object({
    result: z
      .object({
        rows: z.array(StockOnWarehousesRowSchema).optional(),
      })
      .passthrough()
      .optional(),
    rows: z.array(StockOnWarehousesRowSchema).optional(),
  })
  .passthrough();

export type StockOnWarehousesRow = z.infer<typeof StockOnWarehousesRowSchema>;

// ---- /v2/warehouse/list (FBS/rFBS склады продавца) ------------------------
//
// Справочник: запрос `{ limit (обяз., <=200), cursor, warehouse_ids }`,
// ответ `{ cursor, warehouses: [...], has_next }`. `/v1/warehouse/list`
// отключается 07.04.2026 (замена — v2).
//
// Ozon Seller API — grpc-gateway, поэтому int64 в JSON приходит и числом,
// и строкой: `warehouse_id` всегда через `z.union([string, number])`.
// Ключевые поля (`warehouses`, `warehouse_id`, `name`) обязательны: клиент
// lenient (Zod fail → warn + raw), поэтому дрейф формы ловит чистый модуль
// `fbs-stocks-map.ts` и выносит его в `StageResult.warnings`.
// `has_next` в примере справочника — строка "string", в описании boolean:
// принимаем оба.

export const FbsWarehouseSchema = z
  .object({
    warehouse_id: z.union([z.string(), z.number()]),
    name: z.string(),
    /** `true` — rFBS-склад (доставка силами продавца). */
    is_rfbs: z.boolean().optional(),
    /** created / new / disabled / ... — статус склада в кабинете. */
    status: z.string().optional(),
    /** Значения в справочнике не перечислены (в примере "string"). */
    warehouse_type: z.string().optional(),
    is_kgt: z.boolean().optional(),
  })
  .passthrough();

export const WarehouseListResponseSchema = z
  .object({
    warehouses: z.array(FbsWarehouseSchema),
    cursor: z.string().optional(),
    has_next: z.union([z.boolean(), z.string()]).optional(),
  })
  .passthrough();

export type FbsWarehouse = z.infer<typeof FbsWarehouseSchema>;

// ---- /v2/product/info/stocks-by-warehouse/fbs -----------------------------
//
// Справочник: запрос `{ sku[] (<=1000), limit (обяз., <=1000), cursor }`,
// ответ `{ cursor, has_next, products: [{ free_stock, offer_id, present,
// product_id, reserved, sku, warehouse_id, warehouse_name }] }`.
// `/v1/product/info/stocks-by-warehouse/fbs` отключается 07.04.2026.
// Ключевые поля строки (`sku`, `warehouse_id`, `present`, `reserved`)
// обязательны; `free_stock` — по справочнику есть в примере, описания нет.

export const StocksByWarehouseFbsRowSchema = z
  .object({
    sku: z.union([z.string(), z.number()]),
    warehouse_id: z.union([z.string(), z.number()]),
    // int64 у grpc-gateway может прийти числовой строкой.
    present: z.union([z.number(), z.string()]),
    reserved: z.union([z.number(), z.string()]),
    free_stock: z.union([z.number(), z.string()]).optional(),
    product_id: z.union([z.string(), z.number()]).optional(),
    offer_id: z.string().optional(),
    warehouse_name: z.string().optional(),
  })
  .passthrough();

export const StocksByWarehouseFbsResponseSchema = z
  .object({
    products: z.array(StocksByWarehouseFbsRowSchema),
    cursor: z.string().optional(),
    has_next: z.union([z.boolean(), z.string()]).optional(),
  })
  .passthrough();

export type StocksByWarehouseFbsRow = z.infer<typeof StocksByWarehouseFbsRowSchema>;

export type ProductListItem = z.infer<typeof ProductListItemSchema>;
export type ProductInfo = z.infer<typeof ProductInfoSchema>;
export type PricesItem = z.infer<typeof PricesItemSchema>;
export type StocksItem = z.infer<typeof StocksItemSchema>;
export type FbsPosting = z.infer<typeof FbsPostingSchema>;
export type FboPosting = z.infer<typeof FboPostingSchema>;
export type RealizationRow = z.infer<typeof RealizationRowSchema>;
export type RealizationCommission = z.infer<typeof RealizationCommissionSchema>;
export type RealizationHeader = z.infer<typeof RealizationHeaderSchema>;
export type TransactionOperation = z.infer<typeof TransactionOperationSchema>;
export type TurnoverRow = z.infer<typeof TurnoverRowSchema>;
export type AnalyticsDataRow = z.infer<typeof AnalyticsDataRowSchema>;
export type AnalyticsDataResponse = z.infer<typeof AnalyticsDataResponseSchema>;
