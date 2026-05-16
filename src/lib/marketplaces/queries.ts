// PURPOSE: Tenant-scoped запросы к таблицам marketplace_accounts и
// ozon_sync_jobs. Все запросы фильтруются по tenant_id. Plan-gate
// canAddAccount() ограничивает добавление >1 магазина на free/trial.

import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  marketplaceAccounts,
  ozonSyncJobs,
  type MarketplaceAccount,
  type NewMarketplaceAccount,
  type NewOzonSyncJob,
  type OzonSyncJob,
  type SyncStageState,
  type SyncJobKind,
  type SyncJobStatus,
  type AccountStatus,
  type OzonSyncSettings,
  type SyncSummary,
} from '@/lib/db/schema/marketplaces';
import { tenants } from '@/lib/db/schema/tenants';
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
} from '@/lib/marketplaces/crypto';
import {
  DEFAULT_OZON_SYNC_SETTINGS,
  isPremiumPlan,
  type AccountPublic,
  type MarketplaceKind,
} from '@/lib/marketplaces/types';

// ---------------------------------------------------------------------------
// Accounts CRUD
// ---------------------------------------------------------------------------

export async function listAccounts(args: {
  tenantId: string;
  marketplace?: MarketplaceKind;
}): Promise<MarketplaceAccount[]> {
  const conds = [eq(marketplaceAccounts.tenantId, args.tenantId)];
  if (args.marketplace) {
    conds.push(eq(marketplaceAccounts.marketplace, args.marketplace));
  }
  return db
    .select()
    .from(marketplaceAccounts)
    .where(and(...conds))
    .orderBy(desc(marketplaceAccounts.createdAt));
}

