// PURPOSE: Drizzle schema модуля «Склад · Поставки · Себестоимость» — ДОКУМЕНТЫ И ЛЕНТА.
// Канон — docs/STOCK_MODULE_DESIGN.md §2.4-2.9 с уточнениями §12 (ответы пользователя).
// Справочники (места, номенклатура, сшивка каналов) — в соседнем файле stock.ts.
//
// Таблицы: stock_docs (шапка любой операции), stock_doc_lines (строки),
//          stock_batches (партии), stock_moves (неизменяемая лента),
//          stock_settings (одна строка на tenant), stock_recon (сверка с МП).
//
// Инварианты (docs/STOCK_MODULE_DESIGN.md §1):
//   1. единственный источник правды по ledger-местам — stock_moves;
//      остаток = SUM(qty_delta), стоимость = SUM(value_delta_kopecks);
//   3. ни одной операции без документа (adjust/writeoff/transfer/regrade — тоже документы);
//   4. физического удаления проведённого нет: только void → сторно-движения;
//      DELETE разрешён лишь для draft (у него нет движений);
//   5. деньги — bigint копейки, стоимость СУММОЙ (value_kopecks), не ценой за штуку;
//   6. списание = доля от ОСТАТОЧНОЙ стоимости пула, не qty × unit_cost;
//   8. потери (writeoff / reason='mp_shortage') ≠ COGS — отдельная статья.
//
// НДС (§12.2): cost_basis живёт НА ДОКУМЕНТЕ и В ПАРТИИ; stock_settings.cost_basis —
// только дефолт для НОВЫХ документов. Переключение действует ТОЛЬКО ВПЕРЁД.

import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  boolean,
  integer,
  bigint,
  numeric,
  date,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenants';
import { users } from './users';
import { marketplaceAccounts } from './marketplaces';
import { stockItems, stockPlaces, type StockCostBasis } from './stock';

/** Тип документа. Расширяется только вместе с постингом (src/lib/stock/posting.ts). */
export type StockDocKind =
  | 'opening'
  | 'purchase'
  | 'transfer'
  | 'accept'
  | 'writeoff'
  | 'adjust'
  | 'return_in'
  | 'regrade'
  /**
   * Продажа вне Ozon (WB / Яндекс.Маркет / сайты) — Релиз 2, импорт файлов (§12.3).
   * Отдельный вид, а не writeoff: §1.8 запрещает смешивать потери и себестоимость
   * проданного. Продажи Ozon движений НЕ порождают (§1.2) — их COGS считается
   * из ozon_realization по costAt().
   */
  | 'sale';

export type StockDocStatus = 'draft' | 'posted' | 'void';

/** Направление строки. `regrade` держит обе стороны в одном документе. */
export type StockLineDirection = 'in' | 'out';

/** Причина потери/корректировки (writeoff, adjust). */
export type StockDocReason =
  | 'expired'
  | 'damaged'
  | 'lost'
  | 'sample'
  | 'mp_shortage'
  | 'recount';

/** Метод разнесения доп. расходов документа по строкам. */
export type StockExtraAlloc = 'by_value' | 'by_qty' | 'none';

export type StockPaymentStatus = 'paid' | 'unpaid' | 'partial';

/** Модель оценки. v1 — только 'avg'; 'fifo' — вторая функция реплея в Релизе 4. */
export type StockCostingMode = 'avg' | 'fifo';

/** Порядок списания ШТУК из партий (оценка при costing_mode='avg' живёт на пуле). */
export type StockLotPolicy = 'fifo' | 'fefo';

export type StockReconStatus = 'open' | 'accepted' | 'ignored';

/** Аллокация партий: из каких партий ушли штуки (stock_moves.lot_alloc). */
export interface StockLotAllocEntry {
  batchId: string;
  qty: number;
}

/** Вложение документа (скан накладной и т.п.). */
export interface StockDocAttachment {
  name: string;
  url: string;
  size?: number;
  mime?: string;
}

// ---------------------------------------------------------------------------
// stock_docs — шапка любой операции
// ---------------------------------------------------------------------------

