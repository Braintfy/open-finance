// PURPOSE: Оркестратор полной синхронизации Ozon-аккаунта.
// Последовательно прогоняет стейджи, обновляет ozon_sync_jobs.stages
// и финализирует job/account.last_sync_*.
//
// Стейджи запускаются в фиксированном порядке (см. OZON_FULL_STAGES в
// lib/marketplaces/types.ts). Каждый стейдж — отдельный пункт в settings;
// если settings[stage] === false → стейдж помечается 'skipped'.

import {
  decryptAccountApiKey,
  decryptAccountPerfSecret,
  finishSyncJob,
  getAccount,
  setSyncJobRunning,
  updateAccountLastSync,
  updateAccountPerfStatus,
  updateSyncJobStage,
} from '@/lib/marketplaces/queries';
import { OzonClient } from '../client';
import { OzonPerformanceClient } from '../performance/client';
import { syncProductsStage } from './products';
import { syncPricesStage } from './prices';
import { syncStocksStage } from './stocks';
import { syncOrdersStage } from './orders';
import { syncRealizationStage } from './realization';
import { syncTransactionsStage } from './transactions';
import { syncTurnoverStage } from './turnover';
import { syncPerfCampaignsStage } from './perf-campaigns';
import { syncPerfSkuStatsStage } from './perf-sku-stats';
import { syncPerfCpoDailyStage } from './perf-cpo-daily';
import { syncPerfExpenseDailyStage } from './perf-expense-daily';
import { syncPerfPhrasesStage } from './perf-phrases';
import { syncAnalyticsDataStage } from './analytics-data';
import { syncClustersStage } from './clusters';
import { syncWarehouseStocksStage } from './warehouse-stocks';
import type { StageContext, StageResult } from './types';
import {
  OZON_FULL_STAGES,
  DEFAULT_OZON_SYNC_SETTINGS,
  type OzonStageKind,
} from '@/lib/marketplaces/types';
import type {
  SyncStageState,
  SyncJobStatus,
} from '@/lib/db/schema/marketplaces';

const STAGE_RUNNERS: Record<OzonStageKind, (ctx: StageContext) => Promise<StageResult>> = {
  products: syncProductsStage,
  prices: syncPricesStage,
  stocks: syncStocksStage,
  analyticsData: syncAnalyticsDataStage,
  orders: syncOrdersStage,
  realization: syncRealizationStage,
  transactions: syncTransactionsStage,
  turnover: syncTurnoverStage,
  clusters: syncClustersStage,
  warehouseStocks: syncWarehouseStocksStage,
  perfCampaigns: syncPerfCampaignsStage,
  perfSkuStats: syncPerfSkuStatsStage,
  perfCpoDaily: syncPerfCpoDailyStage,
  perfExpenseDaily: syncPerfExpenseDailyStage,
  perfPhrases: syncPerfPhrasesStage,
};

const PERF_STAGES: ReadonlySet<OzonStageKind> = new Set([
  'perfCampaigns',
  'perfSkuStats',
  'perfCpoDaily',
  'perfExpenseDaily',
  'perfPhrases',
  // Note: `clusters` ушёл из этого списка в v0.18.22 — `/v1/cluster/list`
  // живёт в Seller API, Performance API клиент для него не нужен.
]);

export type RunFullSyncArgs = {
  tenantId: string;
  userId: string;
  accountId: string;
  jobId: string;
  /** Если задан — синхронизирует только этот стейдж (игнорируя тогглы). */
  onlyStage?: OzonStageKind;
  /**
   * Дополнительный override на per-stage флаги enabled. Используется UI
   * блока аналитики, чтобы пользователь мог выбрать набор стейджей не
   * меняя постоянные `account.syncSettings`. Передаётся как
   * `Partial<Record<OzonStageKind, boolean>>` — true включает, false
   * выключает, отсутствие ключа = взять из `settings`.
   */
  stagesOverride?: Partial<Record<OzonStageKind, boolean>>;
  /**
   * v0.22.1: Override sliding-window для date-aware стейджей. Прокидывается
   * в `StageContext.overrideFromDate/ToDate`. Если не задано — стейджи
   * используют `settings.*WindowDays`.
   */
  overrideFromDate?: string;
  overrideToDate?: string;
  /** v0.22.1: Принудительная перезапись (см. StageContext.force). */
  force?: boolean;
};

