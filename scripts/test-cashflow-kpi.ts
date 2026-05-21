// PURPOSE: Tests для KPI deltaPct / sparkline aggregation логики.
// Это unit tests для функций, не для HTTP endpoint'а (тот нужно тестировать
// integration-style с реальной БД).
// Запуск: pnpm tsx scripts/test-cashflow-kpi.ts

import { resolvePeriod } from '../src/components/blocks/period-picker';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}`);
    failed += 1;
  }
}

function approxEq(a: number, b: number, eps = 1): boolean {
  return Math.abs(a - b) < eps;
}

console.log('\n=== resolvePeriod presets ===');
{
  const today = resolvePeriod('today');
  ok('today has from', today.from instanceof Date);
  ok('today has to', today.to instanceof Date);
  ok('today: from < to', today.from.getTime() < today.to.getTime());

  const week = resolvePeriod('7d');
  const ms = week.to.getTime() - week.from.getTime();
  ok('7d ≈ 7 days', approxEq(ms / (24 * 3600 * 1000), 7, 0.1));

  const month = resolvePeriod('30d');
  const m30 = month.to.getTime() - month.from.getTime();
  ok('30d ≈ 30 days', approxEq(m30 / (24 * 3600 * 1000), 30, 0.1));

  const mtd = resolvePeriod('mtd');
  ok('mtd from is start of month', mtd.from.getDate() === 1);
}

console.log('\n=== custom period ===');
{
  const custom = resolvePeriod('custom', '2026-01-01', '2026-01-31');
  ok('custom from year', custom.from.getFullYear() === 2026);
  ok('custom from month', custom.from.getMonth() === 0);
  ok('custom to year', custom.to.getFullYear() === 2026);
}

console.log('\n=== granularity for chart ===');
{
  // Replicate the pickGranularity logic from /api/cashflow/chart
  function pickGranularity(from: Date, to: Date): 'day' | 'week' | 'month' {
    const lengthDays = Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000));
    if (lengthDays <= 31) return 'day';
    if (lengthDays <= 120) return 'week';
    return 'month';
  }
  const dayPeriod = resolvePeriod('7d');
  ok('7d → day', pickGranularity(dayPeriod.from, dayPeriod.to) === 'day');

  const month = resolvePeriod('30d');
  ok('30d → day', pickGranularity(month.from, month.to) === 'day');

  const longPeriod = resolvePeriod('custom', '2025-01-01', '2025-04-15');
  ok('~105d → week', pickGranularity(longPeriod.from, longPeriod.to) === 'week');

  const veryLong = resolvePeriod('custom', '2024-01-01', '2026-01-01');
  ok('2y → month', pickGranularity(veryLong.from, veryLong.to) === 'month');
}

console.log('\n=== deltaPct calculation ===');
{
  function deltaPct(curr: number, prev: number): number | null {
    if (prev === 0) return null;
    return ((curr - prev) / prev) * 100;
  }
  ok('+50%', deltaPct(150, 100) === 50);
  ok('-25%', deltaPct(75, 100) === -25);
  ok('prev=0 → null', deltaPct(100, 0) === null);
  ok('same → 0', deltaPct(100, 100) === 0);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