export const stockDocs = pgTable(
  'stock_docs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).$type<StockDocKind>().notNull(),
    status: varchar('status', { length: 8 })
      .$type<StockDocStatus>()
      .notNull()
      .default('draft'),
    /** Человекочитаемый номер вида ПОСТ-2026-0001, генерится сервером. */
    number: varchar('number', { length: 40 }),
    /** Дата хозоперации — единственное обязательное поле формы. */
    docDate: date('doc_date').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    fromPlaceId: uuid('from_place_id').references(() => stockPlaces.id, {
      onDelete: 'set null',
    }),
    toPlaceId: uuid('to_place_id').references(() => stockPlaces.id, {
      onDelete: 'set null',
    }),
    /** Свободный текст + автокомплит SELECT DISTINCT; справочника в v1 нет. */
    supplier: varchar('supplier', { length: 200 }).notNull().default(''),
    /** Задел под нормализацию поставщиков без миграции данных. */
    supplierInn: varchar('supplier_inn', { length: 12 }),
    /** Номер накладной поставщика. */
    docNumber: varchar('doc_number', { length: 80 }),
    currency: varchar('currency', { length: 3 }).notNull().default('RUB'),
    /** Согласовано с currency_rates.rate_rub (numeric(18,6)). */
    fxRate: numeric('fx_rate', { precision: 18, scale: 6 }),
    /** Сумма в валюте документа (минорные единицы). */
    amountOrigMinor: bigint('amount_orig_minor', { mode: 'number' }).notNull().default(0),
    /** Введённая в строках цена уже содержит НДС (типовой случай для розничных накладных). */
    priceIncludesVat: boolean('price_includes_vat').notNull().default(true),
    /**
     * §12.2: базис себестоимости ЭТОГО документа. Копируется в партии.
     * stock_settings.cost_basis — лишь дефолт для новых документов;
     * переключение режима НЕ переписывает историю.
     */
    costBasis: varchar('cost_basis', { length: 5 })
      .$type<StockCostBasis>()
      .notNull()
      .default('gross'),
    /** Доставка/пошлина/сертификация одной суммой. */
    extraCostKopecks: bigint('extra_cost_kopecks', { mode: 'number' }).notNull().default(0),
    extraAlloc: varchar('extra_alloc', { length: 10 })
      .$type<StockExtraAlloc>()
      .notNull()
      .default('by_value'),
    /** Кэш; обязан биться с Σ строк (инвариант §4.8.3). */
    totalKopecks: bigint('total_kopecks', { mode: 'number' }).notNull().default(0),
    vatTotalKopecks: bigint('vat_total_kopecks', { mode: 'number' }).notNull().default(0),
    /** Задел под платёжный календарь (ROADMAP D3). */
    paymentStatus: varchar('payment_status', { length: 8 })
      .$type<StockPaymentStatus>()
      .notNull()
      .default('paid'),
    reason: varchar('reason', { length: 24 }).$type<StockDocReason>(),
    /** Сторно ссылается на оригинал. */
    reversesDocId: uuid('reverses_doc_id'),
    /** manual | import | inbox | site:shopb | … */
    source: varchar('source', { length: 32 }).notNull().default('manual'),
    /** Ключ идемпотентности внешних импортов (§4.8.9). */
    sourceRef: varchar('source_ref', { length: 200 }),
    comment: text('comment'),
    attachments: jsonb('attachments')
      .$type<StockDocAttachment[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('stock_docs_tenant_date_idx').on(t.tenantId, t.docDate),
    index('stock_docs_tenant_kind_status_idx').on(t.tenantId, t.kind, t.status),
    // Частичные уникальные индексы: NULL-значения не должны конфликтовать между собой,
    // но и не должны создавать дыру в уникальности (см. дефект unit_products).
    uniqueIndex('stock_docs_number_idx')
      .on(t.tenantId, t.number)
      .where(sql`"number" is not null`),
    uniqueIndex('stock_docs_source_idx')
      .on(t.tenantId, t.source, t.sourceRef)
      .where(sql`"source_ref" is not null`),
  ],
);

// ---------------------------------------------------------------------------
// stock_doc_lines — строки документа (то, что ввёл человек)
// ---------------------------------------------------------------------------

