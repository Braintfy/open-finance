// PURPOSE: Drizzle schema модуля «Склад · Поставки · Себестоимость» — СПРАВОЧНИКИ.
// Канон — docs/STOCK_MODULE_DESIGN.md §2.1-2.3 с уточнениями §12 (ответы пользователя).
// Документы, партии и лента движений — в соседнем файле stock-ledger.ts.
//
// Таблицы: stock_places (места хранения, включая виртуальные),
//          stock_items (каноническая номенклатура + кэш пула себестоимости),
//          stock_item_links (сшивка «наш товар ↔ SKU канала»).
//
// Инварианты (docs/STOCK_MODULE_DESIGN.md §1):
//   - склад ОДИН общий на бизнес: workspace_id НЕ добавляется ни в одну таблицу
//     модуля (§12.1), скоуп — tenant_id (+ user_id там, где есть автор записи);
//   - деньги — bigint копейки, стоимость хранится СУММОЙ, не ценой за штуку;
//   - qty_pool / value_pool_kopecks / avg_cost_kopecks в stock_items — КЭШ,
//     источник правды всегда stock_moves (проверяется scripts/test-stock-costing.ts);
//   - stock_item_links.scope_key NOT NULL сознательно: nullable-колонка в
//     уникальном индексе Postgres пропускает дубли (дефект существующего
//     unit_products_tenant_mp_article_idx — не повторяем).

import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  bigint,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { marketplaceAccounts } from './marketplaces';
import { unitProducts } from './unit-economics';

/** Тип места хранения. */
export type StockPlaceKind = 'own' | 'transit' | 'marketplace' | 'site' | 'virtual';

/**
 * Кто авторитет по остатку места:
 *   'ledger'   — остаток считается из stock_moves (наш журнал);
 *   'external' — остаток отдаёт API маркетплейса (ozon_warehouse_stocks),
 *                журнальных строк по такому месту не бывает никогда.
 */
export type StockPlaceAuthority = 'ledger' | 'external';

/** Канал продаж, с которым сшивается номенклатура. */
export type StockChannel = 'ozon' | 'wb' | 'yandex' | 'site';

/** Как получена сшивка товар ↔ SKU канала (см. src/lib/stock/links.ts). */
export type StockMatchSource = 'manual' | 'barcode' | 'name' | 'sku';

/**
 * Базис себестоимости (§12.2 — ДВА режима, переключаемых):
 *   'gross' — себестоимость с НДС (сумма из накладной как есть), дефолт;
 *   'net'   — себестоимость без НДС.
 * Хранится НА ДОКУМЕНТЕ ПОСТУПЛЕНИЯ И В ПАРТИИ, а не только в настройках:
 * ретроспективно расщепить партию на netto/brutto невозможно, поэтому
 * переключение режима действует ТОЛЬКО ВПЕРЁД, а исторические партии
 * остаются корректно интерпретируемыми.
 */
export type StockCostBasis = 'gross' | 'net';

/** Базис пула товара: 'mixed' — в пуле смешались партии разных базисов. */
export type StockPoolBasis = StockCostBasis | 'mixed';

// ---------------------------------------------------------------------------
// stock_places — места хранения (включая виртуальные)
// ---------------------------------------------------------------------------

export const stockPlaces = pgTable(
  'stock_places',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Стабильный код: own | transit_ozon | ozon_fbo | ozon_fbs | site_* | wb | yandex | loss. */
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 200 }).notNull(),
    kind: varchar('kind', { length: 16 }).$type<StockPlaceKind>().notNull(),
    /** 'ledger' (остаток из журнала) | 'external' (остаток из API маркетплейса). */
    authority: varchar('authority', { length: 10 })
      .$type<StockPlaceAuthority>()
      .notNull()
      .default('ledger'),
    accountId: uuid('account_id').references(() => marketplaceAccounts.id, {
      onDelete: 'set null',
    }),
    /** 'FBO' | 'FBS' — те же значения, что ozon_warehouse_stocks.source. */
    externalSource: varchar('external_source', { length: 8 }),
    /** Кластер Ozon (ozon_clusters.cluster_id), если место — конкретный склад. */
    clusterId: varchar('cluster_id', { length: 50 }),
    isActive: boolean('is_active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('stock_places_tenant_code_idx').on(t.tenantId, t.code),
    index('stock_places_tenant_kind_idx').on(t.tenantId, t.kind),
  ],
);

// ---------------------------------------------------------------------------
// stock_items — каноническая номенклатура
// ---------------------------------------------------------------------------

