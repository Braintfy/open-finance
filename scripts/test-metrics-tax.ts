// PURPOSE: Smoke-тесты налога слоя метрик (src/lib/metrics/tax.ts): перенос calcUnitTax
// без изменения поведения и новые функции в копейках (годовой ряд, минимальный налог).
// Запуск: pnpm -s tsx scripts/test-metrics-tax.ts

import {
  USN_MIN_TAX_RATE,
  calcMinTaxKopecks,
  calcPeriodTaxKopecks,
  calcUnitTax,
  calcYearTaxSeries,
  type TaxProfile,
} from '../src/lib/metrics/tax';

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

/** Для рублёвой float-арифметики сравниваем с допуском, а не побитово. */
function near(label: string, actual: number, expected: number) {
  ok(label, Math.abs(actual - expected) < 1e-9, `получено ${actual}, ожидалось ${expected}`);
}

function throws(label: string, fn: () => unknown) {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  ok(label, threw);
}

const USN_D: TaxProfile = { mode: 'usn_income', rateBp: 600, minTaxBp: 100 };
const USN_DR: TaxProfile = { mode: 'usn_income_minus', rateBp: 1500, minTaxBp: 100 };
const NONE: TaxProfile = { mode: 'none', rateBp: 600, minTaxBp: 100 };

// ===========================================================================
console.log('\n=== calcUnitTax: значения, посчитанные руками по старой формуле ===');
// ===========================================================================
{
  near('константа минимального налога 1 %', USN_MIN_TAX_RATE, 0.01);
  near('usn_income 6 %: 1000 → 60', calcUnitTax(1000, 0, 'usn_income', 6), 60);
  near('usn_income игнорирует расходы: 1000, расходы 900 → 60', calcUnitTax(1000, 900, 'usn_income', 6), 60);
  near('usn_income_minus 15 %: 1000, расходы 400 → 90', calcUnitTax(1000, 400, 'usn_income_minus', 15), 90);
  near('минимальный налог: 1000, расходы 990, 15 % → max(1.5, 10) = 10', calcUnitTax(1000, 990, 'usn_income_minus', 15), 10);
  near('убыток: 1000, расходы 1500 → минимальный налог 10', calcUnitTax(1000, 1500, 'usn_income_minus', 15), 10);
  near('osno 20 %: 500 → 100', calcUnitTax(500, 0, 'osno', 20), 100);
  eq('none → 0', calcUnitTax(1000, 0, 'none', 6), 0);
  near('ставка выше 100 % режется до 100: 200 → 200', calcUnitTax(200, 0, 'usn_income', 150), 200);
  eq('отрицательный доход: налог 0', calcUnitTax(-100, 0, 'usn_income', 6), 0);
  eq('отрицательный доход, usn_income_minus: 0', calcUnitTax(-100, 0, 'usn_income_minus', 15), 0);
}

// ===========================================================================
console.log('\n=== calcPeriodTaxKopecks / calcMinTaxKopecks ===');
// ===========================================================================
{
  eq('usn_income 6 %: 1 000 000 → 60 000', calcPeriodTaxKopecks({ incomeYtdKopecks: 1_000_000, expensesYtdKopecks: 0, profile: USN_D }), 60_000);
  eq('usn_income не смотрит на расходы', calcPeriodTaxKopecks({ incomeYtdKopecks: 1_000_000, expensesYtdKopecks: 900_000, profile: USN_D }), 60_000);
  eq('usn_income_minus: (1 000 − 400) × 15 % = 90', calcPeriodTaxKopecks({ incomeYtdKopecks: 1000, expensesYtdKopecks: 400, profile: USN_DR }), 90);
  eq('usn_income_minus: убыток → 0', calcPeriodTaxKopecks({ incomeYtdKopecks: 1000, expensesYtdKopecks: 5000, profile: USN_DR }), 0);
  eq('none → 0', calcPeriodTaxKopecks({ incomeYtdKopecks: 1_000_000, expensesYtdKopecks: 0, profile: NONE }), 0);
  eq('usn_income, отрицательный доход → 0 (не минус)', calcPeriodTaxKopecks({ incomeYtdKopecks: -5000, expensesYtdKopecks: 0, profile: USN_D }), 0);
  eq('округление: 25 коп. × 6 % = 1,5 → 2', calcPeriodTaxKopecks({ incomeYtdKopecks: 25, expensesYtdKopecks: 0, profile: USN_D }), 2);
  eq('округление: 24 коп. × 6 % = 1,44 → 1', calcPeriodTaxKopecks({ incomeYtdKopecks: 24, expensesYtdKopecks: 0, profile: USN_D }), 1);
  eq('округление: 1 коп. × 6 % = 0,06 → 0', calcPeriodTaxKopecks({ incomeYtdKopecks: 1, expensesYtdKopecks: 0, profile: USN_D }), 0);
  eq('ставка 0 → 0', calcPeriodTaxKopecks({ incomeYtdKopecks: 1_000_000, expensesYtdKopecks: 0, profile: { ...USN_D, rateBp: 0 } }), 0);

  eq('минимальный налог: 1 000 000 × 1 % = 10 000', calcMinTaxKopecks({ incomeYtdKopecks: 1_000_000, profile: USN_DR }), 10_000);
  eq('минимальный налог для usn_income = 0', calcMinTaxKopecks({ incomeYtdKopecks: 1_000_000, profile: USN_D }), 0);
  eq('минимальный налог для none = 0', calcMinTaxKopecks({ incomeYtdKopecks: 1_000_000, profile: NONE }), 0);
  eq('минимальный налог при отрицательном доходе = 0', calcMinTaxKopecks({ incomeYtdKopecks: -100, profile: USN_DR }), 0);
}

