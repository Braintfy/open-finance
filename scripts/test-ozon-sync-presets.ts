// PURPOSE: Тесты для pure-функций `resolvePresetRange` / `describePreset`
// из `src/components/marketplaces/ozon-sync-presets.ts`. Покрывает все
// пресеты (`auto`, `yesterday`, `last3/7/30`, `window`, `custom`), а также
// edge cases для `auto`:
//   - lastSyncAt === null  → fallback 30 дней
//   - lastSyncAt сегодня   → diff = 0 → только вчера
//   - lastSyncAt вчера     → diff = 1 → только вчера
//   - lastSyncAt 7 дней    → от lastSync до вчера
//   - lastSyncAt >90 дней  → fallback 30 дней (защита от мегаsync'а)
//   - lastSyncAt в будущем → from = yesterday (защита от часов клиента)
//
// Запуск: `pnpm tsx scripts/test-ozon-sync-presets.ts`

import {
  describePreset,
  diffDaysInclusive,
  moscowToday,
  resolvePresetRange,
  shiftIsoDate,
} from '../src/components/marketplaces/ozon-sync-presets';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean, details?: string) {
  if (cond) {
    console.log(`  \u2713 ${name}`);
    passed++;
  } else {
    console.error(`  \u2717 ${name}${details ? ': ' + details : ''}`);
    failed++;
  }
}

// Фиксированное «сейчас» для детерминированных тестов.
// 2026-05-23 12:00 UTC → MSC 15:00 → today = 2026-05-23.
const NOW = new Date('2026-05-23T12:00:00Z');

console.log('=== Date helpers ===');
ok('moscowToday(2026-05-23 12:00 UTC) → 2026-05-23', moscowToday(NOW) === '2026-05-23');
ok('shiftIsoDate(2026-05-23, -1) → 2026-05-22', shiftIsoDate('2026-05-23', -1) === '2026-05-22');
ok('shiftIsoDate(2026-05-22, -29) → 2026-04-23', shiftIsoDate('2026-05-22', -29) === '2026-04-23');
ok('diffDaysInclusive(2026-05-22, 2026-05-22) === 1', diffDaysInclusive('2026-05-22', '2026-05-22') === 1);
ok('diffDaysInclusive(2026-05-20, 2026-05-22) === 3', diffDaysInclusive('2026-05-20', '2026-05-22') === 3);

console.log('\n=== Простые пресеты ===');
{
  const r = resolvePresetRange('yesterday', null, NOW);
  ok('yesterday → {2026-05-22, 2026-05-22}', r?.from === '2026-05-22' && r?.to === '2026-05-22');
}
{
  const r = resolvePresetRange('last3', null, NOW);
  ok('last3 → {2026-05-20, 2026-05-22}', r?.from === '2026-05-20' && r?.to === '2026-05-22');
}
{
  const r = resolvePresetRange('last7', null, NOW);
  ok('last7 → {2026-05-16, 2026-05-22}', r?.from === '2026-05-16' && r?.to === '2026-05-22');
}
{
  const r = resolvePresetRange('last30', null, NOW);
  ok('last30 → {2026-04-23, 2026-05-22}', r?.from === '2026-04-23' && r?.to === '2026-05-22');
}
ok('window → null', resolvePresetRange('window', null, NOW) === null);
ok('custom → null', resolvePresetRange('custom', null, NOW) === null);

console.log('\n=== auto preset (smart detect) ===');
{
  // Нет lastSync → 30 дней.
  const r = resolvePresetRange('auto', null, NOW);
  ok('auto + null → 30 дней', r?.from === '2026-04-23' && r?.to === '2026-05-22');
}
{
  // lastSync = undefined → тоже 30 дней.
  const r = resolvePresetRange('auto', undefined, NOW);
  ok('auto + undefined → 30 дней', r?.from === '2026-04-23' && r?.to === '2026-05-22');
}
{
  // lastSync = today → diff = 0 → только вчера.
  const r = resolvePresetRange('auto', '2026-05-23T10:00:00Z', NOW);
  ok('auto + today → только вчера', r?.from === '2026-05-22' && r?.to === '2026-05-22');
}
{
  // lastSync = yesterday → diff = 1 → только вчера.
  const r = resolvePresetRange('auto', '2026-05-22T10:00:00Z', NOW);
  ok('auto + yesterday → только вчера', r?.from === '2026-05-22' && r?.to === '2026-05-22');
}
{
  // lastSync = 3 дня назад → от lastSync до вчера.
  const r = resolvePresetRange('auto', '2026-05-20T10:00:00Z', NOW);
  ok('auto + 3 дня → {2026-05-20, 2026-05-22}', r?.from === '2026-05-20' && r?.to === '2026-05-22');
}
{
  // lastSync = 30 дней назад.
  const r = resolvePresetRange('auto', '2026-04-23T10:00:00Z', NOW);
  ok('auto + 30 дней → {2026-04-23, 2026-05-22}', r?.from === '2026-04-23' && r?.to === '2026-05-22');
}
{
  // lastSync = 89 дней назад — на границе.
  const r = resolvePresetRange('auto', '2026-02-23T10:00:00Z', NOW);
  ok('auto + 89 дней → от lastSync', r?.from === '2026-02-23' && r?.to === '2026-05-22');
}
{
  // lastSync = 100 дней назад → fallback 30 дней.
  const r = resolvePresetRange('auto', '2026-02-12T10:00:00Z', NOW);
  ok('auto + 100 дней → fallback 30 дней', r?.from === '2026-04-23' && r?.to === '2026-05-22');
}
{
  // lastSync в будущем (часы клиента кривые) → from = yesterday.
  const r = resolvePresetRange('auto', '2030-01-01T10:00:00Z', NOW);
  ok('auto + future → from = yesterday', r?.from === '2026-05-22' && r?.to === '2026-05-22');
}
{
  // Невалидная дата → fallback 30 дней.
  const r = resolvePresetRange('auto', 'invalid-date', NOW);
  ok('auto + invalid → fallback 30 дней', r?.from === '2026-04-23' && r?.to === '2026-05-22');
}

console.log('\n=== describePreset ===');
{
  const hint = describePreset('auto', null, NOW);
  ok(
    'describePreset(auto, null) показывает "Без истории sync"',
    hint.includes('Без истории') && hint.includes('30 дней'),
    hint,
  );
}
{
  const hint = describePreset('auto', '2026-05-20T10:00:00Z', NOW);
  ok(
    'describePreset(auto, 3 дня назад) показывает "Догрузим 3 дн."',
    hint.includes('Догрузим 3 дн.') && hint.includes('2026-05-20') && hint.includes('2026-05-22'),
    hint,
  );
}
{
  const hint = describePreset('auto', '2026-05-22T10:00:00Z', NOW);
  ok(
    'describePreset(auto, yesterday) показывает "Догрузим 1 дн."',
    hint.includes('Догрузим 1 дн.'),
    hint,
  );
}
ok('describePreset(yesterday) === "Вчера"', describePreset('yesterday', null, NOW) === 'Вчера');
ok('describePreset(window) === "Полное окно (настройки)"', describePreset('window', null, NOW) === 'Полное окно (настройки)');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
