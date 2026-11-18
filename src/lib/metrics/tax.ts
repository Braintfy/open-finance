// PURPOSE: Налог слоя метрик. Две разные вещи под одной крышей:
//  1) calcUnitTax — налог НА ЕДИНИЦУ товара в рублях (перенос из калькуляторов
//     юнит-экономики Ozon/Яндекс без изменения поведения; дубль убран);
//  2) calcPeriodTaxKopecks / calcMinTaxKopecks / calcYearTaxSeries — налог
//     БИЗНЕСА нарастающим итогом за год, целые копейки, ставки в базисных пунктах.
// Чистый модуль: без БД, окружения и фреймворка. Это управленческая оценка, не декларация.

import type { TaxMode } from '@/lib/unit-economics/types';
import { clamp, safeNumber } from '@/lib/unit-economics/types';

/** Минимальный налог для УСН «Доходы минус расходы» — 1% от доходов. */
export const USN_MIN_TAX_RATE = 0.01;

/**
 * Налог на одну продажу. База — доход без НДС (`netRevenue`).
 * - usn_income (УСН Доходы): ставка% от дохода без НДС.
 * - usn_income_minus (УСН Д-Р): ставка% от (доход − расходы), но не меньше
 *   минимального налога 1% от дохода.
 * - osno: ставка% от дохода без НДС (упрощение; сам НДС считается отдельно
 *   строкой `vat`). См. отчёт — база налога на прибыль требует уточнения.
 * - none: 0.
 */
export function calcUnitTax(
  netRevenue: number,
  deductibleExpenses: number,
  mode: TaxMode,
  ratePct: number,
): number {
  if (mode === 'none') return 0;
  const rate = clamp(safeNumber(ratePct), 0, 100) / 100;
  if (mode === 'usn_income_minus') {
    const taxable = Math.max(0, netRevenue - deductibleExpenses);
    const minTax = Math.max(0, netRevenue) * USN_MIN_TAX_RATE;
    return Math.max(taxable * rate, minTax);
  }
  return Math.max(0, netRevenue) * rate;
}

// ---------------------------------------------------------------------------
// Налог слоя: копейки и базисные пункты
// ---------------------------------------------------------------------------

/** Режимы, которые поддерживает слой. ОСНО намеренно отсутствует (раздел 6 дизайна). */
export type LayerTaxMode = 'usn_income' | 'usn_income_minus' | 'none';

/** Налоговый профиль года; ставки в базисных пунктах (600 = 6 %). */
export interface TaxProfile {
  mode: LayerTaxMode;
  rateBp: number;
  minTaxBp: number;
}

export interface MonthInput {
  /** Первый день месяца, 'YYYY-MM-01'. */
  month: string;
  incomeKopecks: number;
  /** Модуль расходов, ≥ 0. */
  expensesKopecks: number;
}

export interface MonthTax {
  month: string;
  incomeYtdKopecks: number;
  expensesYtdKopecks: number;
  taxYtdKopecks: number;
  /** Может быть отрицательным: убыточный месяц уменьшает накопленный налог. */
  taxMonthKopecks: number;
}

function assertInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${label}: ожидаются целые копейки, получено ${value}`);
  }
}

function assertBp(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 10000) {
    throw new Error(`${label}: ставка должна быть целым числом базисных пунктов от 0 до 10000, получено ${value}`);
  }
}

function assertProfile(profile: TaxProfile): void {
  assertBp(profile.rateBp, 'Ставка налога');
  assertBp(profile.minTaxBp, 'Ставка минимального налога');
}

/**
 * Налог с начала года на накопленные доход и расходы. Минимальный налог
 * сюда НЕ входит — он отдельно (calcMinTaxKopecks), чтобы доначисление было видно строкой.
 * Базу режем снизу нулём: убыток налога не создаёт, итог года не уходит в минус.
 */
export function calcPeriodTaxKopecks(input: {
  incomeYtdKopecks: number;
  expensesYtdKopecks: number;
  profile: TaxProfile;
}): number {
  const { incomeYtdKopecks, expensesYtdKopecks, profile } = input;
  assertInt(incomeYtdKopecks, 'Доход');
  assertInt(expensesYtdKopecks, 'Расходы');
  if (expensesYtdKopecks < 0) {
    throw new Error('Расходы передаются положительным числом (модулем), получено отрицательное значение');
  }
  assertProfile(profile);
  if (profile.mode === 'none') return 0;
  // Профиль приходит из БД строкой: неизвестный режим (например «osno») не должен
  // молча считаться как «доходы минус расходы».
  if (profile.mode !== 'usn_income' && profile.mode !== 'usn_income_minus') {
    throw new Error(`Налоговый режим «${String(profile.mode)}» слоем метрик не поддерживается`);
  }
  const base =
    profile.mode === 'usn_income'
      ? Math.max(0, incomeYtdKopecks)
      : Math.max(0, incomeYtdKopecks - expensesYtdKopecks);
  return Math.round((base * profile.rateBp) / 10000);
}

/** Минимальный налог года: только «доходы минус расходы», от доходов. */
export function calcMinTaxKopecks(input: { incomeYtdKopecks: number; profile: TaxProfile }): number {
  const { incomeYtdKopecks, profile } = input;
  assertInt(incomeYtdKopecks, 'Доход');
  assertProfile(profile);
  if (profile.mode !== 'usn_income_minus') return 0;
  return Math.round((Math.max(0, incomeYtdKopecks) * profile.minTaxBp) / 10000);
}

function parseMonth(month: string): { year: number; ym: number } {
  const m = /^(\d{4})-(\d{2})-01$/.exec(month);
  if (!m) throw new Error(`Месяц должен быть в формате ГГГГ-ММ-01, получено «${month}»`);
  const mm = Number(m[2]);
  if (mm < 1 || mm > 12) throw new Error(`Некорректный номер месяца: «${month}»`);
  const year = Number(m[1]);
  return { year, ym: year * 12 + mm };
}

/**
 * Годовой ряд налога: месяцы одного года по возрастанию (пропуски допустимы).
 * Налог месяца = итог с начала года на конец месяца − итог на конец предыдущего
 * месяца ряда, поэтому Σ taxMonth === taxYear.
 */
export function calcYearTaxSeries(
  months: readonly MonthInput[],
  profile: TaxProfile,
): { months: MonthTax[]; taxYearKopecks: number; minTaxKopecks: number; minTaxTopUpKopecks: number } {
  assertProfile(profile);

  let year: number | null = null;
  let prevYm = -1;
  for (const row of months) {
    const parsed = parseMonth(row.month);
    if (year === null) year = parsed.year;
    else if (parsed.year !== year) {
      throw new Error('Ряд должен содержать месяцы одного календарного года');
    }
    if (parsed.ym <= prevYm) {
      throw new Error('Месяцы должны идти строго по возрастанию, без повторов');
    }
    prevYm = parsed.ym;
    assertInt(row.incomeKopecks, `Доход за ${row.month}`);
    assertInt(row.expensesKopecks, `Расходы за ${row.month}`);
    if (row.expensesKopecks < 0) {
      throw new Error(`Расходы за ${row.month} переданы отрицательными; ожидается модуль`);
    }
  }

  const result: MonthTax[] = [];
  let incomeYtd = 0;
  let expensesYtd = 0;
  let prevTaxYtd = 0;
  for (const row of months) {
    incomeYtd += row.incomeKopecks;
    expensesYtd += row.expensesKopecks;
    const taxYtd = calcPeriodTaxKopecks({
      incomeYtdKopecks: incomeYtd,
      expensesYtdKopecks: expensesYtd,
      profile,
    });
    result.push({
      month: row.month,
      incomeYtdKopecks: incomeYtd,
      expensesYtdKopecks: expensesYtd,
      taxYtdKopecks: taxYtd,
      taxMonthKopecks: taxYtd - prevTaxYtd,
    });
    prevTaxYtd = taxYtd;
  }

  const taxYearKopecks = prevTaxYtd;
  const minTaxKopecks = calcMinTaxKopecks({ incomeYtdKopecks: incomeYtd, profile });
  const minTaxTopUpKopecks =
    profile.mode === 'usn_income_minus' ? Math.max(0, minTaxKopecks - taxYearKopecks) : 0;

  return { months: result, taxYearKopecks, minTaxKopecks, minTaxTopUpKopecks };
}
