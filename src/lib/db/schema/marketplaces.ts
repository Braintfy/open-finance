// PURPOSE: Drizzle schema для модуля «Интеграции маркетплейсов».
// Таблицы: marketplace_accounts (подключённые магазины с зашифрованными
// API-ключами), ozon_sync_jobs (история синхронизаций),
// ozon_orders / ozon_realization / ozon_transactions (выгруженные данные
// для аналитики). См. drizzle/init/07-marketplaces.sql.

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
  bigint,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export type MarketplaceKind = 'ozon' | 'yandex' | 'wb';

export type AccountStatus = 'active' | 'error' | 'disabled';

/**
 * Конфигурация «что синхронизировать» для аккаунта. Используется UI-тогглами
 * и оркестратором синхронизации. Все поля опциональные с дефолтом true.
 */
export type OzonSyncSettings = {
  products?: boolean;
  prices?: boolean;
  stocks?: boolean;
  orders?: boolean;
  /** Окно заказов в днях (7/30/90). По умолчанию 30. */
  ordersWindowDays?: number;
  realization?: boolean;
  transactions?: boolean;
  /** Окно транзакций в днях. По умолчанию 30. */
  transactionsWindowDays?: number;
  turnover?: boolean;
  /**
   * Включён ли cron-режим (UI выставляет, но воркер ещё не реализован
   * — добавим в отдельной итерации). См. PLAN.md TODO «BullMQ cron».
   */
  autoSyncEnabled?: boolean;
  /** Cron-выражение. По умолчанию '0 6 * * *' (06:00 МСК). */
  autoSyncCron?: string;
  autoSyncLastRunAt?: string;
};

export type SyncSummary = {
  stages: Record<string, { ok: boolean; itemsProcessed?: number; durationMs?: number; error?: string }>;
  totalItems?: number;
  totalErrors?: number;
};

export const marketplaceAccounts = pgTable(
  'marketplace_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    marketplace: varchar('marketplace', { length: 20 }).$type<MarketplaceKind>().notNull(),
    name: varchar('name', { length: 200 }).notNull().default(''),
    /** Client-Id из ЛК Ozon (visible). */
    clientId: varchar('client_id', { length: 200 }).notNull(),
    /** Зашифрованный Api-Key (AES-256-GCM, формат v1.iv.tag.ct). */
    apiKeyEnc: text('api_key_enc').notNull(),
    status: varchar('status', { length: 20 }).$type<AccountStatus>().notNull().default('active'),
    syncSettings: jsonb('sync_settings').$type<OzonSyncSettings>().notNull().default({}),
    /** Привязанная компания (из /v1/seller/info после теста подключения). */
    companyInfo: jsonb('company_info').$type<Record<string, unknown>>().notNull().default({}),
    lastSyncAt: timestamp('last_sync_at'),
    lastSyncStatus: varchar('last_sync_status', { length: 20 }),
    lastSyncError: text('last_sync_error'),
    lastSyncSummary: jsonb('last_sync_summary').$type<SyncSummary>().notNull().default({ stages: {} }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('marketplace_accounts_tenant_idx').on(t.tenantId),
    uniqueIndex('marketplace_accounts_tenant_mp_client_idx').on(
      t.tenantId,
      t.marketplace,
      t.clientId,
    ),
  ],
);

export type SyncJobKind =
  | 'full'
  | 'products'
  | 'prices'
  | 'stocks'
  | 'orders'
  | 'realization'
  | 'transactions'
  | 'turnover';

export type SyncJobStatus = 'pending' | 'running' | 'success' | 'partial' | 'error';

export type SyncStageState = {
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
  itemsProcessed?: number;
  itemsTotal?: number;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
};

export const ozonSyncJobs = pgTable(
  'ozon_sync_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => marketplaceAccounts.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 20 }).$type<SyncJobKind>().notNull(),
    status: varchar('status', { length: 20 }).$type<SyncJobStatus>().notNull().default('pending'),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    itemsProcessed: integer('items_processed').notNull().default(0),
    itemsTotal: integer('items_total').notNull().default(0),
    /** Per-stage статусы. Ключ — kind стейджа. */
    stages: jsonb('stages').$type<Record<string, SyncStageState>>().notNull().default({}),
    errors: jsonb('errors').$type<Array<{ stage?: string; message: string; at: string }>>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('ozon_sync_jobs_tenant_idx').on(t.tenantId),
    index('ozon_sync_jobs_account_idx').on(t.accountId),
    index('ozon_sync_jobs_account_created_idx').on(t.accountId, t.createdAt),
  ],
);

