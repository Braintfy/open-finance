// PURPOSE: Тесты для pure-функций resolvePeriod() / getPreviousPeriod() /
// describePeriod() из src/components/blocks/period-picker.tsx.
// Запуск: pnpm tsx scripts/test-period-picker.ts

import {
  resolvePeriod,
  getPreviousPeriod,
  describePeriod,
} from '../src/components/blocks/period-picker';

let failed = 0;
let passed = 0;

function expect(cond: boolean, name: string, hint?: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${hint ? ' — ' + hint : ''}`);
  }
}

// Базовый «now» для всех тестов: 15 января 2025, 12:00 UTC.
const NOW = new Date('2025-01-15T12:00:00Z');

console.log('\n# resolvePeriod presets');

{
  const p = resolvePeriod('today', null, null, NOW);
  expect(
    p.from.toISOString().slice(0, 10) === '2025-01-15',
    'today: from = 2025-01-15',
  );
  expect(
    p.to.toISOString().slice(0, 10) === '2025-01-16',
    'today: to = next day (exclusive)',
  );
}

{
  const p = resolvePeriod('yesterday', null, null, NOW);
  expect(
    p.from.toISOString().slice(0, 10) === '2025-01-14',
    'yesterday: from = 2025-01-14',
  );
  expect(
    p.to.toISOString().slice(0, 10) === '2025-01-15',
    'yesterday: to = 2025-01-15',
  );
}

{
  const p = resolvePeriod('7d', null, null, NOW);
  // 7 дней назад: 15 - 6 = 9 января (включая сегодня → 7 дней)
  expect(
    p.from.toISOString().slice(0, 10) === '2025-01-09',
    '7d: from = 2025-01-09',
  );
  expect(
    p.to.toISOString().slice(0, 10) === '2025-01-16',
    '7d: to = 2025-01-16',
  );
}

{
  const p = resolvePeriod('14d', null, null, NOW);
  expect(
    p.from.toISOString().slice(0, 10) === '2025-01-02',
    '14d: from = 2025-01-02',
  );
}

{
  const p = resolvePeriod('30d', null, null, NOW);
  expect(
    p.from.toISOString().slice(0, 10) === '2024-12-17',
    '30d: from = 2024-12-17 (29 дней назад)',
  );
}

{
  const p = resolvePeriod('mtd', null, null, NOW);
  expect(
    p.from.toISOString().slice(0, 10) === '2025-01-01',
    'mtd: from = первое число месяца',
  );
  expect(
    p.to.toISOString().slice(0, 10) === '2025-01-16',
    'mtd: to = завтра (exclusive)',
  );
}

{
  const p = resolvePeriod('custom', '2025-01-05', '2025-01-10', NOW);
  expect(
    p.from.toISOString().slice(0, 10) === '2025-01-05',
    'custom: from = 2025-01-05',
  );
  expect(
    p.to.toISOString().slice(0, 10) === '2025-01-11',
    'custom: to = customTo+1 (exclusive)',
  );
}

{
  // custom без дат — fallback на сегодня
  const p = resolvePeriod('custom', null, null, NOW);
  expect(
    p.from.toISOString().slice(0, 10) === '2025-01-15',
    'custom fallback: from = today',
  );
}

console.log('\n# getPreviousPeriod');

{
  // 7 дней назад → ещё 7 дней назад
  const current = resolvePeriod('7d', null, null, NOW);
  const prev = getPreviousPeriod(current);
  expect(
    prev.to.getTime() === current.from.getTime(),
    'prev.to стыкуется с current.from',
  );
  const lengthMs = current.to.getTime() - current.from.getTime();
  expect(
    prev.to.getTime() - prev.from.getTime() === lengthMs,
    'prev длина = current длина',
  );
  expect(
    prev.from.toISOString().slice(0, 10) === '2025-01-02',
    'prev для 7d: 2025-01-02 .. 2025-01-09',
  );
}

{
  // 30d
  const current = resolvePeriod('30d', null, null, NOW);
  const prev = getPreviousPeriod(current);
  expect(
    prev.from.toISOString().slice(0, 10) === '2024-11-17',
    'prev для 30d: 2024-11-17',
  );
}

console.log('\n# describePeriod');

{
  const p1 = resolvePeriod('today', null, null, NOW);
  const desc1 = describePeriod(p1);
  expect(desc1.includes('15') || desc1.toLowerCase().includes('янв'), 'today desc has day');

  const p2 = resolvePeriod('7d', null, null, NOW);
  const desc2 = describePeriod(p2);
  expect(desc2.includes('—'), '7d desc has дефис между датами');
}

console.log(`\n## ${passed} PASS · ${failed} FAIL\n`);
if (failed > 0) process.exit(1);