export const stockDocLines = pgTable(
  'stock_doc_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    docId: uuid('doc_id')
      .notNull()
      .references(() => stockDocs.id, { onDelete: 'cascade' }),
    lineNo: integer('line_no').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'restrict' }),
    direction: varchar('direction', { length: 3 }).$type<StockLineDirection>().notNull(),
    /** Всегда положительное; знак задаёт direction. */
    qty: integer('qty').notNull(),
    /** Цена как в накладной (см. stock_docs.price_includes_vat). */
    unitPriceKopecks: bigint('unit_price_kopecks', { mode: 'number' }).notNull().default(0),
    /** Базисные пункты: 500 = 5 %, 2000 = 20 %. */
    vatRateBp: integer('vat_rate_bp').notNull().default(0),
    vatKopecks: bigint('vat_kopecks', { mode: 'number' }).notNull().default(0),
    /** Доля доп. расходов документа (проставляется при проводке). */
    extraAllocKopecks: bigint('extra_alloc_kopecks', { mode: 'number' }).notNull().default(0),
    /** Итоговая landed-сумма строки. У расходных строк заполняет движок себестоимости. */
    valueKopecks: bigint('value_kopecks', { mode: 'number' }).notNull().default(0),
    /** Номер партии производителя. */
    batchNumber: varchar('batch_number', { length: 64 }),
    expiresAt: date('expires_at'),
    /** «Цена по памяти» — тянется в партию и подсвечивается во всех отчётах. */
    isEstimated: boolean('is_estimated').notNull().default(false),
    /**
     * `adjust` — введённый фактический остаток (счёт по факту).
     * `accept`  — сколько принято складом маркетплейса ФАКТИЧЕСКИ, при qty =
     *   сколько отгружено. Разница проводится отдельной ногой потерь
     *   reason='mp_shortage' (§5 «Приёмка Ozon»). NULL = принято всё.
     */
    countedQty: integer('counted_qty'),
    /**
     * ПАРНАЯ СТРОКА документа `regrade` (Релиз 2, §4.5): у приходной строки
     * указывает line_no расходной, чью стоимость она забирает ЦЕЛИКОМ.
     * Сопоставление 1:1 — так Σ value_delta по документу == 0 держится
     * арифметически, без распределения долей и округлений.
     * У transfer/accept пара неявная (обе ноги делает одна строка), поэтому
     * там колонка не заполняется.
     */
    pairLineNo: integer('pair_line_no'),
    comment: text('comment'),
  },
  (t) => [
    uniqueIndex('stock_lines_doc_no_idx').on(t.docId, t.lineNo),
    index('stock_lines_tenant_item_idx').on(t.tenantId, t.itemId),
  ],
);

// ---------------------------------------------------------------------------
// stock_batches — партии (цена, поставщик, срок годности; FIFO-ready)
// ---------------------------------------------------------------------------

export const stockBatches = pgTable(
  'stock_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'restrict' }),
    docId: uuid('doc_id').references(() => stockDocs.id, { onDelete: 'set null' }),
    lineId: uuid('line_id').references(() => stockDocLines.id, { onDelete: 'set null' }),
    /** Наш номер партии: LOT-2026-0001. */
    lotNo: varchar('lot_no', { length: 40 }),
    /** Номер партии производителя. */
    batchNumber: varchar('batch_number', { length: 64 }),
    supplier: varchar('supplier', { length: 200 }).notNull().default(''),
    /** Порядок FIFO / отсчёт срока хранения. */
    receivedAt: date('received_at').notNull(),
    expiresAt: date('expires_at'),
    qtyIn: integer('qty_in').notNull(),
    /**
     * Уменьшается по lot_policy (FEFO по умолчанию). В режиме avg партия —
     * носитель ШТУК, СРОКА и ИСТОРИИ ЦЕН, а не единица оценки.
     * Инвариант: Σ batches.qty_left == stock_items.qty_pool.
     */
    qtyLeft: integer('qty_left').notNull(),
    /** round(value_in / qty_in) — витринное, для оценки не используется. */
    unitCostKopecks: bigint('unit_cost_kopecks', { mode: 'number' }).notNull().default(0),
    /** Точная landed-сумма партии — то, что реально попало в пул. */
    valueInKopecks: bigint('value_in_kopecks', { mode: 'number' }).notNull().default(0),
    vatKopecks: bigint('vat_kopecks', { mode: 'number' }).notNull().default(0),
    /**
     * §12.2: базис, в котором заведена ИМЕННО ЭТА партия (копия stock_docs.cost_basis).
     * Ретроспективно расщепить партию на netto/brutto невозможно — поэтому базис
     * фиксируется в момент прихода и больше не меняется.
     */
    costBasis: varchar('cost_basis', { length: 5 })
      .$type<StockCostBasis>()
      .notNull()
      .default('gross'),
    isEstimated: boolean('is_estimated').notNull().default(false),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('stock_batches_fifo_idx')
      .on(t.tenantId, t.itemId, t.receivedAt, t.id)
      .where(sql`"qty_left" > 0`),
    index('stock_batches_expiry_idx')
      .on(t.tenantId, t.expiresAt)
      .where(sql`"qty_left" > 0`),
    index('stock_batches_doc_idx').on(t.docId),
  ],
);

