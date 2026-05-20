// PURPOSE: Единое разрешение периода для Ozon-блоков и API routes.
// Все даты — календарные YYYY-MM-DD в Europe/Moscow (как Ozon LK / Performance API).
// SQL: `date >= fromDate AND date < toDateExclusive`.

import { moscowDateString, shiftIsoDate } from '@/lib/marketplaces/ozon/sync/perf-period';

export type OzonPeriodPreset =
  | 'today'
  | 'yesterday'
  | '7d'
  | '14d'
  | '30d'
  | 'mtd'
  | 'custom';

export const OZON_QUERY_TIMEZONE = 'Europe/Moscow' as const;

export type OzonQueryPeriod = {
  /** Первый день периода (включительно), YYYY-MM-DD MSC. */
  fromDate: string;
  /** Первый день после периода (exclusive), YYYY-MM-DD MSC. */
  toDateExclusive: string;
  timezone: typeof OZON_QUERY_TIMEZONE;
};

export type ResolveOzonQueryPeriodOptions = {
  now?: Date;
  /**
   * Исключить сегодня из периода (для chart — незавершённый день Ozon).
   * toDateExclusive = today(MSC), последний включённый = вчера.
   */
  excludeToday?: boolean;
};

/**
 * Разрешает пресет в MSC-диапазон для SQL и API.
 * `30d` = ровно 30 календарных дней inclusive (today-29 … today).
 */
export function resolveOzonQueryPeriod(
  preset: OzonPeriodPreset,
  customFrom?: string | null,
  customTo?: string | null,
  options: ResolveOzonQueryPeriodOptions = {},
): OzonQueryPeriod {
  const now = options.now ?? new Date();
  const todayMsc = moscowDateString(now);
  const tomorrowMsc = shiftIsoDate(todayMsc, 1);
  const endExclusive = options.excludeToday ? todayMsc : tomorrowMsc;

  if (preset === 'custom') {
    const fromDate = customFrom?.slice(0, 10) ?? shiftIsoDate(todayMsc, -29);
    const inclusiveTo = customTo?.slice(0, 10) ?? (options.excludeToday ? shiftIsoDate(todayMsc, -1) : todayMsc);
    const toDateExclusive = shiftIsoDate(inclusiveTo, 1);
    return { fromDate, toDateExclusive, timezone: OZON_QUERY_TIMEZONE };
  }

  if (preset === 'today') {
    return { fromDate: todayMsc, toDateExclusive: endExclusive, timezone: OZON_QUERY_TIMEZONE };
  }

  if (preset === 'yesterday') {
    const yesterday = shiftIsoDate(todayMsc, -1);
    return { fromDate: yesterday, toDateExclusive: todayMsc, timezone: OZON_QUERY_TIMEZONE };
  }

  const dayCounts: Record<'7d' | '14d' | '30d', number> = { '7d': 7, '14d': 14, '30d': 30 };
  if (preset in dayCounts) {
    const days = dayCounts[preset as '7d' | '14d' | '30d'];
    const fromDate = shiftIsoDate(todayMsc, -(days - 1));
    return { fromDate, toDateExclusive: endExclusive, timezone: OZON_QUERY_TIMEZONE };
  }

  if (preset === 'mtd') {
    const monthStart = todayMsc.slice(0, 8) + '01';
    return { fromDate: monthStart, toDateExclusive: endExclusive, timezone: OZON_QUERY_TIMEZONE };
  }

  const fromDate = shiftIsoDate(todayMsc, -29);
  return { fromDate, toDateExclusive: endExclusive, timezone: OZON_QUERY_TIMEZONE };
}

/** Предыдущий период той же длины (для delta KPI). */
export function getPreviousOzonQueryPeriod(period: OzonQueryPeriod): OzonQueryPeriod {
  const from = new Date(period.fromDate + 'T00:00:00Z');
  const toEx = new Date(period.toDateExclusive + 'T00:00:00Z');
  const lengthDays = Math.round((toEx.getTime() - from.getTime()) / (24 * 3600 * 1000));
  const prevToExclusive = period.fromDate;
  const prevFrom = shiftIsoDate(prevToExclusive, -lengthDays);
  return {
    fromDate: prevFrom,
    toDateExclusive: prevToExclusive,
    timezone: OZON_QUERY_TIMEZONE,
  };
}

/** Сдвиг периода на N дней (для compareMode=week-ago). */
export function shiftOzonQueryPeriod(
  period: OzonQueryPeriod,
  deltaDays: number,
): OzonQueryPeriod {
  return {
    fromDate: shiftIsoDate(period.fromDate, deltaDays),
    toDateExclusive: shiftIsoDate(period.toDateExclusive, deltaDays),
    timezone: OZON_QUERY_TIMEZONE,
  };
}

/** Человеко-читаемый label периода в MSC. */
export function describeOzonQueryPeriod(period: OzonQueryPeriod): string {
  const inclusiveTo = shiftIsoDate(period.toDateExclusive, -1);
  const fmt = (iso: string) => {
    const [y, m, d] = iso.split('-');
    return `${d}.${m}.${y}`;
  };
  if (period.fromDate === inclusiveTo) return `${fmt(period.fromDate)} MSC`;
  return `${fmt(period.fromDate)} — ${fmt(inclusiveTo)} MSC`;
}

/** Query params для fetch к Ozon API routes. */
export function ozonPeriodToSearchParams(
  period: OzonQueryPeriod,
  extra?: Record<string, string>,
): URLSearchParams {
  const params = new URLSearchParams({
    fromDate: period.fromDate,
    toDateExclusive: period.toDateExclusive,
    ...extra,
  });
  return params;
}

/**
 * Legacy `{ from: Date, to: Date }` для совместимости с period-picker типами.
 * Date — UTC midnight на границах MSC-дат (для старых callers).
 */
export function ozonQueryPeriodToLegacyDates(period: OzonQueryPeriod): {
  from: Date;
  to: Date;
} {
  return {
    from: new Date(period.fromDate + 'T00:00:00Z'),
    to: new Date(period.toDateExclusive + 'T00:00:00Z'),
  };
}

/** Парсит query string API: предпочитает fromDate/toDateExclusive, fallback на from/to ISO. */
export function parseOzonPeriodFromRequest(
  fromDateParam: string | null,
  toDateExclusiveParam: string | null,
  fromIsoParam: string | null,
  toIsoParam: string | null,
): OzonQueryPeriod | null {
  if (fromDateParam && toDateExclusiveParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDateParam)) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(toDateExclusiveParam)) return null;
    if (fromDateParam >= toDateExclusiveParam) return null;
    return {
      fromDate: fromDateParam,
      toDateExclusive: toDateExclusiveParam,
      timezone: OZON_QUERY_TIMEZONE,
    };
  }
  if (fromIsoParam && toIsoParam) {
    const from = new Date(fromIsoParam);
    const to = new Date(toIsoParam);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) return null;
    if (from >= to) return null;
    // Legacy ISO → MSC date strings (UTC slice — для старых клиентов на UTC midnight).
    return {
      fromDate: from.toISOString().slice(0, 10),
      toDateExclusive: to.toISOString().slice(0, 10),
      timezone: OZON_QUERY_TIMEZONE,
    };
  }
  return null;
}
