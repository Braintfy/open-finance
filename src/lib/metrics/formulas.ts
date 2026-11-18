// PURPOSE: Формулы метрик слоя (docs/METRICS_LAYER_DESIGN.md, раздел 8) — каждая определена один раз.
// Суммы статей хранятся со знаком (расходы отрицательны). Неизвестная себестоимость даёт
// value: null, complete: false и никогда не превращается в ноль; «неопределённость деления»
// (знаменатель <= 0) — value: null при complete: true, это не неполнота данных.

import { MP_FEE_LINES, PROFIT_LINES, type LineCode } from './lines';

export interface LineSum {
  /** null = есть неизвестная часть (осмысленно только для cogs). */
  amountKopecks: number | null;
  qty: number;
  baseQty: number;
  unknownCount: number;
}

/** Отсутствующая статья = ноль. */
export type LineTotals = Partial<Record<LineCode, LineSum>>;

export interface Metric {
  value: number | null;
  complete: boolean;
}

export type MetricName =
  | 'netRevenue'
  | 'profit'
  | 'marginPct'
  | 'drrPct'
  | 'buyoutPct'
  | 'roiPct'
  | 'feesPct'
  | 'avgCheck'
  | 'unitProfit';

const UNKNOWN: Metric = { value: null, complete: false };
const UNDEFINED: Metric = { value: null, complete: true };

function amount(t: LineTotals, code: LineCode): number {
  return t[code]?.amountKopecks ?? 0;
}

function qty(t: LineTotals, code: LineCode): number {
  return t[code]?.qty ?? 0;
}

function baseQty(t: LineTotals, code: LineCode): number {
  return t[code]?.baseQty ?? 0;
}

/** Есть ли неизвестная часть: сумма null или есть строки без известной суммы. */
function isUnknown(t: LineTotals, code: LineCode): boolean {
  const s = t[code];
  return !!s && (s.amountKopecks === null || s.unknownCount > 0);
}

function netRevenueValue(t: LineTotals): number {
  return amount(t, 'revenue') + amount(t, 'returns') + amount(t, 'mp_topup');
}

/** Прибыль в копейках либо null, если неизвестна хотя бы одна статья прибыли. */
function profitValue(t: LineTotals): number | null {
  let sum = 0;
  for (const code of PROFIT_LINES) {
    if (isUnknown(t, code)) return null;
    sum += amount(t, code);
  }
  return sum;
}

export function netRevenue(t: LineTotals): Metric {
  return { value: netRevenueValue(t), complete: true };
}

export function profit(t: LineTotals): Metric {
  const v = profitValue(t);
  return v === null ? { ...UNKNOWN } : { value: v, complete: true };
}

export function marginPct(t: LineTotals): Metric {
  const p = profitValue(t);
  if (p === null) return { ...UNKNOWN };
  const nr = netRevenueValue(t);
  if (nr <= 0) return { ...UNDEFINED };
  return { value: (p * 100) / nr, complete: true };
}

export function drrPct(t: LineTotals): Metric {
  const nr = netRevenueValue(t);
  if (nr <= 0) return { ...UNDEFINED };
  // «0 − x», а не «−x»: при нулевой рекламе унарный минус дал бы −0, и форматтер напечатал бы «-0».
  return { value: ((0 - amount(t, 'ads')) * 100) / nr, complete: true };
}

export function buyoutPct(t: LineTotals): Metric {
  const sold = qty(t, 'revenue');
  if (sold === 0) return { ...UNDEFINED };
  return { value: ((sold - qty(t, 'returns')) * 100) / sold, complete: true };
}

export function roiPct(t: LineTotals): Metric {
  const p = profitValue(t);
  if (p === null) return { ...UNKNOWN };
  const cogs = amount(t, 'cogs');
  if (cogs === 0) return { ...UNDEFINED };
  return { value: (p * 100) / -cogs, complete: true };
}

export function feesPct(t: LineTotals): Metric {
  const nr = netRevenueValue(t);
  if (nr <= 0) return { ...UNDEFINED };
  let fees = 0;
  for (const code of MP_FEE_LINES) fees += amount(t, code);
  return { value: ((0 - fees) * 100) / nr, complete: true };
}

export function avgCheck(t: LineTotals): Metric {
  const units = qty(t, 'revenue') - qty(t, 'returns');
  if (units <= 0) return { ...UNDEFINED };
  return { value: Math.round(netRevenueValue(t) / units), complete: true };
}

export function unitProfit(t: LineTotals): Metric {
  const p = profitValue(t);
  if (p === null) return { ...UNKNOWN };
  const units = baseQty(t, 'revenue') - baseQty(t, 'returns');
  if (units <= 0) return { ...UNDEFINED };
  return { value: Math.round(p / units), complete: true };
}

export function computeMetrics(t: LineTotals): Record<MetricName, Metric> {
  return {
    netRevenue: netRevenue(t),
    profit: profit(t),
    marginPct: marginPct(t),
    drrPct: drrPct(t),
    buyoutPct: buyoutPct(t),
    roiPct: roiPct(t),
    feesPct: feesPct(t),
    avgCheck: avgCheck(t),
    unitProfit: unitProfit(t),
  };
}