// ---------------------------------------------------------------------------
// stock_moves — неизменяемая лента (сердце модуля)
// ---------------------------------------------------------------------------

export const stockMoves = pgTable(
  'stock_moves',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Детерминированный порядок проводки; реплей сортирует по (doc_date, seq). */
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity(),
    docId: uuid('doc_id')
      .notNull()
      .references(() => stockDocs.id, { onDelete: 'cascade' }),
    lineId: uuid('line_id').references(() => stockDocLines.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'restrict' }),
    /** Место, чей остаток меняется. ВСЕГДА authority='ledger'. */
    placeId: uuid('place_id')
      .notNull()
      .references(() => stockPlaces.id, { onDelete: 'restrict' }),
    /** Вторая сторона перемещения (может быть external — например ozon_fbo). */
    counterPlaceId: uuid('counter_place_id').references(() => stockPlaces.id, {
      onDelete: 'set null',
    }),
    /** Знаковое количество. */
    qtyDelta: integer('qty_delta').notNull(),
    /** Знаковое изменение стоимости пула. SUM по товару == stock_items.value_pool_kopecks. */
    valueDeltaKopecks: bigint('value_delta_kopecks', { mode: 'number' }).notNull(),
    /** Снимок себестоимости единицы на момент проводки (для отчётов и возвратов). */
    unitValueKopecks: bigint('unit_value_kopecks', { mode: 'number' }).notNull().default(0),
    /**
     * Штук, которые пул НЕ смог покрыть (продажа/списание при пустом пуле).
     * Инвариант §1.10 «молчаливого нуля не бывает»: такие движения попадают
     * в карантин блока stock.gaps, а не считаются «COGS = 0».
     */
    uncoveredQty: integer('uncovered_qty').notNull().default(0),
    /**
     * Ретро-COGS: приход, который сразу ушёл на покрытие отрицательного пула
     * (забытая поставка введена задним числом). В value_delta НЕ попадает —
     * иначе qty_pool == 0 переставал бы означать value_pool == 0.
     */
    deficitSettledKopecks: bigint('deficit_settled_kopecks', { mode: 'number' })
      .notNull()
      .default(0),
    /** Денормализация stock_docs.kind ради отчётов без джойна. */
    kind: varchar('kind', { length: 16 }).$type<StockDocKind>().notNull(),
    reason: varchar('reason', { length: 24 }).$type<StockDocReason>(),
    /** Денормализация stock_docs.doc_date. */
    docDate: date('doc_date').notNull(),
    /** [{batchId, qty}] — из каких партий ушло (вместо отдельной таблицы аллокаций). */
    lotAlloc: jsonb('lot_alloc')
      .$type<StockLotAllocEntry[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    reversesMoveId: uuid('reverses_move_id'),
    /**
     * ПАРНАЯ НОГА (Релиз 2, §4.5): у ПРИХОДНОГО движения — id расходного, чью
     * пересчитанную стоимость оно забирает. Ровно так стоимость ПЕРЕНОСИТСЯ
     * между местами (transfer own → transit) и между позициями (regrade),
     * а не создаётся заново.
     *
     * Почему ссылка, а не сохранённое число: расходная нога переоценивается при
     * вводе документа задним числом (§4.7). Если бы приходная нога держала
     * снимок, после пересчёта Σ value_delta документа перестала бы быть нулём —
     * перемещение молча родило бы или съело прибыль. Тот же приём, что и у
     * reverses_move_id (см. replay-plan.ts, правила 1 и 4).
     */
    pairMoveId: uuid('pair_move_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('stock_moves_item_date_idx').on(t.tenantId, t.itemId, t.docDate, t.seq),
    index('stock_moves_place_idx').on(t.tenantId, t.placeId),
    index('stock_moves_doc_idx').on(t.docId),
    index('stock_moves_kind_date_idx').on(t.tenantId, t.kind, t.docDate),
    // Замыкание пересчёта: по этому индексу recalcItemsInTx находит товары,
    // связанные парными ногами (regrade), и переигрывает их ОДНИМ проходом.
    index('stock_moves_pair_idx').on(t.pairMoveId).where(sql`"pair_move_id" is not null`),
  ],
);

