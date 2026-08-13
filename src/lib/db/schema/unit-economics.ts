// PURPOSE: Drizzle schema для модуля «Юнит-экономика».
// Таблицы: unit_products (товары), unit_calculations (сохранённые расчёты),
// unit_imports (история импортов XLSX).

import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import { marketplaceAccounts } from './marketplaces';

export type UnitMarketplace = 'ozon' | 'yandex';

/**
 * Источник значения unit_products.cost_kopecks (§2.10 STOCK_MODULE_DESIGN).
 * 'manual' — дефолт, поведение до модуля «Склад» не меняется.
 */
export type UnitCostSource = 'manual' | 'inventory';

export const unitProducts = pgTable(
  'unit_products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    marketplace: varchar('marketplace', { length: 20 }).$type<UnitMarketplace>().notNull(),
    article: varchar('article', { length: 200 }),
    sku: varchar('sku', { length: 200 }),
    barcode: varchar('barcode', { length: 200 }),
    name: varchar('name', { length: 500 }).notNull().default(''),
    status: varchar('status', { length: 80 }),
    visibility: varchar('visibility', { length: 80 }),
    /** Остаток на складе маркетплейса (штук) */
    stockMarketplace: integer('stock_marketplace').notNull().default(0),
    /** Остаток на собственном складе (штук) */
    stockOwn: integer('stock_own').notNull().default(0),
    /** Цена в копейках (последняя известная) */
    priceKopecks: integer('price_kopecks').notNull().default(0),
    /** Себестоимость в копейках */
    costKopecks: integer('cost_kopecks').notNull().default(0),
    /**
     * Откуда взялась cost_kopecks (docs/STOCK_MODULE_DESIGN.md §2.10):
     *   'manual'    — ручной ввод / импорт XLSX (ДЕФОЛТ: ничего не меняет ни у кого);
     *   'inventory' — считает модуль «Склад» (src/lib/stock/writeback.ts).
     * Только строки с 'inventory' перезаписывает writeback склада. Количества
     * (stock_marketplace / stock_own) остаются территорией синка Ozon —
     * см. границу владения в шапке writeback.ts.
     */
    costSource: varchar('cost_source', { length: 16 })
      .$type<UnitCostSource>()
      .notNull()
      .default('manual'),
    /** Когда себестоимость обновлялась последний раз (любым источником). */
    costUpdatedAt: timestamp('cost_updated_at'),
    volumeL: integer('volume_l_x100').notNull().default(0), // объём * 100 для целого
    /**
     * Ссылка на подключённый маркетплейс-аккаунт (если товар синхронизирован
     * через Seller API). Nullable: для импорта из XLSX оставляем NULL.
     */
    marketplaceAccountId: uuid('marketplace_account_id').references(
      () => marketplaceAccounts.id,
      { onDelete: 'set null' },
    ),
    /** Прочие данные импорта (например полный набор колонок Ozon) */
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('unit_products_tenant_idx').on(t.tenantId),
    index('unit_products_tenant_marketplace_idx').on(t.tenantId, t.marketplace),
    uniqueIndex('unit_products_tenant_mp_article_idx').on(t.tenantId, t.marketplace, t.article),
    index('unit_products_marketplace_account_idx').on(t.marketplaceAccountId),
  ],
);

export type UnitCalculationMode =
  | 'ozon_fbo'
  | 'ozon_fbs'
  | 'yandex_fby'
  | 'yandex_fbs'
  | 'yandex_dbs'
  | 'yandex_express';

export const unitCalculations = pgTable(
  'unit_calculations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => unitProducts.id, { onDelete: 'set null' }),
    marketplace: varchar('marketplace', { length: 20 }).$type<UnitMarketplace>().notNull(),
    mode: varchar('mode', { length: 30 }).$type<UnitCalculationMode>().notNull(),
    tariffVersion: varchar('tariff_version', { length: 60 }).notNull(),
    /** Нормализованные входы калькулятора (см. types.ts) */
    inputs: jsonb('inputs').$type<Record<string, unknown>>().notNull().default({}),
    /** Привязки ячеек: { fieldKey: UnitCellBinding } */
    bindings: jsonb('bindings').$type<Record<string, unknown>>().notNull().default({}),
    /** Последний результат для быстрых таблиц/аналитики */
    results: jsonb('results').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('unit_calculations_tenant_idx').on(t.tenantId),
    index('unit_calculations_tenant_marketplace_idx').on(t.tenantId, t.marketplace),
    index('unit_calculations_product_idx').on(t.productId),
  ],
);

export const unitImports = pgTable(
  'unit_imports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 80 }).notNull(), // ozon-price-template, manual
    filename: varchar('filename', { length: 500 }),
    rowsTotal: integer('rows_total').notNull().default(0),
    rowsImported: integer('rows_imported').notNull().default(0),
    /** Список ошибок/предупреждений */
    errors: jsonb('errors').$type<Array<Record<string, unknown>>>().notNull().default([]),
    /** Сводка: какие колонки распознаны, какие нет */
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('unit_imports_tenant_idx').on(t.tenantId),
    index('unit_imports_tenant_created_idx').on(t.tenantId, t.createdAt),
  ],
);

export type UnitProduct = typeof unitProducts.$inferSelect;
export type NewUnitProduct = typeof unitProducts.$inferInsert;
export type UnitCalculation = typeof unitCalculations.$inferSelect;
export type NewUnitCalculation = typeof unitCalculations.$inferInsert;
export type UnitImport = typeof unitImports.$inferSelect;
export type NewUnitImport = typeof unitImports.$inferInsert;
