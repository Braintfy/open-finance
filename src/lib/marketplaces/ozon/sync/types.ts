// PURPOSE: Контракт sync-стейджа Ozon.
// Каждый стейдж — pure-функция: получает client+ctx+settings,
// возвращает StageResult (для записи в ozon_sync_jobs.stages JSONB).

import type { OzonClient } from '../client';
import type { OzonPerformanceClient } from '../performance/client';
import type { OzonSyncSettings } from '@/lib/db/schema/marketplaces';
import type { UpsertContext } from '../upsert';

export type StageContext = UpsertContext & {
  client: OzonClient;
  /**
   * Performance API клиент. null если у аккаунта нет perf-кредов.
   * perf-стейджи (perfCampaigns/perfSkuStats/perfPhrases) пропускаются
   * с status='skipped' если perfClient отсутствует.
   */
  perfClient: OzonPerformanceClient | null;
  settings: OzonSyncSettings;
  /** Callback для inline progress reporting (не обязателен). */
  onProgress?: (processed: number, total?: number) => void;
  /**
   * v0.22.1: Override sliding-window для date-aware стейджей
   * (analyticsData / orders / transactions / perf-*). Если задано — стейдж
   * использует [overrideFromDate, overrideToDate] вместо `settings.*WindowDays`.
   * Формат: YYYY-MM-DD в Europe/Moscow, включительно.
   * Стейджи без даты (products / prices / stocks / turnover / clusters /
   * warehouseStocks / realization) override игнорируют.
   */
  overrideFromDate?: string;
  overrideToDate?: string;
  /**
   * v0.22.1: «Принудительная» перезапись. Сейчас daily-таблицы и так
   * DELETE+INSERT в окне — флаг зарезервирован под будущую оптимизацию
   * (skip-if-already-loaded для orders/transactions upsert).
   */
  force?: boolean;
};

export type StageResult = {
  ok: boolean;
  itemsProcessed: number;
  itemsTotal?: number;
  durationMs: number;
  error?: string;
  warnings?: string[];
};

export async function runStageWithTiming(
  fn: () => Promise<Omit<StageResult, 'durationMs' | 'ok'> & { ok?: boolean }>,
): Promise<StageResult> {
  const startedAt = Date.now();
  try {
    const res = await fn();
    return {
      ok: res.ok !== false,
      itemsProcessed: res.itemsProcessed,
      itemsTotal: res.itemsTotal,
      durationMs: Date.now() - startedAt,
      warnings: res.warnings,
      error: res.error,
    };
  } catch (e) {
    const err = e as Error;
    return {
      ok: false,
      itemsProcessed: 0,
      durationMs: Date.now() - startedAt,
      error: err.message ?? String(e),
    };
  }
}