// ---------------------------------------------------------------------------
// stock_settings — одна строка на tenant
// ---------------------------------------------------------------------------

export const stockSettings = pgTable(
  'stock_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    costingMode: varchar('costing_mode', { length: 8 })
      .$type<StockCostingMode>()
      .notNull()
      .default('avg'),
    lotPolicy: varchar('lot_policy', { length: 6 })
      .$type<StockLotPolicy>()
      .notNull()
      .default('fefo'),
    /**
     * §12.2: ТОЛЬКО ДЕФОЛТ для новых документов поступления. Фактический базис
     * каждой партии живёт в stock_batches.cost_basis и задним числом не меняется.
     * UI при переключении обязан предупредить «действует только для новых поступлений».
     */
    costBasis: varchar('cost_basis', { length: 5 })
      .$type<StockCostBasis>()
      .notNull()
      .default('gross'),
    /** Дата, с которой начинается журнал (до неё P&L честно говорит «неизвестно»). */
    ledgerStartDate: date('ledger_start_date'),
    /** Период закрыт по эту дату включительно: проводка задним числом → 403. */
    lockedThrough: date('locked_through'),
    /** true по умолчанию — иначе забытая поставка блокирует ввод. */
    allowNegative: boolean('allow_negative').notNull().default(true),
    /** { purchase: 'ПОСТ', writeoff: 'СПИС', … } */
    numberPrefixes: jsonb('number_prefixes')
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex('stock_settings_tenant_idx').on(t.tenantId)],
);

// ---------------------------------------------------------------------------
// stock_recon — сверка с маркетплейсом (создаётся в 0013, наполняется в Релизе 2)
// ---------------------------------------------------------------------------

export const stockRecon = pgTable(
  'stock_recon',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /**
     * NOT NULL сознательно: колонка входит в уникальный индекс, а nullable-поле
     * в уникальном индексе Postgres пропускает дубли (дефект существующего
     * unit_products_tenant_mp_article_idx). Сверять есть с чем только там, где
     * остаток отдаёт API маркетплейса, то есть аккаунт всегда известен.
     */
    accountId: uuid('account_id')
      .notNull()
      .references(() => marketplaceAccounts.id, { onDelete: 'cascade' }),
    placeId: uuid('place_id')
      .notNull()
      .references(() => stockPlaces.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'cascade' }),
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }).notNull(),
    ledgerQty: integer('ledger_qty').notNull(),
    externalQty: integer('external_qty').notNull(),
    deltaQty: integer('delta_qty').notNull(),
    status: varchar('status', { length: 10 })
      .$type<StockReconStatus>()
      .notNull()
      .default('open'),
    resolvedDocId: uuid('resolved_doc_id').references(() => stockDocs.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('stock_recon_uniq_idx').on(
      t.tenantId,
      t.accountId,
      t.itemId,
      t.placeId,
      t.snapshotAt,
    ),
    index('stock_recon_open_idx')
      .on(t.tenantId, t.status)
      .where(sql`"status" = 'open'`),
  ],
);

export type StockDoc = typeof stockDocs.$inferSelect;
export type NewStockDoc = typeof stockDocs.$inferInsert;
export type StockDocLine = typeof stockDocLines.$inferSelect;
export type NewStockDocLine = typeof stockDocLines.$inferInsert;
export type StockBatch = typeof stockBatches.$inferSelect;
export type NewStockBatch = typeof stockBatches.$inferInsert;
export type StockMove = typeof stockMoves.$inferSelect;
export type NewStockMove = typeof stockMoves.$inferInsert;
export type StockSettingsRow = typeof stockSettings.$inferSelect;
export type NewStockSettingsRow = typeof stockSettings.$inferInsert;
export type StockReconRow = typeof stockRecon.$inferSelect;
export type NewStockReconRow = typeof stockRecon.$inferInsert;