export const stockItems = pgTable(
  'stock_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Внутренний артикул (наш, не канальный). */
    sku: varchar('sku', { length: 80 }).notNull(),
    name: varchar('name', { length: 500 }).notNull().default(''),
    /** Сквозное измерение отчётов. */
    brand: varchar('brand', { length: 120 }),
    category: varchar('category', { length: 160 }),
    unit: varchar('unit', { length: 16 }).notNull().default('шт'),
    barcode: varchar('barcode', { length: 200 }),
    /** БАДы — контроль срока годности включён по умолчанию. */
    expiryControl: boolean('expiry_control').notNull().default(true),
    shelfLifeDays: integer('shelf_life_days'),

    // --- КЭШ реплея stock_moves. Источник правды — журнал, не эти колонки. ---
    /** Штук в местах с authority='ledger'. Может быть отрицательным (allow_negative). */
    qtyPool: integer('qty_pool').notNull().default(0),
    /** Стоимость пула, копейки. */
    valuePoolKopecks: bigint('value_pool_kopecks', { mode: 'number' }).notNull().default(0),
    /** round(value_pool / qty_pool); «липкая» — при нулевом пуле сохраняет прежнее значение. */
    avgCostKopecks: bigint('avg_cost_kopecks', { mode: 'number' }).notNull().default(0),
    /** Цена последней закупки (для «цена выросла на X%»). */
    lastCostKopecks: bigint('last_cost_kopecks', { mode: 'number' }).notNull().default(0),
    /**
     * Базис текущего пула (§12.2). 'mixed' — в пуле лежат партии разных базисов;
     * отчёты обязаны это пометить, молча суммировать нельзя.
     */
    costBasis: varchar('cost_basis', { length: 5 })
      .$type<StockPoolBasis>()
      .notNull()
      .default('gross'),
    /** Дубль-флаг для дешёвой фильтрации «покажи смешанные пулы». */
    costBasisMixed: boolean('cost_basis_mixed').notNull().default(false),

    /** Ручной override себестоимости; если NOT NULL — наружу отдаётся он. */
    costOverrideKopecks: bigint('cost_override_kopecks', { mode: 'number' }),
    costUpdatedAt: timestamp('cost_updated_at', { withTimezone: true }),
    /** Порог «пора закупать». */
    minQty: integer('min_qty').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('stock_items_tenant_sku_idx').on(t.tenantId, t.sku),
    index('stock_items_tenant_active_idx').on(t.tenantId, t.isActive),
    index('stock_items_tenant_brand_idx').on(t.tenantId, t.brand),
    index('stock_items_tenant_barcode_idx').on(t.tenantId, t.barcode),
  ],
);

// ---------------------------------------------------------------------------
// stock_item_links — сшивка каналов (блокер релиза, без неё модуль бесполезен)
// ---------------------------------------------------------------------------

export const stockItemLinks = pgTable(
  'stock_item_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => stockItems.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 16 }).$type<StockChannel>().notNull(),
    /**
     * account_id::text для маркетплейсов, 'shopb'/'shopa' для сайтов,
     * '-' если скоупа нет. NOT NULL СОЗНАТЕЛЬНО: nullable-колонка в уникальном
     * индексе Postgres пропускает дубли (ровно дефект unit_products_tenant_mp_article_idx).
     */
    scopeKey: varchar('scope_key', { length: 64 }).notNull().default('-'),
    /** offer_id / nmId / shopSku / Product.sku сайта. */
    externalId: varchar('external_id', { length: 200 }).notNull(),
    /** Числовой sku Ozon как второй ключ поиска. */
    externalSku: varchar('external_sku', { length: 200 }),
    /**
     * Карточка «3 банки» = 3 базовые единицы. Без этого остатки и COGS едут
     * КРАТНО — самый дорогой способ ошибиться в модуле.
     */
    qtyPerUnit: integer('qty_per_unit').notNull().default(1),
    /** Мост к юнит-экономике (many links → one unit_product). */
    unitProductId: uuid('unit_product_id').references(() => unitProducts.id, {
      onDelete: 'set null',
    }),
    accountId: uuid('account_id').references(() => marketplaceAccounts.id, {
      onDelete: 'set null',
    }),
    matchSource: varchar('match_source', { length: 16 })
      .$type<StockMatchSource>()
      .notNull()
      .default('manual'),
    /** 0-100, см. src/lib/stock/links.ts. */
    matchConfidence: integer('match_confidence').notNull().default(100),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('stock_links_uniq_idx').on(t.tenantId, t.channel, t.scopeKey, t.externalId),
    index('stock_links_item_idx').on(t.tenantId, t.itemId),
    index('stock_links_up_idx').on(t.unitProductId),
    index('stock_links_extsku_idx').on(t.tenantId, t.channel, t.externalSku),
  ],
);

export type StockPlace = typeof stockPlaces.$inferSelect;
export type NewStockPlace = typeof stockPlaces.$inferInsert;
export type StockItem = typeof stockItems.$inferSelect;
export type NewStockItem = typeof stockItems.$inferInsert;
export type StockItemLink = typeof stockItemLinks.$inferSelect;
export type NewStockItemLink = typeof stockItemLinks.$inferInsert;