// ===========================================================================
console.log('\n=== calcYearTaxSeries: сценарии ===');
// ===========================================================================
{
  // Пример дизайна: Д-Р 15 %. Янв: 100 / 140 → 0. Фев: 200 / 100 → (300 − 240) × 15 % = 9 (в копейках ×100).
  const r = calcYearTaxSeries(
    [
      { month: '2026-01-01', incomeKopecks: 10_000, expensesKopecks: 14_000 },
      { month: '2026-02-01', incomeKopecks: 20_000, expensesKopecks: 10_000 },
    ],
    USN_DR,
  );
  eq('пример дизайна: налог января 0', r.months[0].taxMonthKopecks, 0);
  eq('пример дизайна: итог на конец января 0', r.months[0].taxYtdKopecks, 0);
  eq('пример дизайна: итог февраля 900', r.months[1].taxYtdKopecks, 900);
  eq('пример дизайна: налог февраля 900', r.months[1].taxMonthKopecks, 900);
  eq('нарастающие доход/расходы в феврале', [r.months[1].incomeYtdKopecks, r.months[1].expensesYtdKopecks], [30_000, 24_000]);
  eq('налог года 900', r.taxYearKopecks, 900);
}
{
  // Убыток после прибыли: янв прибыль 10 000 → налог 1500; фев убыток 4 000 → итог 900, налог месяца −600.
  const r = calcYearTaxSeries(
    [
      { month: '2026-01-01', incomeKopecks: 20_000, expensesKopecks: 10_000 },
      { month: '2026-02-01', incomeKopecks: 0, expensesKopecks: 4_000 },
    ],
    USN_DR,
  );
  eq('убыток после прибыли: налог января 1500', r.months[0].taxMonthKopecks, 1500);
  eq('убыток после прибыли: итог февраля 900', r.months[1].taxYtdKopecks, 900);
  eq('убыток после прибыли: налог февраля −600', r.months[1].taxMonthKopecks, -600);
  ok('итог года не ниже 0', r.taxYearKopecks >= 0);
}
{
  // Убыточный январь целиком и всё ещё убыток к концу года: итог 0, а не минус.
  const r = calcYearTaxSeries(
    [
      { month: '2026-01-01', incomeKopecks: 1_000, expensesKopecks: 9_000 },
      { month: '2026-03-01', incomeKopecks: 1_000, expensesKopecks: 9_000 },
    ],
    USN_DR,
  );
  eq('убыточный год: налог года 0', r.taxYearKopecks, 0);
  ok('убыточный год: ни один итог с начала года не отрицателен', r.months.every((m) => m.taxYtdKopecks >= 0));
}
{
  // usn_income: возвраты больше продаж за месяц.
  const r = calcYearTaxSeries([{ month: '2026-01-01', incomeKopecks: -50_000, expensesKopecks: 0 }], USN_D);
  eq('usn_income, отрицательный доход месяца → налог 0', r.months[0].taxMonthKopecks, 0);
  eq('usn_income, отрицательный доход → итог года 0', r.taxYearKopecks, 0);

  // После положительного месяца отрицательный уменьшает накопленный налог, но не ниже нуля.
  const r2 = calcYearTaxSeries(
    [
      { month: '2026-01-01', incomeKopecks: 100_000, expensesKopecks: 0 },
      { month: '2026-02-01', incomeKopecks: -300_000, expensesKopecks: 0 },
    ],
    USN_D,
  );
  eq('usn_income: январь 6000', r2.months[0].taxMonthKopecks, 6000);
  eq('usn_income: февраль −6000, итог 0', [r2.months[1].taxMonthKopecks, r2.months[1].taxYtdKopecks], [-6000, 0]);
}
{
  // Минимальный налог: доход 1 000 000, расходы 990 000.
  const r = calcYearTaxSeries([{ month: '2026-12-01', incomeKopecks: 1_000_000, expensesKopecks: 990_000 }], USN_DR);
  eq('минимальный налог: налог года 1500', r.taxYearKopecks, 1500);
  eq('минимальный налог: сумма 10 000', r.minTaxKopecks, 10_000);
  eq('минимальный налог: доначисление 8500', r.minTaxTopUpKopecks, 8500);

  const r2 = calcYearTaxSeries([{ month: '2026-12-01', incomeKopecks: 1_000_000, expensesKopecks: 0 }], USN_DR);
  eq('налог выше минимального: доначисления нет', r2.minTaxTopUpKopecks, 0);

  const r3 = calcYearTaxSeries([{ month: '2026-12-01', incomeKopecks: 1_000_000, expensesKopecks: 990_000 }], USN_D);
  eq('usn_income: минимальный налог и доначисление = 0', [r3.minTaxKopecks, r3.minTaxTopUpKopecks], [0, 0]);
}
{
  const r = calcYearTaxSeries(
    [
      { month: '2026-01-01', incomeKopecks: 123_457, expensesKopecks: 0 },
      { month: '2026-02-01', incomeKopecks: 7, expensesKopecks: 0 },
    ],
    NONE,
  );
  eq('none: все налоги 0', [r.taxYearKopecks, ...r.months.map((m) => m.taxMonthKopecks)], [0, 0, 0]);
  eq('none: минимальный налог 0', [r.minTaxKopecks, r.minTaxTopUpKopecks], [0, 0]);
}
{
  // Округление на нечётных копейках: итоги округляются, разности согласованы, Σ taxMonth === taxYear.
  const months = [
    { month: '2026-01-01', incomeKopecks: 25, expensesKopecks: 0 },
    { month: '2026-02-01', incomeKopecks: 25, expensesKopecks: 0 },
    { month: '2026-04-01', incomeKopecks: 3, expensesKopecks: 0 },
  ];
  const r = calcYearTaxSeries(months, USN_D);
  eq('нечётные копейки: итоги с начала года', r.months.map((m) => m.taxYtdKopecks), [2, 3, 3]);
  eq('нечётные копейки: налоги месяцев', r.months.map((m) => m.taxMonthKopecks), [2, 1, 0]);
  eq('Σ taxMonth === taxYear (пропуск марта допустим)', r.months.reduce((s, m) => s + m.taxMonthKopecks, 0), r.taxYearKopecks);
}
{
  const r = calcYearTaxSeries([], USN_DR);
  eq('пустой ряд: нули', [r.months.length, r.taxYearKopecks, r.minTaxKopecks, r.minTaxTopUpKopecks], [0, 0, 0, 0]);
}

