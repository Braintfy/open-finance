// PURPOSE: Pure-план обновления колонок `last_sync_*` в marketplace_accounts.
// Вынесен из `queries.ts` (там `import { db }` открывает коннект к Postgres
// прямо на import), чтобы правило «упавший sync НЕ двигает lastSyncAt»
// покрывалось unit-тестом без БД — `scripts/test-ozon-last-sync.ts`.
//
// ИНВАРИАНТ: `last_sync_at` — время последней УСПЕШНОЙ (success/partial)
// синхронизации, а не последней попытки. Раньше поле двигалось безусловно,
// и упавший sync «отмечал» период как загруженный: auto-preset считал окно
// от lastSyncAt, видел diffDays=1 и больше никогда не запрашивал пропущенные
// дни. Так в проде появилась дыра 01-18.08.2026 в ozon_analytics_daily.

import type { SyncSummary } from '@/lib/db/schema/marketplaces';

export type LastSyncStatus = 'success' | 'partial' | 'error';

/**
 * Патч для `db.update(marketplaceAccounts).set(...)`.
 * Отсутствующее поле = колонка НЕ переписывается (прежнее значение в БД
 * сохраняется). Именно так `lastSyncAt` переживает упавший sync.
 */
export type LastSyncPatch = {
  lastSyncAt?: Date;
  lastSyncStatus: LastSyncStatus;
  lastSyncError: string | null;
  lastSyncSummary?: SyncSummary;
  updatedAt: Date;
};

export function planLastSyncUpdate(args: {
  status: LastSyncStatus;
  error?: string;
  summary?: SyncSummary;
  /** Экспортировано для тестов (фиксируем «сейчас»). */
  now?: Date;
}): LastSyncPatch {
  const now = args.now ?? new Date();
  const patch: LastSyncPatch = {
    lastSyncStatus: args.status,
    lastSyncError: args.error ?? null,
    updatedAt: now,
  };

  if (args.status === 'error') {
    // lastSyncAt НЕ трогаем. Summary пишем только если стейджи успели её
    // собрать (её читает SilentFailureBanner); при хард-креше до стейджей
    // прежнюю summary не затираем пустышкой.
    if (args.summary) patch.lastSyncSummary = args.summary;
    return patch;
  }

  patch.lastSyncAt = now;
  patch.lastSyncSummary = args.summary ?? { stages: {} };
  return patch;
}