export type OzonOrderScheme = 'fbo' | 'fbs';

export const ozonOrders = pgTable(
  'ozon_orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => marketplaceAccounts.id, { onDelete: 'cascade' }),
    postingNumber: varchar('posting_number', { length: 100 }).notNull(),
    scheme: varchar('scheme', { length: 10 }).$type<OzonOrderScheme>().notNull(),
    status: varchar('status', { length: 60 }).notNull(),
    orderCreatedAt: timestamp('order_created_at'),
    deliveredAt: timestamp('delivered_at'),
    cancelledAt: timestamp('cancelled_at'),
    returnedAt: timestamp('returned_at'),
    /** Список товаров: [{ sku, offer_id, name, quantity, price_kopecks }] */
    items: jsonb('items').$type<Array<Record<string, unknown>>>().notNull().default([]),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('ozon_orders_tenant_idx').on(t.tenantId),
    index('ozon_orders_account_idx').on(t.accountId),
    uniqueIndex('ozon_orders_account_posting_idx').on(t.accountId, t.postingNumber),
    index('ozon_orders_account_created_idx').on(t.accountId, t.orderCreatedAt),
  ],
);

export const ozonRealization = pgTable(
  'ozon_realization',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => marketplaceAccounts.id, { onDelete: 'cascade' }),
    periodFrom: timestamp('period_from').notNull(),
    periodTo: timestamp('period_to').notNull(),
    sku: varchar('sku', { length: 200 }),
    offerId: varchar('offer_id', { length: 200 }),
    qty: integer('qty').notNull().default(0),
    grossKopecks: bigint('gross_kopecks', { mode: 'number' }).notNull().default(0),
    commissionKopecks: bigint('commission_kopecks', { mode: 'number' }).notNull().default(0),
    logisticsKopecks: bigint('logistics_kopecks', { mode: 'number' }).notNull().default(0),
    adsKopecks: bigint('ads_kopecks', { mode: 'number' }).notNull().default(0),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('ozon_realization_tenant_idx').on(t.tenantId),
    index('ozon_realization_account_idx').on(t.accountId),
    index('ozon_realization_account_period_sku_idx').on(t.accountId, t.periodFrom, t.sku),
  ],
);

export const ozonTransactions = pgTable(
  'ozon_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => marketplaceAccounts.id, { onDelete: 'cascade' }),
    /** Идентификатор операции из Ozon (uniq в пределах account). */
    transactionId: bigint('transaction_id', { mode: 'number' }).notNull(),
    operationType: varchar('operation_type', { length: 80 }),
    operationDate: timestamp('operation_date'),
    amountKopecks: bigint('amount_kopecks', { mode: 'number' }).notNull().default(0),
    postingNumber: varchar('posting_number', { length: 100 }),
    sku: varchar('sku', { length: 200 }),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('ozon_transactions_tenant_idx').on(t.tenantId),
    index('ozon_transactions_account_idx').on(t.accountId),
    uniqueIndex('ozon_transactions_account_tx_idx').on(t.accountId, t.transactionId),
    index('ozon_transactions_account_date_idx').on(t.accountId, t.operationDate),
  ],
);

export type MarketplaceAccount = typeof marketplaceAccounts.$inferSelect;
export type NewMarketplaceAccount = typeof marketplaceAccounts.$inferInsert;
export type OzonSyncJob = typeof ozonSyncJobs.$inferSelect;
export type NewOzonSyncJob = typeof ozonSyncJobs.$inferInsert;
export type OzonOrder = typeof ozonOrders.$inferSelect;
export type NewOzonOrder = typeof ozonOrders.$inferInsert;
export type OzonRealizationRow = typeof ozonRealization.$inferSelect;
export type NewOzonRealizationRow = typeof ozonRealization.$inferInsert;
export type OzonTransaction = typeof ozonTransactions.$inferSelect;
export type NewOzonTransaction = typeof ozonTransactions.$inferInsert;
