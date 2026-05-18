// PURPOSE: Smoke-тест pure helpers периода Performance API.
// Запуск: pnpm tsx scripts/test-ozon-perf-period.ts
//
// Регрессия: Ozon Performance API возвращал 400 «Некорректный период», когда
// `dateTo` уходило в завтра по MSC (UTC-машинка около полуночи) или окно
// превышало лимит async-отчёта.

import {
  buildPerfPeriod,
  describePeriod,
  moscowDateString,
  shiftIsoDate,
  MAX_PERF_WINDOW_DAYS,
  MIN_PERF_WINDOW_DAYS,
} from '../src/lib/marketplaces/ozon/sync/perf-period';

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

console.log('\n=== moscowDateString: UTC → MSC сдвиг ===');
{
  // 2026-05-18T20:00:00Z = 2026-05-18T23:00:00 MSC → дата 2026-05-18
  expect(moscowDateString(new Date('2026-05-18T20:00:00Z')) === '2026-05-18', 'before MSC midnight');
  // 2026-05-18T21:30:00Z = 2026-05-19T00:30:00 MSC → дата 2026-05-19
  expect(moscowDateString(new Date('2026-05-18T21:30:00Z')) === '2026-05-19', 'after MSC midnight');
  // 2026-01-01T00:00:00Z = 2026-01-01T03:00:00 MSC → 2026-01-01
  expect(moscowDateString(new Date('2026-01-01T00:00:00Z')) === '2026-01-01', 'new year MSC');
}

console.log('\n=== shiftIsoDate: сдвиг по дням ===');
{
  expect(shiftIsoDate('2026-05-18', -7) === '2026-05-11', 'minus 7 days');
  expect(shiftIsoDate('2026-05-18', 0) === '2026-05-18', 'delta 0');
  expect(shiftIsoDate('2026-03-01', -1) === '2026-02-28', 'February boundary');
  expect(shiftIsoDate('2026-03-01', -29) === '2026-01-31', 'cross month');
  expect(shiftIsoDate('2026-12-31', 1) === '2027-01-01', 'cross year');
}

console.log('\n=== buildPerfPeriod: windowDays и MSC clamp ===');
{
  const p30 = buildPerfPeriod(30, new Date('2026-05-18T12:00:00Z'));
  expect(p30.dateTo === '2026-05-18', '30d window: dateTo today MSC');
  expect(p30.dateFrom === '2026-04-19', '30d window: dateFrom = today - 29');
  expect(p30.windowDays === 30, 'windowDays = 30');

  const p1 = buildPerfPeriod(1, new Date('2026-05-18T12:00:00Z'));
  expect(p1.dateFrom === '2026-05-18' && p1.dateTo === '2026-05-18', '1d window collapses to today');

  const pBig = buildPerfPeriod(1000, new Date('2026-05-18T12:00:00Z'));
  expect(pBig.windowDays === MAX_PERF_WINDOW_DAYS, `clamp to ${MAX_PERF_WINDOW_DAYS}`);
  expect(pBig.dateTo === '2026-05-18', 'clamp keeps today MSC');

  const pZero = buildPerfPeriod(0, new Date('2026-05-18T12:00:00Z'));
  expect(pZero.windowDays === MIN_PERF_WINDOW_DAYS, 'min clamp');

  // UTC-полночь близко к MSC завтра.
  const pMidnight = buildPerfPeriod(7, new Date('2026-05-18T22:30:00Z'));
  expect(pMidnight.dateTo === '2026-05-19', 'past MSC midnight: dateTo=tomorrow UTC=today MSC');
  expect(pMidnight.dateFrom === '2026-05-13', 'past MSC midnight: dateFrom shifted');

  // Граничный случай — NaN/Infinity windowDays.
  const pNaN = buildPerfPeriod(Number.NaN, new Date('2026-05-18T12:00:00Z'));
  expect(Number.isFinite(pNaN.windowDays) && pNaN.windowDays === 30, 'NaN → default 30');
}

console.log('\n=== describePeriod ===');
{
  const p = buildPerfPeriod(7, new Date('2026-05-18T12:00:00Z'));
  expect(describePeriod(p).startsWith('2026-05-12…2026-05-18'), `describe ${describePeriod(p)}`);
  expect(describePeriod(p).includes('MSC'), 'mentions MSC');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