// ===========================================================================
console.log('\n=== Ошибки ввода ===');
// ===========================================================================
{
  throws('несортированные месяцы', () =>
    calcYearTaxSeries(
      [
        { month: '2026-03-01', incomeKopecks: 1, expensesKopecks: 0 },
        { month: '2026-02-01', incomeKopecks: 1, expensesKopecks: 0 },
      ],
      USN_D,
    ),
  );
  throws('повтор месяца', () =>
    calcYearTaxSeries(
      [
        { month: '2026-02-01', incomeKopecks: 1, expensesKopecks: 0 },
        { month: '2026-02-01', incomeKopecks: 1, expensesKopecks: 0 },
      ],
      USN_D,
    ),
  );
  throws('два разных года', () =>
    calcYearTaxSeries(
      [
        { month: '2025-12-01', incomeKopecks: 1, expensesKopecks: 0 },
        { month: '2026-01-01', incomeKopecks: 1, expensesKopecks: 0 },
      ],
      USN_D,
    ),
  );
  throws('отрицательные расходы в ряду', () =>
    calcYearTaxSeries([{ month: '2026-01-01', incomeKopecks: 1, expensesKopecks: -1 }], USN_DR),
  );
  throws('отрицательные расходы в calcPeriodTaxKopecks', () =>
    calcPeriodTaxKopecks({ incomeYtdKopecks: 100, expensesYtdKopecks: -1, profile: USN_DR }),
  );
  throws('дробные копейки дохода', () =>
    calcPeriodTaxKopecks({ incomeYtdKopecks: 100.5, expensesYtdKopecks: 0, profile: USN_D }),
  );
  throws('дробные копейки расходов в ряду', () =>
    calcYearTaxSeries([{ month: '2026-01-01', incomeKopecks: 1, expensesKopecks: 0.5 }], USN_DR),
  );
  throws('ставка выше 10000 бп', () =>
    calcPeriodTaxKopecks({ incomeYtdKopecks: 1, expensesYtdKopecks: 0, profile: { ...USN_D, rateBp: 10001 } }),
  );
  throws('отрицательная ставка', () =>
    calcPeriodTaxKopecks({ incomeYtdKopecks: 1, expensesYtdKopecks: 0, profile: { ...USN_D, rateBp: -1 } }),
  );
  throws('дробная ставка', () =>
    calcMinTaxKopecks({ incomeYtdKopecks: 1, profile: { ...USN_DR, minTaxBp: 99.5 } }),
  );
  throws('кривой формат месяца', () =>
    calcYearTaxSeries([{ month: '2026-01-15', incomeKopecks: 1, expensesKopecks: 0 }], USN_D),
  );
}

console.log(`\n${failed === 0 ? '✅' : '❌'} passed: ${passed}, failed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