export async function getAccount(args: {
  tenantId: string;
  id: string;
}): Promise<MarketplaceAccount | null> {
  const [row] = await db
    .select()
    .from(marketplaceAccounts)
    .where(
      and(
        eq(marketplaceAccounts.tenantId, args.tenantId),
        eq(marketplaceAccounts.id, args.id),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Проверка plan-gate: можно ли добавить ещё один аккаунт.
 * free / trial_pro → max 1 (для текущего marketplace); pro+ → unlimited.
 */
export async function canAddAccount(args: {
  tenantId: string;
  marketplace: MarketplaceKind;
}): Promise<{ allowed: boolean; reason?: string }> {
  const [tenant] = await db
    .select({ plan: tenants.plan })
    .from(tenants)
    .where(eq(tenants.id, args.tenantId))
    .limit(1);
  if (!tenant) return { allowed: false, reason: 'Tenant not found' };
  if (isPremiumPlan(tenant.plan)) return { allowed: true };

  const existing = await db
    .select({ id: marketplaceAccounts.id })
    .from(marketplaceAccounts)
    .where(
      and(
        eq(marketplaceAccounts.tenantId, args.tenantId),
        eq(marketplaceAccounts.marketplace, args.marketplace),
      ),
    )
    .limit(2);

  if (existing.length === 0) return { allowed: true };
  return {
    allowed: false,
    reason: 'Добавление нескольких магазинов доступно в тарифе Pro и выше.',
  };
}

export async function createAccount(input: {
  tenantId: string;
  userId: string;
  marketplace: MarketplaceKind;
  name: string;
  clientId: string;
  apiKey: string;
  syncSettings?: OzonSyncSettings;
}): Promise<MarketplaceAccount> {
  const payload: NewMarketplaceAccount = {
    tenantId: input.tenantId,
    userId: input.userId,
    marketplace: input.marketplace,
    name: input.name,
    clientId: input.clientId,
    apiKeyEnc: encryptSecret(input.apiKey),
    status: 'active',
    syncSettings: { ...DEFAULT_OZON_SYNC_SETTINGS, ...(input.syncSettings ?? {}) },
  };
  const [row] = await db.insert(marketplaceAccounts).values(payload).returning();
  return row;
}

export async function updateAccount(args: {
  tenantId: string;
  id: string;
  patch: {
    name?: string;
    clientId?: string;
    apiKey?: string;
    status?: AccountStatus;
    syncSettings?: OzonSyncSettings;
    companyInfo?: Record<string, unknown>;
  };
}): Promise<MarketplaceAccount | null> {
  const updates: Partial<NewMarketplaceAccount> = { updatedAt: new Date() };
  if (args.patch.name !== undefined) updates.name = args.patch.name;
  if (args.patch.clientId !== undefined) updates.clientId = args.patch.clientId;
  if (args.patch.apiKey !== undefined) {
    updates.apiKeyEnc = encryptSecret(args.patch.apiKey);
  }
  if (args.patch.status !== undefined) updates.status = args.patch.status;
  if (args.patch.syncSettings !== undefined) {
    updates.syncSettings = args.patch.syncSettings;
  }
  if (args.patch.companyInfo !== undefined) {
    updates.companyInfo = args.patch.companyInfo;
  }
  const [row] = await db
    .update(marketplaceAccounts)
    .set(updates)
    .where(
      and(
        eq(marketplaceAccounts.tenantId, args.tenantId),
        eq(marketplaceAccounts.id, args.id),
      ),
    )
    .returning();
  return row ?? null;
}

export async function deleteAccount(args: {
  tenantId: string;
  id: string;
}): Promise<void> {
  await db
    .delete(marketplaceAccounts)
    .where(
      and(
        eq(marketplaceAccounts.tenantId, args.tenantId),
        eq(marketplaceAccounts.id, args.id),
      ),
    );
}

/** Расшифровать api_key. Только внутри серверного кода. */
export function decryptAccountApiKey(account: MarketplaceAccount): string {
  return decryptSecret(account.apiKeyEnc);
}

/** Сериализация аккаунта для отдачи на клиент (без расшифровки api_key). */
export function toPublicAccount(account: MarketplaceAccount): AccountPublic {
  return {
    id: account.id,
    marketplace: account.marketplace,
    name: account.name,
    clientId: account.clientId,
    apiKeyMasked: maskSecret(account.apiKeyEnc),
    status: account.status,
    syncSettings: account.syncSettings,
    companyInfo: account.companyInfo,
    lastSyncAt: account.lastSyncAt ? account.lastSyncAt.toISOString() : null,
    lastSyncStatus: account.lastSyncStatus,
    lastSyncError: account.lastSyncError,
    lastSyncSummary: account.lastSyncSummary as unknown as Record<string, unknown>,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

export async function updateAccountLastSync(args: {
  tenantId: string;
  id: string;
  status: 'success' | 'partial' | 'error';
  error?: string;
  summary?: SyncSummary;
}): Promise<void> {
  await db
    .update(marketplaceAccounts)
    .set({
      lastSyncAt: new Date(),
      lastSyncStatus: args.status,
      lastSyncError: args.error ?? null,
      lastSyncSummary: args.summary ?? { stages: {} },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(marketplaceAccounts.tenantId, args.tenantId),
        eq(marketplaceAccounts.id, args.id),
      ),
    );
}

// ---------------------------------------------------------------------------
// Sync jobs
// ---------------------------------------------------------------------------

export async function createSyncJob(input: {
  tenantId: string;
  accountId: string;
  kind: SyncJobKind;
  stages: Record<string, SyncStageState>;
}): Promise<OzonSyncJob> {
  const payload: NewOzonSyncJob = {
    tenantId: input.tenantId,
    accountId: input.accountId,
    kind: input.kind,
    status: 'pending',
    stages: input.stages,
  };
  const [row] = await db.insert(ozonSyncJobs).values(payload).returning();
  return row;
}

export async function setSyncJobRunning(jobId: string): Promise<void> {
  await db
    .update(ozonSyncJobs)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(ozonSyncJobs.id, jobId));
}

export async function updateSyncJobStage(args: {
  jobId: string;
  stage: string;
  state: SyncStageState;
}): Promise<void> {
  // Merge через jsonb_set, чтобы избежать гонок с другими стейджами.
  await db
    .update(ozonSyncJobs)
    .set({
      stages: sql`jsonb_set(${ozonSyncJobs.stages}, ${'{' + args.stage + '}'}::text[], ${JSON.stringify(
        args.state,
      )}::jsonb, true)`,
      updatedAt: new Date(),
    })
    .where(eq(ozonSyncJobs.id, args.jobId));
}

export async function finishSyncJob(args: {
  jobId: string;
  status: SyncJobStatus;
  itemsProcessed?: number;
  itemsTotal?: number;
  errors?: Array<{ stage?: string; message: string; at: string }>;
}): Promise<void> {
  await db
    .update(ozonSyncJobs)
    .set({
      status: args.status,
      finishedAt: new Date(),
      itemsProcessed: args.itemsProcessed ?? 0,
      itemsTotal: args.itemsTotal ?? 0,
      errors: args.errors ?? [],
      updatedAt: new Date(),
    })
    .where(eq(ozonSyncJobs.id, args.jobId));
}

export async function listSyncJobs(args: {
  tenantId: string;
  accountId: string;
  limit?: number;
}): Promise<OzonSyncJob[]> {
  return db
    .select()
    .from(ozonSyncJobs)
    .where(
      and(
        eq(ozonSyncJobs.tenantId, args.tenantId),
        eq(ozonSyncJobs.accountId, args.accountId),
      ),
    )
    .orderBy(desc(ozonSyncJobs.createdAt))
    .limit(args.limit ?? 20);
}

export async function getSyncJob(args: {
  tenantId: string;
  jobId: string;
}): Promise<OzonSyncJob | null> {
  const [row] = await db
    .select()
    .from(ozonSyncJobs)
    .where(
      and(eq(ozonSyncJobs.tenantId, args.tenantId), eq(ozonSyncJobs.id, args.jobId)),
    )
    .limit(1);
  return row ?? null;
}
