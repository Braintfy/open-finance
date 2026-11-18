// PURPOSE: Smoke-тесты общего модуля периодов слоя метрик (src/lib/metrics/period.ts).
// Проверяют границы месяцев/года, високосный февраль, согласованность eachDay/periodDays,
// пересечения, расширение до месяцев, МСК-день и независимость от TZ процесса.
// Запуск: pnpm -s tsx scripts/test-metrics-period.ts  (и с TZ=America/Los_Angeles)

import {
  addDays,
  addMonths,
  containsDay,
  diffDays,
  eachDay,
  expandToWholeMonths,
  intersect,
  isIsoDate,
  isValidPeriod,
  lastDayOfMonth,
  monthOf,
  monthPeriod,
  monthsInPeriod,
  mskDayOf,
  periodDays,
  previousPeriod,
  previousYearPeriod,
  yearStartOf,
  type Period,
} from '../src/lib/metrics/period';
import { resolveOzonQueryPeriod } from '../src/lib/marketplaces/ozon/query-period';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, hint?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}${hint ? ' — ' + hint : ''}`);
    failed += 1;
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(label, same, same ? undefined : `получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(expected)}`);
}

function throws(label: string, fn: () => unknown) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = e instanceof Error && e.message.length > 0;
  }
  ok(label, threw);
}

console.log(`\n(TZ процесса: ${process.env.TZ ?? 'не задан'})`);

console.log('\n=== isIsoDate ===');
{
  ok('2026-02-28 валидна', isIsoDate('2026-02-28'));
  ok('2026-02-30 невалидна', !isIsoDate('2026-02-30'));
  ok('2026-02-29 невалидна (не високосный)', !isIsoDate('2026-02-29'));
  ok('2024-02-29 валидна (високосный)', isIsoDate('2024-02-29'));
  ok('2026-13-01 невалидна', !isIsoDate('2026-13-01'));
  ok('2026-00-10 невалидна', !isIsoDate('2026-00-10'));
  ok('2026-01-00 невалидна', !isIsoDate('2026-01-00'));
  ok('2026-1-1 невалидна', !isIsoDate('2026-1-1'));
  ok('с временем невалидна', !isIsoDate('2026-01-01T00:00:00Z'));
  ok('не строка невалидна', !isIsoDate(20260101 as unknown));
}

console.log('\n=== addDays / diffDays ===');
{
  eq('конец года +1', addDays('2025-12-31', 1), '2026-01-01');
  eq('начало года −1', addDays('2026-01-01', -1), '2025-12-31');
  eq('февраль обычного года +1', addDays('2026-02-28', 1), '2026-03-01');
  eq('февраль високосного +1', addDays('2024-02-28', 1), '2024-02-29');
  eq('високосный 29.02 +1', addDays('2024-02-29', 1), '2024-03-01');
  eq('diffDays внутри года', diffDays('2026-01-01', '2026-03-01'), 59);
  eq('diffDays високосный', diffDays('2024-01-01', '2024-03-01'), 60);
  eq('diffDays через год', diffDays('2025-12-31', '2026-01-01'), 1);
  eq('diffDays отрицательный', diffDays('2026-01-02', '2026-01-01'), -1);
  throws('addDays: мусор бросает', () => addDays('2026-02-30', 1));
  throws('diffDays: мусор бросает', () => diffDays('abc', '2026-01-01'));
}

console.log('\n=== месяцы ===');
{
  eq('monthOf', monthOf('2026-03-17'), '2026-03-01');
  eq('addMonths +1 через год', addMonths('2025-12-01', 1), '2026-01-01');
  eq('addMonths −1 через год', addMonths('2026-01-01', -1), '2025-12-01');
  eq('addMonths +13', addMonths('2026-01-01', 13), '2027-02-01');
  eq('addMonths −12', addMonths('2026-05-01', -12), '2025-05-01');
  eq('lastDayOfMonth февраль обычный', lastDayOfMonth('2026-02-01'), '2026-02-28');
  eq('lastDayOfMonth февраль високосный', lastDayOfMonth('2024-02-01'), '2024-02-29');
  eq('lastDayOfMonth декабрь', lastDayOfMonth('2026-12-01'), '2026-12-31');
  eq('lastDayOfMonth апрель', lastDayOfMonth('2026-04-01'), '2026-04-30');
  eq('monthPeriod', monthPeriod('2026-02-01'), { fromDate: '2026-02-01', toDateExclusive: '2026-03-01' });
  eq('monthPeriod декабря', monthPeriod('2026-12-01'), { fromDate: '2026-12-01', toDateExclusive: '2027-01-01' });
  throws('addMonths: не первое число бросает', () => addMonths('2026-03-15', 1));
  throws('monthPeriod: мусор бросает', () => monthPeriod('2026-02-30'));
  eq('yearStartOf', yearStartOf('2026-11-18'), '2026-01-01');
}

console.log('\n=== период: валидность, дни, вхождение ===');
{
  ok('валидный', isValidPeriod({ fromDate: '2026-01-01', toDateExclusive: '2026-01-02' }));
  ok('пустой невалиден', !isValidPeriod({ fromDate: '2026-01-01', toDateExclusive: '2026-01-01' }));
  ok('перевёрнутый невалиден', !isValidPeriod({ fromDate: '2026-01-05', toDateExclusive: '2026-01-01' }));
  ok('с мусорной датой невалиден', !isValidPeriod({ fromDate: '2026-02-30', toDateExclusive: '2026-03-05' }));
  eq('periodDays февраль 2026', periodDays(monthPeriod('2026-02-01')), 28);
  eq('periodDays февраль 2024', periodDays(monthPeriod('2024-02-01')), 29);
  eq('periodDays год 2024', periodDays({ fromDate: '2024-01-01', toDateExclusive: '2025-01-01' }), 366);
  eq('periodDays год 2026', periodDays({ fromDate: '2026-01-01', toDateExclusive: '2027-01-01' }), 365);
  const p: Period = { fromDate: '2026-03-10', toDateExclusive: '2026-03-13' };
  ok('containsDay: from включён', containsDay(p, '2026-03-10'));
  ok('containsDay: последний день включён', containsDay(p, '2026-03-12'));
  ok('containsDay: toExclusive не включён', !containsDay(p, '2026-03-13'));
  ok('containsDay: до from', !containsDay(p, '2026-03-09'));
  throws('periodDays: невалидный период бросает', () => periodDays({ fromDate: '2026-01-05', toDateExclusive: '2026-01-01' }));
}

console.log('\n=== eachDay согласован с periodDays ===');
{
  const periods: Period[] = [
    { fromDate: '2026-02-26', toDateExclusive: '2026-03-03' },
    { fromDate: '2024-02-26', toDateExclusive: '2024-03-03' },
    { fromDate: '2025-12-30', toDateExclusive: '2026-01-03' },
    { fromDate: '2026-05-05', toDateExclusive: '2026-05-06' },
    { fromDate: '2024-01-01', toDateExclusive: '2025-01-01' },
  ];
  for (const p of periods) {
    const days = eachDay(p);
    ok(
      `${p.fromDate}…${p.toDateExclusive}: длина = periodDays (${days.length})`,
      days.length === periodDays(p),
    );
    ok('  первый = from, последний + 1 = toExclusive', days[0] === p.fromDate && addDays(days[days.length - 1]!, 1) === p.toDateExclusive);
    ok('  строго возрастают без пропусков', days.every((d, i) => i === 0 || diffDays(days[i - 1]!, d) === 1));
  }
  eq('eachDay через конец года', eachDay({ fromDate: '2025-12-30', toDateExclusive: '2026-01-03' }), [
    '2025-12-30',
    '2025-12-31',
    '2026-01-01',
    '2026-01-02',
  ]);
  eq('eachDay високосный февраль', eachDay({ fromDate: '2024-02-28', toDateExclusive: '2024-03-01' }), [
    '2024-02-28',
    '2024-02-29',
  ]);
}

console.log('\n=== intersect ===');
{
  const a: Period = { fromDate: '2026-03-01', toDateExclusive: '2026-03-15' };
  eq('непустое пересечение', intersect(a, { fromDate: '2026-03-10', toDateExclusive: '2026-03-20' }), {
    fromDate: '2026-03-10',
    toDateExclusive: '2026-03-15',
  });
  eq('вложенный', intersect(a, { fromDate: '2026-03-05', toDateExclusive: '2026-03-06' }), {
    fromDate: '2026-03-05',
    toDateExclusive: '2026-03-06',
  });
  eq('смежные (стык) — пусто', intersect(a, { fromDate: '2026-03-15', toDateExclusive: '2026-03-20' }), null);
  eq('разнесённые — пусто', intersect(a, { fromDate: '2026-04-01', toDateExclusive: '2026-04-02' }), null);
  eq('симметрично', intersect({ fromDate: '2026-03-10', toDateExclusive: '2026-03-20' }, a), {
    fromDate: '2026-03-10',
    toDateExclusive: '2026-03-15',
  });
}

console.log('\n=== monthsInPeriod / expandToWholeMonths ===');
{
  eq('внутри одного месяца', monthsInPeriod({ fromDate: '2026-03-05', toDateExclusive: '2026-03-10' }), ['2026-03-01']);
  eq('стык двух месяцев', monthsInPeriod({ fromDate: '2026-03-25', toDateExclusive: '2026-04-05' }), [
    '2026-03-01',
    '2026-04-01',
  ]);
  eq(
    'toExclusive = 1-е число НЕ включает этот месяц',
    monthsInPeriod({ fromDate: '2026-03-10', toDateExclusive: '2026-04-01' }),
    ['2026-03-01'],
  );
  eq('ровно месяц', monthsInPeriod(monthPeriod('2026-03-01')), ['2026-03-01']);
  eq('через год', monthsInPeriod({ fromDate: '2025-11-15', toDateExclusive: '2026-02-02' }), [
    '2025-11-01',
    '2025-12-01',
    '2026-01-01',
    '2026-02-01',
  ]);
  eq('expand: внутри одного месяца', expandToWholeMonths({ fromDate: '2026-03-05', toDateExclusive: '2026-03-10' }), {
    fromDate: '2026-03-01',
    toDateExclusive: '2026-04-01',
  });
  eq('expand: на стыке двух', expandToWholeMonths({ fromDate: '2026-03-25', toDateExclusive: '2026-04-05' }), {
    fromDate: '2026-03-01',
    toDateExclusive: '2026-05-01',
  });
  eq('expand: toExclusive = 1-е не тянет следующий месяц', expandToWholeMonths({ fromDate: '2026-03-10', toDateExclusive: '2026-04-01' }), {
    fromDate: '2026-03-01',
    toDateExclusive: '2026-04-01',
  });
  eq('expand: целый месяц неизменен', expandToWholeMonths(monthPeriod('2026-02-01')), monthPeriod('2026-02-01'));
  eq('expand: декабрь → 1 января', expandToWholeMonths({ fromDate: '2026-12-10', toDateExclusive: '2026-12-20' }), {
    fromDate: '2026-12-01',
    toDateExclusive: '2027-01-01',
  });
}

console.log('\n=== previousPeriod / previousYearPeriod ===');
{
  eq('previousPeriod 7 дней', previousPeriod({ fromDate: '2026-03-08', toDateExclusive: '2026-03-15' }), {
    fromDate: '2026-03-01',
    toDateExclusive: '2026-03-08',
  });
  eq('previousPeriod через год', previousPeriod({ fromDate: '2026-01-01', toDateExclusive: '2026-01-04' }), {
    fromDate: '2025-12-29',
    toDateExclusive: '2026-01-01',
  });
  eq('previousPeriod: длина сохраняется', periodDays(previousPeriod(monthPeriod('2026-03-01'))), 31);
  eq('previousYearPeriod обычный', previousYearPeriod({ fromDate: '2026-03-01', toDateExclusive: '2026-04-01' }), {
    fromDate: '2025-03-01',
    toDateExclusive: '2025-04-01',
  });
  eq('previousYearPeriod: 29.02 → 28.02 (начало)', previousYearPeriod({ fromDate: '2024-02-29', toDateExclusive: '2024-03-05' }), {
    fromDate: '2023-02-28',
    toDateExclusive: '2023-03-05',
  });
  eq('previousYearPeriod: период оканчивается 29.02', previousYearPeriod({ fromDate: '2024-02-01', toDateExclusive: '2024-03-01' }), {
    fromDate: '2023-02-01',
    toDateExclusive: '2023-03-01',
  });
  eq('previousYearPeriod: один день 29.02', previousYearPeriod({ fromDate: '2024-02-29', toDateExclusive: '2024-03-01' }), {
    fromDate: '2023-02-28',
    toDateExclusive: '2023-03-01',
  });
  eq('previousYearPeriod: целый 2024 → 2023', previousYearPeriod({ fromDate: '2024-01-01', toDateExclusive: '2025-01-01' }), {
    fromDate: '2023-01-01',
    toDateExclusive: '2024-01-01',
  });
}

console.log('\n=== mskDayOf (МСК = UTC+3) ===');
{
  eq('21:30Z → следующий день МСК', mskDayOf(new Date('2026-03-01T21:30:00Z')), '2026-03-02');
  eq('20:59:59Z → тот же день МСК', mskDayOf(new Date('2026-03-01T20:59:59Z')), '2026-03-01');
  eq('21:00:00Z → следующий день МСК', mskDayOf(new Date('2026-03-01T21:00:00Z')), '2026-03-02');
  eq('граница года', mskDayOf(new Date('2025-12-31T21:00:00Z')), '2026-01-01');
  eq('полдень', mskDayOf(new Date('2026-07-15T12:00:00Z')), '2026-07-15');
  throws('Invalid Date бросает', () => mskDayOf(new Date('нет')));
}

console.log('\n=== совместимость с OzonQueryPeriod ===');
{
  // Присваиваемость проверяется компилятором (typecheck); в рантайме — что поля читаются.
  const p: Period = resolveOzonQueryPeriod('7d', null, null, { now: new Date('2026-03-10T12:00:00Z') });
  eq('7d: from/to', { f: p.fromDate, t: p.toDateExclusive }, { f: '2026-03-04', t: '2026-03-11' });
  ok('7d: isValidPeriod', isValidPeriod(p));
  eq('7d: periodDays = 7', periodDays(p), 7);
}

{
  // Целый февраль невисокосного года → целый февраль високосного (29 дней, без потери 29.02).
  eq('previousYearPeriod: целый февраль 2025 → целый февраль 2024',
    previousYearPeriod({ fromDate: '2025-02-01', toDateExclusive: '2025-03-01' }),
    { fromDate: '2024-02-01', toDateExclusive: '2024-03-01' });
}

console.log(`\nИтого: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
