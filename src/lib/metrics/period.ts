// PURPOSE: Общий модуль периодов слоя метрик: календарные дни Москвы, полуинтервалы
// [fromDate, toDateExclusive). Чистый: без db/env/React и без зависимости от TZ процесса —
// вся арифметика идёт через Date.UTC над строками YYYY-MM-DD.

import { moscowDateString, shiftIsoDate } from '@/lib/marketplaces/ozon/sync/perf-period';

/**
 * Период в календарных днях МСК, полуинтервал. Структурно совместим с OzonQueryPeriod
 * (у того лишнее поле timezone), поэтому Ozon-периоды передаются сюда без преобразования.
 */
export interface Period {
  /** Первый день периода (включительно), YYYY-MM-DD. */
  fromDate: string;
  /** Первый день ПОСЛЕ периода, YYYY-MM-DD. */
  toDateExclusive: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Строгая проверка: формат YYYY-MM-DD и реальная календарная дата (2026-02-30 → false). */
export function isIsoDate(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  // Round-trip через UTC: «30 февраля» перекатится в март и не совпадёт.
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function assertIso(s: unknown, what = 'Дата'): asserts s is string {
  if (!isIsoDate(s)) {
    throw new Error(`${what} «${String(s)}» не является корректной датой формата ГГГГ-ММ-ДД`);
  }
}

/** Номер дня от эпохи (целое) — основа всей арифметики, не зависит от TZ процесса. */
function dayNumber(iso: string): number {
  const m = ISO_RE.exec(iso)!;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY;
}

function fromDayNumber(n: number): string {
  return new Date(n * MS_PER_DAY).toISOString().slice(0, 10);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

/** Календарный день Москвы для момента времени (МСК = UTC+3 без переходов). */
export function mskDayOf(d: Date): string {
  if (!(d instanceof Date) || !Number.isFinite(d.getTime())) {
    throw new Error('Момент времени некорректен: ожидался валидный Date');
  }
  return moscowDateString(d);
}

/** Сдвиг даты на n целых дней (n может быть отрицательным). */
export function addDays(iso: string, n: number): string {
  assertIso(iso);
  if (!Number.isInteger(n)) throw new Error(`Сдвиг в днях должен быть целым числом, получено ${n}`);
  return shiftIsoDate(iso, n);
}

/** Число дней от fromIso до toIso (toIso − fromIso), может быть отрицательным. */
export function diffDays(fromIso: string, toIso: string): number {
  assertIso(fromIso, 'Начальная дата');
  assertIso(toIso, 'Конечная дата');
  return dayNumber(toIso) - dayNumber(fromIso);
}

/** Первое число месяца, к которому относится дата: 'YYYY-MM-01'. */
export function monthOf(iso: string): string {
  assertIso(iso);
  return iso.slice(0, 8) + '01';
}

function assertMonthStart(monthIso: string): void {
  assertIso(monthIso, 'Месяц');
  if (!monthIso.endsWith('-01')) {
    throw new Error(`Месяц «${monthIso}» должен быть первым числом (ГГГГ-ММ-01)`);
  }
}

/** Сдвиг первого числа месяца на n месяцев. */
export function addMonths(monthIso: string, n: number): string {
  assertMonthStart(monthIso);
  if (!Number.isInteger(n)) throw new Error(`Сдвиг в месяцах должен быть целым числом, получено ${n}`);
  const y = Number(monthIso.slice(0, 4));
  const mo = Number(monthIso.slice(5, 7)) - 1;
  const total = y * 12 + mo + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  return `${pad4(ny)}-${pad2(nm + 1)}-01`;
}

/** Последний календарный день месяца (включительно). */
export function lastDayOfMonth(monthIso: string): string {
  assertMonthStart(monthIso);
  return fromDayNumber(dayNumber(addMonths(monthIso, 1)) - 1);
}

/** Период, равный целому месяцу. */
export function monthPeriod(monthIso: string): Period {
  assertMonthStart(monthIso);
  return { fromDate: monthIso, toDateExclusive: addMonths(monthIso, 1) };
}

/** Обе даты валидны и from < toExclusive. Не бросает. */
export function isValidPeriod(p: Period): boolean {
  return (
    !!p &&
    isIsoDate(p.fromDate) &&
    isIsoDate(p.toDateExclusive) &&
    p.fromDate < p.toDateExclusive
  );
}

function assertPeriod(p: Period): void {
  if (!isValidPeriod(p)) {
    throw new Error(
      `Некорректный период [${String(p?.fromDate)}, ${String(p?.toDateExclusive)}): ` +
        'нужны две корректные даты, начало строго раньше конца',
    );
  }
}

/** Число календарных дней в периоде. */
export function periodDays(p: Period): number {
  assertPeriod(p);
  return dayNumber(p.toDateExclusive) - dayNumber(p.fromDate);
}

/** Входит ли день в полуинтервал. */
export function containsDay(p: Period, iso: string): boolean {
  assertPeriod(p);
  assertIso(iso);
  return iso >= p.fromDate && iso < p.toDateExclusive;
}

/** Пересечение двух периодов; null, если общих дней нет. */
export function intersect(a: Period, b: Period): Period | null {
  assertPeriod(a);
  assertPeriod(b);
  const fromDate = a.fromDate > b.fromDate ? a.fromDate : b.fromDate;
  const toDateExclusive = a.toDateExclusive < b.toDateExclusive ? a.toDateExclusive : b.toDateExclusive;
  return fromDate < toDateExclusive ? { fromDate, toDateExclusive } : null;
}

/** Все дни периода по возрастанию. */
export function eachDay(p: Period): string[] {
  const n = periodDays(p);
  const start = dayNumber(p.fromDate);
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) out.push(fromDayNumber(start + i));
  return out;
}

/**
 * Месяцы ('YYYY-MM-01'), которые период затрагивает. Полуинтервал: если toDateExclusive —
 * первое число, этот месяц НЕ входит (его дни в период не попали).
 */
export function monthsInPeriod(p: Period): string[] {
  assertPeriod(p);
  const lastMonth = monthOf(addDays(p.toDateExclusive, -1));
  const out: string[] = [];
  for (let m = monthOf(p.fromDate); m <= lastMonth; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** Расширение до целых месяцев: разнесения считаются на целых единицах (дизайн, раздел 3). */
export function expandToWholeMonths(p: Period): Period {
  assertPeriod(p);
  const lastMonth = monthOf(addDays(p.toDateExclusive, -1));
  return { fromDate: monthOf(p.fromDate), toDateExclusive: addMonths(lastMonth, 1) };
}

/** Период той же длины, непосредственно предшествующий данному. */
export function previousPeriod(p: Period): Period {
  const n = periodDays(p);
  return { fromDate: addDays(p.fromDate, -n), toDateExclusive: p.fromDate };
}

/** Тот же день годом ранее; 29 февраля → 28 февраля. */
function shiftYearBack(iso: string): string {
  const y = Number(iso.slice(0, 4)) - 1;
  let md = iso.slice(5);
  if (md === '02-29') md = '02-28';
  return `${pad4(y)}-${md}`;
}

/**
 * Тот же период год назад. Сдвигаем начало и ПОСЛЕДНИЙ включённый день, а не
 * toDateExclusive: иначе период, оканчивающийся 29 февраля, потерял бы день.
 */
export function previousYearPeriod(p: Period): Period {
  assertPeriod(p);
  // Период из целых месяцев сравнивается с теми же целыми месяцами: иначе февраль
  // невисокосного года получил бы год назад 28 дней из 29 (потерялось бы 29.02).
  if (p.fromDate.endsWith('-01') && p.toDateExclusive.endsWith('-01')) {
    return { fromDate: shiftYearBack(p.fromDate), toDateExclusive: shiftYearBack(p.toDateExclusive) };
  }
  const lastIncl = addDays(p.toDateExclusive, -1);
  const from = shiftYearBack(p.fromDate);
  const to = addDays(shiftYearBack(lastIncl), 1);
  return { fromDate: from, toDateExclusive: to };
}

/** Первое января года даты (начало нарастающего итога налога). */
export function yearStartOf(iso: string): string {
  assertIso(iso);
  return iso.slice(0, 4) + '-01-01';
}
