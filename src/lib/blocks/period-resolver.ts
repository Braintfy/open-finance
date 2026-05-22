// PURPOSE: SSR-safe period resolver — pure-функции для работы с пресетами
// периодов (today / yesterday / 7d / 14d / 30d / mtd / custom).
//
// Почему отдельный модуль (а не period-picker.tsx)?
//   `period-picker.tsx` помечен `'use client'` — Next.js 15+ запрещает
//   импортировать любые экспорты client-модуля из server route handlers.
//   Pure-функции вынесены сюда, чтобы их могли использовать и API routes
//   (server), и UI-пикер (client). period-picker.tsx ре-экспортирует их.
//
// Контракт:
//   • Все границы — календарные дни Europe/Moscow.
//   • `to` exclusive для SQL `< to` запросов.
//   • Нет React-импортов, нет браузерных API.

import {
  describeOzonQueryPeriod,
  getPreviousOzonQueryPeriod,
  ozonQueryPeriodToLegacyDates,
  resolveOzonQueryPeriod,
  type OzonPeriodPreset,
} from '@/lib/marketplaces/ozon/query-period';

export type PeriodPreset = OzonPeriodPreset;
export type Period = { from: Date; to: Date };
export type PeriodValue = {
  preset: PeriodPreset;
  /** Только при preset='custom' (ISO YYYY-MM-DD). */
  customFrom?: string | null;
  customTo?: string | null;
};

export type ResolvePeriodOptions = {
  now?: Date;
  /** Исключить сегодня (MSC) — для chart. */
  excludeToday?: boolean;
};

/**
 * Pure-функция: разрешить пресет в диапазон (legacy Date + MSC dates внутри).
 * Границы — календарные дни Europe/Moscow; `to` exclusive для SQL `<`.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  customFrom?: string | null,
  customTo?: string | null,
  nowOrOptions: Date | ResolvePeriodOptions = new Date(),
): Period {
  const options =
    nowOrOptions instanceof Date ? { now: nowOrOptions } : nowOrOptions;
  const msc = resolveOzonQueryPeriod(preset, customFrom, customTo, options);
  return ozonQueryPeriodToLegacyDates(msc);
}

/** MSC-период для API query params (`fromDate`, `toDateExclusive`). */
export function resolveOzonPeriod(
  preset: PeriodPreset,
  customFrom?: string | null,
  customTo?: string | null,
  options: ResolvePeriodOptions = {},
) {
  return resolveOzonQueryPeriod(preset, customFrom, customTo, options);
}

/**
 * Pure-функция: получить предыдущий период такой же длины (для «vs прошлый»).
 */
export function getPreviousPeriod(period: Period): Period {
  const fromDate = period.from.toISOString().slice(0, 10);
  const toDateExclusive = period.to.toISOString().slice(0, 10);
  const prev = getPreviousOzonQueryPeriod({
    fromDate,
    toDateExclusive,
    timezone: 'Europe/Moscow',
  });
  return ozonQueryPeriodToLegacyDates(prev);
}

/** Формирует короткое описание периода в MSC. */
export function describePeriod(period: Period): string {
  return describeOzonQueryPeriod({
    fromDate: period.from.toISOString().slice(0, 10),
    toDateExclusive: period.to.toISOString().slice(0, 10),
    timezone: 'Europe/Moscow',
  });
}

export { ozonPeriodToSearchParams } from '@/lib/marketplaces/ozon/query-period';
