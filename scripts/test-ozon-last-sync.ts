// PURPOSE: Тесты инварианта «упавший sync НЕ двигает last_sync_at»
// (`planLastSyncUpdate` из src/lib/marketplaces/last-sync-plan.ts).
//
// Регрессия, которую ловим: `updateAccountLastSync` ставил `lastSyncAt: new Date()`
// безусловно, в том числе при status='error'. Упавший синк «отмечал» период как
// загруженный → auto-preset считал diffDays=1 → пропущенные дни не запрашивались
// никогда (дыра 01-18.08.2026 в ozon_analytics_daily).
//
// Запуск: `pnpm tsx scripts/test-ozon-last-sync.ts`

import {
  planLastSyncUpdate,
  type LastSyncPatch,
} from '../src/lib/marketplaces/last-sync-plan';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, details?: string) {
  if (cond) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${details ? ': ' + details : ''}`);
    failed++;
  }
}

const NOW = new Date('2026-08-20T09:00:00Z');

/** Патч уходит прямо в `db.update(...).set(patch)` — важно именно ОТСУТСТВИЕ
 *  ключа: тогда Drizzle не включает колонку в SET и прежнее значение живёт. */
function touchesLastSyncAt(patch: LastSyncPatch): boolean {
  return 'lastSyncAt' in patch;
}

console.log('=== planLastSyncUpdate: error не двигает lastSyncAt ===');
{
  const patch = planLastSyncUpdate({ status: 'error', error: 'Ozon 500', now: NOW });
  ok('error → ключа lastSyncAt в патче НЕТ', !touchesLastSyncAt(patch), JSON.stringify(patch));
  ok('error → lastSyncStatus = error', patch.lastSyncStatus === 'error');
  ok('error → lastSyncError сохранён', patch.lastSyncError === 'Ozon 500');
  ok('error → updatedAt всё равно двигается', patch.updatedAt === NOW);
}
{
  const patch = planLastSyncUpdate({ status: 'error', now: NOW });
  ok('error без summary → lastSyncSummary не затирается', !('lastSyncSummary' in patch), JSON.stringify(patch));
}
{
  const summary = { stages: { analyticsData: { ok: false, error: 'boom' } } };
  const patch = planLastSyncUpdate({ status: 'error', summary, now: NOW });
  ok('error c summary → summary пишем (нужна SilentFailureBanner)', patch.lastSyncSummary === summary);
  ok('error c summary → lastSyncAt всё равно не трогаем', !touchesLastSyncAt(patch));
}

console.log('\n=== planLastSyncUpdate: success/partial двигают lastSyncAt ===');
{
  const patch = planLastSyncUpdate({ status: 'success', now: NOW });
  ok('success → lastSyncAt = now', patch.lastSyncAt === NOW);
  ok('success → lastSyncError сброшен в null', patch.lastSyncError === null);
  ok('success без summary → пустая summary', JSON.stringify(patch.lastSyncSummary) === '{"stages":{}}');
}
{
  const summary = { stages: { orders: { ok: true, itemsProcessed: 42 } } };
  const patch = planLastSyncUpdate({ status: 'partial', error: 'perf упал', summary, now: NOW });
  ok('partial → lastSyncAt = now (частичные данные всё же загружены)', patch.lastSyncAt === NOW);
  ok('partial → summary пишем', patch.lastSyncSummary === summary);
  ok('partial → lastSyncError сохранён', patch.lastSyncError === 'perf упал');
}

console.log('\n=== Сценарий прод-бага (19.08 упал → 20.08 схлопнулось в 1 день) ===');
{
  // Успешный sync 31.07 проставил lastSyncAt.
  const okPatch = planLastSyncUpdate({ status: 'success', now: new Date('2026-07-31T06:00:00Z') });
  // 19.08 sync упал — lastSyncAt обязан остаться 31.07.
  const failPatch = planLastSyncUpdate({ status: 'error', error: 'timeout', now: new Date('2026-08-19T06:00:00Z') });
  ok('успешный 31.07 записал lastSyncAt', okPatch.lastSyncAt?.toISOString().slice(0, 10) === '2026-07-31');
  ok(
    'упавший 19.08 lastSyncAt не переписывает → auto-окно останется широким',
    !touchesLastSyncAt(failPatch),
    JSON.stringify(failPatch),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
