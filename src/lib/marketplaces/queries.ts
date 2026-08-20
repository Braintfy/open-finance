// PURPOSE: Tenant-scoped запросы к таблицам marketplace_accounts и
// ozon_sync_jobs. Все запросы фильтруются по tenant_id. Plan-gate
// canAddAccount() ограничивает добавление >1 магазина на free/trial.

import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  marketplaceAccounts,
  ozonAnalyticsDaily,
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
  planLastSyncUpdate,
  type LastSyncStatus,
} from '@/lib/marketplaces/last-sync-plan';
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
  perfClientId?: string | null;
  perfClientSecret?: string | null;
  syncSettings?: OzonSyncSettings;
}): Promise<MarketplaceAccount> {
  const payload: NewMarketplaceAccount = {
    tenantId: input.tenantId,
    userId: input.userId,
    marketplace: input.marketplace,
    name: input.name,
    clientId: input.clientId,
    apiKeyEnc: encryptSecret(input.apiKey),
    perfClientId: input.perfClientId ?? null,
    perfClientSecretEnc:
      input.perfClientSecret && input.perfClientId
        ? encryptSecret(input.perfClientSecret)
        : null,
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
    /** Передать null чтобы отвязать Performance API. */
    perfClientId?: string | null;
    /** Передать null чтобы стереть Performance secret. */
    perfClientSecret?: string | null;
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
  if (args.patch.perfClientId !== undefined) {
    updates.perfClientId = args.patch.perfClientId;
    // Если отключаем Performance API — стираем секрет.
    if (args.patch.perfClientId === null) {
      updates.perfClientSecretEnc = null;
      updates.perfStatus = null;
    }
  }
  if (args.patch.perfClientSecret !== undefined) {
    updates.perfClientSecretEnc = args.patch.perfClientSecret
      ? encryptSecret(args.patch.perfClientSecret)
      : null;
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

/** Расшифровать Performance Client Secret. Только серверный код. */
export function decryptAccountPerfSecret(
  account: MarketplaceAccount,
): string | null {
  if (!account.perfClientSecretEnc) return null;
  return decryptSecret(account.perfClientSecretEnc);
}

/**
 * Обновить лейбл «уровень доступа к аналитике» в companyInfo.
 * Хранится в JSONB чтобы не плодить миграции — это вспомогательная пометка
 * для UI (бейдж «basic/premium-plus») и API аналитики (нужен ли fallback
 * на ozon_orders для cancellations/returns).
 */
export async function setAccountAnalyticsTier(args: {
  tenantId: string;
  id: string;
  tier: 'basic' | 'premium-plus';
}): Promise<void> {
  await db
    .update(marketplaceAccounts)
    .set({
      companyInfo: sql`jsonb_set(
        coalesce(${marketplaceAccounts.companyInfo}, '{}'::jsonb),
        '{_analyticsTier}',
        to_jsonb(${args.tier}::text),
        true
      )`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(marketplaceAccounts.tenantId, args.tenantId),
        eq(marketplaceAccounts.id, args.id),
      ),
    );
}

/** Обновить perf-статус после успешного теста / sync. */
export async function updateAccountPerfStatus(args: {
  tenantId: string;
  id: string;
  status: 'active' | 'error';
  error?: string | null;
  lastSyncAt?: Date | null;
}): Promise<void> {
  await db
    .update(marketplaceAccounts)
    .set({
      perfStatus: args.status,
      perfLastSyncError: args.error ?? null,
      perfLastSyncAt: args.lastSyncAt ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(marketplaceAccounts.tenantId, args.tenantId),
        eq(marketplaceAccounts.id, args.id),
      ),
    );
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

/**
 * `max(date)` из `ozon_analytics_daily` по каждому аккаунту — фактическое
 * покрытие данными (в отличие от `last_sync_at`, который говорит лишь о том,
 * что sync запускался). Один запрос с GROUP BY на все аккаунты (без N+1).
 * Скоуп по `tenant_id` обязателен — `accountIds` приходят из строк tenant'а,
 * но фильтр по tenant остаётся вторым замком (docs/TENANT_SCOPING.md).
 */
export async function getAnalyticsCoverageByAccount(args: {
  tenantId: string;
  accountIds: string[];
}): Promise<Record<string, string>> {
  if (args.accountIds.length === 0) return {};
  const rows = await db
    .select({
      accountId: ozonAnalyticsDaily.accountId,
      coveredThrough: sql<string | null>`max(${ozonAnalyticsDaily.date})::text`,
    })
    .from(ozonAnalyticsDaily)
    .where(
      and(
        eq(ozonAnalyticsDaily.tenantId, args.tenantId),
        inArray(ozonAnalyticsDaily.accountId, args.accountIds),
      ),
    )
    .groupBy(ozonAnalyticsDaily.accountId);

  const out: Record<string, string> = {};
  for (const row of rows) {
    if (row.coveredThrough) out[row.accountId] = row.coveredThrough.slice(0, 10);
  }
  return out;
}

/**
 * Сериализация аккаунта для отдачи на клиент (без расшифровки api_key).
 * `analyticsCoveredThrough` подставляется вызывающим кодом — обычно через
 * `toPublicAccountsWithCoverage()`, который берёт его одним агрегатом.
 */
export function toPublicAccount(
  account: MarketplaceAccount,
  analyticsCoveredThrough: string | null = null,
): AccountPublic {
  return {
    analyticsCoveredThrough,
    id: account.id,
    marketplace: account.marketplace,
    name: account.name,
    clientId: account.clientId,
    apiKeyMasked: maskSecret(account.apiKeyEnc),
    perfConnected: Boolean(account.perfClientId && account.perfClientSecretEnc),
    perfClientId: account.perfClientId ?? null,
    perfSecretMasked: account.perfClientSecretEnc
      ? maskSecret(account.perfClientSecretEnc)
      : null,
    perfStatus: account.perfStatus ?? null,
    perfLastSyncAt: account.perfLastSyncAt
      ? account.perfLastSyncAt.toISOString()
      : null,
    perfLastSyncError: account.perfLastSyncError ?? null,
    status: account.status,
    syncSettings: account.syncSettings,
    companyInfo: account.companyInfo,
    lastSyncAt: account.lastSyncAt ? account.lastSyncAt.toISOString() : null,
    lastSyncStatus: account.lastSyncStatus,
    lastSyncError: account.lastSyncError,
    lastSyncSummary: account.lastSyncSummary,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}

/**
 * Сериализация списка аккаунтов + подстановка фактического покрытия
 * аналитики. Coverage тянем одним GROUP BY-запросом на все ozon-аккаунты.
 */
export async function toPublicAccountsWithCoverage(args: {
  tenantId: string;
  accounts: MarketplaceAccount[];
}): Promise<AccountPublic[]> {
  const ozonIds = args.accounts
    .filter((a) => a.marketplace === 'ozon')
    .map((a) => a.id);
  const coverage = await getAnalyticsCoverageByAccount({
    tenantId: args.tenantId,
    accountIds: ozonIds,
  });
  return args.accounts.map((a) => toPublicAccount(a, coverage[a.id] ?? null));
}

/**
 * ВАЖНО: при `status: 'error'` НЕ двигаем `lastSyncAt` — см. инвариант в
 * `last-sync-plan.ts`. Упавший sync не должен «отмечать» период как
 * загруженный, иначе auto-preset схлопывает окно и данные теряются навсегда.
 */
export async function updateAccountLastSync(args: {
  tenantId: string;
  id: string;
  status: LastSyncStatus;
  error?: string;
  summary?: SyncSummary;
}): Promise<void> {
  await db
    .update(marketplaceAccounts)
    .set(
      planLastSyncUpdate({
        status: args.status,
        error: args.error,
        summary: args.summary,
      }),
    )
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

/** Закрывает как error зависшие pending-jobs старше N минут (фоновая задача
 * упала до setSyncJobRunning или процесс перезапустили) — иначе GlobalSyncIndicator
 * бесконечно показывает «подготовку к синхронизации». Нормальный переход
 * pending→running занимает секунды, поэтому 10 минут — безопасный порог. */
export async function failStaleSyncJobs(args: {
  tenantId: string;
  olderThanMinutes?: number;
}): Promise<void> {
  const cutoff = new Date(Date.now() - (args.olderThanMinutes ?? 10) * 60_000);
  await db
    .update(ozonSyncJobs)
    .set({
      status: 'error',
      finishedAt: new Date(),
      errors: [
        {
          message:
            'Синхронизация не стартовала (фоновый процесс прерван) — job закрыт автоматически',
          at: new Date().toISOString(),
        },
      ],
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(ozonSyncJobs.tenantId, args.tenantId),
        eq(ozonSyncJobs.status, 'pending'),
        lt(ozonSyncJobs.createdAt, cutoff),
      ),
    );
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