export async function runFullSync(args: RunFullSyncArgs): Promise<void> {
  const account = await getAccount({ tenantId: args.tenantId, id: args.accountId });
  if (!account) {
    await finishSyncJob({
      jobId: args.jobId,
      status: 'error',
      errors: [{ message: 'Account not found', at: new Date().toISOString() }],
    });
    return;
  }

  const apiKey = decryptAccountApiKey(account);
  const client = new OzonClient({ clientId: account.clientId, apiKey });
  const settings = { ...DEFAULT_OZON_SYNC_SETTINGS, ...(account.syncSettings ?? {}) };

  // Опционально готовим Performance API клиент (если перф-креды есть).
  let perfClient: OzonPerformanceClient | null = null;
  const perfSecret = decryptAccountPerfSecret(account);
  if (account.perfClientId && perfSecret) {
    perfClient = new OzonPerformanceClient({
      accountId: account.id,
      clientId: account.perfClientId,
      clientSecret: perfSecret,
    });
  }

  await setSyncJobRunning(args.jobId);

  const baseCtx = {
    tenantId: args.tenantId,
    userId: args.userId,
    accountId: args.accountId,
  };

  const errors: Array<{ stage?: string; message: string; at: string }> = [];
  let totalProcessed = 0;
  let anyFailure = false;
  let anySuccess = false;
  let perfStageSucceeded = false;
  let perfStageFailedMessage: string | null = null;
  // Собираем per-stage метрики для lastSyncSummary — UI читает оттуда
  // быстрее, чем из ozon_sync_jobs.
  const stageSummary: Record<
    string,
    {
      ok: boolean;
      itemsProcessed: number;
      itemsTotal?: number;
      warnings?: string[];
      error?: string;
    }
  > = {};

  const stagesToRun = args.onlyStage
    ? ([args.onlyStage] as OzonStageKind[])
    : ([...OZON_FULL_STAGES] as OzonStageKind[]);

  for (const stage of stagesToRun) {
    const overrideValue = args.stagesOverride?.[stage];
    const enabled = overrideValue !== undefined
      ? overrideValue
      : (settings as Record<string, unknown>)[stage] !== false;
    const isPerfStage = PERF_STAGES.has(stage);
    const skipPerfNoCreds = isPerfStage && !perfClient;

    if (!enabled || skipPerfNoCreds) {
      const state: SyncStageState = {
        status: 'skipped',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        error: skipPerfNoCreds ? 'Performance API креды не подключены' : undefined,
      };
      await updateSyncJobStage({ jobId: args.jobId, stage, state });
      stageSummary[stage] = {
        ok: true,
        itemsProcessed: 0,
        error: skipPerfNoCreds ? 'Performance API креды не подключены' : undefined,
      };
      continue;
    }

    const runningState: SyncStageState = {
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    await updateSyncJobStage({ jobId: args.jobId, stage, state: runningState });

    const result = await STAGE_RUNNERS[stage]({
      ...baseCtx,
      client,
      perfClient,
      settings,
      overrideFromDate: args.overrideFromDate,
      overrideToDate: args.overrideToDate,
      force: args.force,
    });
    totalProcessed += result.itemsProcessed;

    if (isPerfStage) {
      if (result.ok) perfStageSucceeded = true;
      else if (!perfStageFailedMessage)
        perfStageFailedMessage = result.error ?? 'Performance API stage error';
    }

    if (!result.ok) {
      anyFailure = true;
      errors.push({
        stage,
        message: result.error ?? 'unknown error',
        at: new Date().toISOString(),
      });
    } else {
      anySuccess = true;
    }

    const finishedState: SyncStageState = {
      status: result.ok ? 'success' : 'error',
      itemsProcessed: result.itemsProcessed,
      itemsTotal: result.itemsTotal,
      startedAt: runningState.startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: result.durationMs,
      error: result.error,
      warnings: result.warnings && result.warnings.length > 0 ? result.warnings : undefined,
    };
    await updateSyncJobStage({ jobId: args.jobId, stage, state: finishedState });
    stageSummary[stage] = {
      ok: result.ok,
      itemsProcessed: result.itemsProcessed,
      itemsTotal: result.itemsTotal,
      warnings: result.warnings && result.warnings.length > 0 ? result.warnings : undefined,
      error: result.error,
    };
  }

  const jobStatus: SyncJobStatus = anyFailure
    ? anySuccess
      ? 'partial'
      : 'error'
    : 'success';

  await finishSyncJob({
    jobId: args.jobId,
    status: jobStatus,
    itemsProcessed: totalProcessed,
    errors,
  });

  await updateAccountLastSync({
    tenantId: args.tenantId,
    id: args.accountId,
    status: jobStatus === 'success' ? 'success' : jobStatus === 'partial' ? 'partial' : 'error',
    error: errors.length > 0 ? errors[0].message : undefined,
    summary: {
      stages: Object.fromEntries(
        stagesToRun.map((s) => {
          const entry = stageSummary[s];
          if (entry) return [s, entry];
          return [s, { ok: !errors.some((e) => e.stage === s), itemsProcessed: 0 }];
        }),
      ),
      totalItems: totalProcessed,
      totalErrors: errors.length,
    },
  });

  // Отдельный perf-статус (UI его показывает в карточке аккаунта).
  if (perfClient) {
    await updateAccountPerfStatus({
      tenantId: args.tenantId,
      id: args.accountId,
      status: perfStageSucceeded && !perfStageFailedMessage ? 'active' : 'error',
      error: perfStageFailedMessage,
      lastSyncAt: perfStageSucceeded ? new Date() : null,
    });
  }
}
