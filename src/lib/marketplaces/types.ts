// PURPOSE: Общие типы и Zod-схемы модуля «Интеграции маркетплейсов».
// Поведенческие типы тогглов синхронизации, summary'ы, утилитарные
// type-aliases. Без зависимостей от React/DB.

import { z } from 'zod';
import type {
  MarketplaceKind,
  OzonSyncSettings,
  AccountStatus,
  SyncJobKind,
  SyncJobStatus,
  SyncStageState,
  SyncSummary,
} from '@/lib/db/schema/marketplaces';

export type {
  MarketplaceKind,
  OzonSyncSettings,
  AccountStatus,
  SyncJobKind,
  SyncJobStatus,
  SyncStageState,
  SyncSummary,
};

/** Список всех стейджей в порядке выполнения для полной синхронизации. */
export const OZON_FULL_STAGES = [
  'products',
  'prices',
  'stocks',
  'analyticsData',
  'orders',
  'realization',
  'transactions',
  'turnover',
  'clusters',
  'warehouseStocks',
  // Идёт сразу за FBO-остатками: обе пишут в ozon_warehouse_stocks, но в
  // непересекающиеся окна (source='FBO' / 'FBS').
  'fbsWarehouseStocks',
  'perfCampaigns',
  'perfSkuStats',
  'perfCpoDaily',
  'perfExpenseDaily',
  'perfPhrases',
] as const;

export type OzonStageKind = (typeof OZON_FULL_STAGES)[number];

/** Дефолтные настройки тогглов для нового аккаунта. */
export const DEFAULT_OZON_SYNC_SETTINGS: Required<
  Pick<
    OzonSyncSettings,
    | 'products'
    | 'prices'
    | 'stocks'
    | 'orders'
    | 'ordersWindowDays'
    | 'realization'
    | 'transactions'
    | 'transactionsWindowDays'
    | 'turnover'
    | 'autoSyncEnabled'
    | 'autoSyncCron'
    | 'perfCampaigns'
    | 'perfSkuStats'
    | 'perfCpoDaily'
    | 'perfExpenseDaily'
    | 'perfPhrases'
    | 'perfWindowDays'
    | 'analyticsData'
    | 'analyticsWindowDays'
    | 'clusters'
    | 'warehouseStocks'
    | 'fbsWarehouseStocks'
  >
> = {
  products: true,
  prices: true,
  stocks: true,
  orders: true,
  // 90 дней покрывают большинство аналитических окон (mtd/30d/buyout 90d).
  // 30 ранее давали «нет данных» при выборе периода mtd.
  ordersWindowDays: 90,
  realization: true,
  transactions: false,
  transactionsWindowDays: 90,
  turnover: true,
  autoSyncEnabled: false,
  autoSyncCron: '0 6 * * *',
  perfCampaigns: true,
  perfSkuStats: true,
  perfCpoDaily: true,
  perfExpenseDaily: true,
  perfPhrases: false,
  perfWindowDays: 30,
  analyticsData: true,
  clusters: true,
  warehouseStocks: true,
  // Дефолт как у остальных snapshot-стейджей: у продавцов без своих складов
  // `/v1/warehouse/list` просто вернёт пустой список (стейдж ok, 0 строк).
  fbsWarehouseStocks: true,
  // Без Premium даты ограничены 3 месяцами; для Premium Plus можно больше,
  // но 90 дней — разумный baseline для блока аналитики.
  analyticsWindowDays: 90,
};

export const OzonSyncSettingsSchema = z
  .object({
    products: z.boolean().optional(),
    prices: z.boolean().optional(),
    stocks: z.boolean().optional(),
    orders: z.boolean().optional(),
    ordersWindowDays: z.number().int().min(1).max(365).optional(),
    realization: z.boolean().optional(),
    transactions: z.boolean().optional(),
    transactionsWindowDays: z.number().int().min(1).max(365).optional(),
    turnover: z.boolean().optional(),
    autoSyncEnabled: z.boolean().optional(),
    autoSyncCron: z.string().max(64).optional(),
    autoSyncLastRunAt: z.string().optional(),
    perfCampaigns: z.boolean().optional(),
    perfSkuStats: z.boolean().optional(),
    perfCpoDaily: z.boolean().optional(),
    perfExpenseDaily: z.boolean().optional(),
    perfPhrases: z.boolean().optional(),
    perfWindowDays: z.number().int().min(1).max(365).optional(),
    analyticsData: z.boolean().optional(),
    analyticsWindowDays: z.number().int().min(1).max(365).optional(),
    clusters: z.boolean().optional(),
    warehouseStocks: z.boolean().optional(),
    fbsWarehouseStocks: z.boolean().optional(),
  })
  .strict();

export const CreateAccountSchema = z
  .object({
    marketplace: z.enum(['ozon', 'yandex', 'wb']),
    name: z.string().min(1).max(200),
    clientId: z.string().min(1).max(200),
    apiKey: z.string().min(8).max(500),
    /** Performance API Client ID (опциональный). */
    perfClientId: z.string().min(1).max(200).optional(),
    /** Performance API Client Secret (опциональный, до 500 символов). */
    perfClientSecret: z.string().min(8).max(500).optional(),
    syncSettings: OzonSyncSettingsSchema.optional(),
  })
  .strict();

export const UpdateAccountSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    clientId: z.string().min(1).max(200).optional(),
    apiKey: z.string().min(8).max(500).optional(),
    perfClientId: z.string().min(1).max(200).optional().nullable(),
    perfClientSecret: z.string().min(8).max(500).optional().nullable(),
    status: z.enum(['active', 'error', 'disabled']).optional(),
    syncSettings: OzonSyncSettingsSchema.optional(),
  })
  .strict();

export type CreateAccountInput = z.infer<typeof CreateAccountSchema>;
export type UpdateAccountInput = z.infer<typeof UpdateAccountSchema>;

export type AccountPublic = {
  id: string;
  marketplace: MarketplaceKind;
  name: string;
  clientId: string;
  apiKeyMasked: string;
  /** Performance API подключён (есть и client_id, и secret). */
  perfConnected: boolean;
  perfClientId: string | null;
  perfSecretMasked: string | null;
  perfStatus: string | null;
  perfLastSyncAt: string | null;
  perfLastSyncError: string | null;
  status: AccountStatus;
  syncSettings: OzonSyncSettings;
  companyInfo: Record<string, unknown>;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  lastSyncSummary: SyncSummary;
  createdAt: string;
  updatedAt: string;
};

/**
 * План tenant'а. Premium-планы могут добавлять более одного marketplace-аккаунта.
 * Источник: tenants.plan (см. src/lib/db/schema/tenants.ts).
 */
export const PREMIUM_PLANS = new Set(['pro', 'business', 'enterprise']);

export function isPremiumPlan(plan: string | null | undefined): boolean {
  if (!plan) return false;
  return PREMIUM_PLANS.has(plan);
}
