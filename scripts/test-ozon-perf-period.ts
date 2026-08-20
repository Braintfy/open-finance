// PURPOSE: Smoke-тест pure helpers периода Performance API.
// Запуск: pnpm tsx scripts/test-ozon-perf-period.ts
//
// Регрессия: Ozon Performance API возвращал 400 «Некорректный период», когда
// `dateTo` уходило в завтра по MSC (UTC-машинка около полуночи) или окно
// превышало лимит async-отчёта.
//
// ВНИМАНИЕ (лаг закрытия дня). `buildPerfPeriod` строит `dateTo` как
// today(MSC) − `completeDayLag` (по умолчанию 1), то есть ВЧЕРА, а не сегодня.
// Это осознанное поведение, а не отставание: Performance API отдаёт цифры
// только за ЗАВЕРШЁННЫЕ дни — на незакрытый сегодняшний день async-отчёт
// отвечает 400 либо (что хуже) неполной суммой расхода, которая утечёт в
// юнит-экономику. Лаг был захардкожен (`dateTo = вчера по MSC`) и стал
// параметром в 031ac55 вместе с ретрай-лесенкой `RETRY_END_LAGS = [1,2,3,4,7]`
// в `sync/perf-{expense,cpo,sku-stats}*.ts`. Ожидания ниже зафиксированы под
// лаг — если тест «покраснел» на `dateTo = сегодня`, чинить надо вызывающий
// код, а не ожидание: сегодняшний день синкать нельзя.

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

/** Число календарных дней в окне [from, to] включительно. */
function daysInclusive(fromIso: string, toIso: string): number {
  const ms =
    new Date(toIso + 'T00:00:00Z').getTime() - new Date(fromIso + 'T00:00:00Z').getTime();
  return Math.round(ms / (24 * 3600 * 1000)) + 1;
}

console.log('\n=== buildPerfPeriod: windowDays и MSC clamp ===');
{
  // 15:00 MSC 18 мая → today(MSC) = 2026-05-18, dateTo = 2026-05-17 (лаг 1).
  const NOW = new Date('2026-05-18T12:00:00Z');

  const p30 = buildPerfPeriod(30, NOW);
  expect(p30.dateTo === '2026-05-17', '30d window: dateTo = вчера MSC (лаг закрытия дня)');
  expect(p30.dateFrom === '2026-04-18', '30d window: dateFrom = dateTo - 29');
  expect(p30.windowDays === 30, 'windowDays = 30');
  // Лаг сдвигает окно целиком, а не «съедает» день: дней ровно windowDays.
  expect(daysInclusive(p30.dateFrom, p30.dateTo) === 30, '30d window: ровно 30 календарных дней');

  const p1 = buildPerfPeriod(1, NOW);
  expect(
    p1.dateFrom === '2026-05-17' && p1.dateTo === '2026-05-17',
    '1d window collapses to вчера (последний закрытый день)',
  );

  const pBig = buildPerfPeriod(1000, NOW);
  expect(pBig.windowDays === MAX_PERF_WINDOW_DAYS, `clamp to ${MAX_PERF_WINDOW_DAYS}`);
  expect(pBig.dateTo === '2026-05-17', 'clamp не трогает правую границу (всё те же вчера MSC)');

  const pZero = buildPerfPeriod(0, NOW);
  expect(pZero.windowDays === MIN_PERF_WINDOW_DAYS, 'min clamp');

  // Ретрай-лесенка sync-стейджей просит лаг 2/3/4/7 дней, когда Ozon отвечает
  // 400 на свежие дни — параметр должен доезжать до dateTo.
  expect(buildPerfPeriod(7, NOW, 3).dateTo === '2026-05-15', 'completeDayLag=3 → dateTo = today-3');
  expect(
    buildPerfPeriod(7, NOW, 7).dateFrom === '2026-05-05',
    'completeDayLag=7 → окно 7d целиком сдвинуто назад',
  );

  // Регрессия «UTC-машинка около полуночи»: 22:30Z 18 мая = 01:30 MSC 19 мая,
  // то есть по MSC уже НАСТУПИЛ следующий день, хотя UTC-дата та же.
  // Проверяем именно РАЗНИЦУ между 20:00Z и 22:30Z одного UTC-дня: голое
  // равенство `dateTo === '2026-05-18'` прошло бы и у ошибочной реализации,
  // которая берёт UTC-дату вообще без лага, — совпадение было бы случайным.
  const pBeforeMsc = buildPerfPeriod(7, new Date('2026-05-18T20:00:00Z'));
  const pAfterMsc = buildPerfPeriod(7, new Date('2026-05-18T22:30:00Z'));
  expect(pBeforeMsc.dateTo === '2026-05-17', 'before MSC midnight: dateTo = 2026-05-17');
  expect(pAfterMsc.dateTo === '2026-05-18', 'past MSC midnight: dateTo = 2026-05-18');
  expect(
    shiftIsoDate(pBeforeMsc.dateTo, 1) === pAfterMsc.dateTo,
    'MSC-полночь двигает окно ровно на день при неизменной UTC-дате',
  );
  expect(pAfterMsc.dateFrom === '2026-05-12', 'past MSC midnight: dateFrom shifted');

  // Граничный случай — NaN/Infinity windowDays.
  const pNaN = buildPerfPeriod(Number.NaN, NOW);
  expect(Number.isFinite(pNaN.windowDays) && pNaN.windowDays === 30, 'NaN → default 30');
}

console.log('\n=== describePeriod ===');
{
  // 7d на 18 мая MSC с лагом 1 → [11 мая … 17 мая].
  const p = buildPerfPeriod(7, new Date('2026-05-18T12:00:00Z'));
  expect(describePeriod(p).startsWith('2026-05-11…2026-05-17'), `describe ${describePeriod(p)}`);
  expect(describePeriod(p).includes('MSC'), 'mentions MSC');
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
