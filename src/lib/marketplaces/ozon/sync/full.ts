// PURPOSE: Оркестратор полной синхронизации Ozon-аккаунта.
// Последовательно прогоняет стейджи, обновляет ozon_sync_jobs.stages
// и финализирует job/account.last_sync_*.
//
// Стейджи запускаются в фиксированном порядке (см. OZON_FULL_STAGES в
// lib/marketplaces/types.ts). Каждый стейдж — отдельный пункт в settings;
// если settings[stage] === false → стейдж помечается 'skipped'.

import {
  decryptAccountApiKey,
  finishSyncJob,
  getAccount,
  setSyncJobRunning,
  updateAccountLastSync,
  updateSyncJobStage,
} from '@/lib/marketplaces/queries';
import { OzonClient } from '../client';
import { syncProductsStage } from './products';
import { syncPricesStage } from './prices';
import { syncStocksStage } from './stocks';
import { syncOrdersStage } from './orders';
import { syncRealizationStage } from './realization';
import { syncTransactionsStage } from './transactions';
import { syncTurnoverStage } from './turnover';
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
  orders: syncOrdersStage,
  realization: syncRealizationStage,
  transactions: syncTransactionsStage,
  turnover: syncTurnoverStage,
};

export type RunFullSyncArgs = {
  tenantId: string;
  userId: string;
  accountId: string;
  jobId: string;
  /** Если задан — синхронизирует только этот стейдж (игнорируя тогглы). */
  onlyStage?: OzonStageKind;
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

  const stagesToRun = args.onlyStage
    ? ([args.onlyStage] as OzonStageKind[])
    : ([...OZON_FULL_STAGES] as OzonStageKind[]);

  for (const stage of stagesToRun) {
    const enabled = (settings as Record<string, unknown>)[stage] !== false;
    if (!enabled) {
      const state: SyncStageState = {
        status: 'skipped',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
      };
      await updateSyncJobStage({ jobId: args.jobId, stage, state });
      continue;
    }

    const runningState: SyncStageState = {
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    await updateSyncJobStage({ jobId: args.jobId, stage, state: runningState });

    const result = await STAGE_RUNNERS[stage]({ ...baseCtx, client, settings });
    totalProcessed += result.itemsProcessed;

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
    };
    await updateSyncJobStage({ jobId: args.jobId, stage, state: finishedState });
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
        stagesToRun.map((s) => [
          s,
          { ok: !errors.some((e) => e.stage === s), itemsProcessed: 0 },
        ]),
      ),
      totalItems: totalProcessed,
      totalErrors: errors.length,
    },
  });
}
