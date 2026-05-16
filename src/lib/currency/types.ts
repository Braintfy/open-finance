// PURPOSE: Доменные типы для модуля курсов валют.
export type CurrencyCode = string; // ISO-4217 (USD, EUR, ...)

/** Нормализованный курс: rateRub — это всегда «1 единица валюты в рублях». */
export type CurrencyRate = {
  code: CurrencyCode;
  /** Номинал, как пришёл от источника (10 для KRW/JPY/HUF) — справочно. */
  nominal: number;
  /** Человекочитаемое название (например, «Доллар США»). */
  name: string;
  /** Курс за 1 единицу валюты в рублях. */
  rateRub: number;
  /** Предыдущий курс в рублях (для расчёта Δ%). null — если неизвестен. */
  previousRub: number | null;
  /** Идентификатор источника: 'cbr', 'frankfurter', ... */
  source: string;
  /** Дата актуальности курса с источника, ISO-строка. */
  sourceDate: string;
  /** Когда snapshot был записан в нашу БД, ISO-строка. */
  updatedAt: string;
};

/** Метаданные о свежести snapshot'а в БД. */
export type CurrencyStaleness = {
  /** Возраст самого свежего snapshot'а в миллисекундах. Infinity — БД пуста. */
  ageMs: number;
  /** true — пора обновлять (>23h). */
  isStale: boolean;
  /** Время последнего snapshot'а ISO, либо null если БД пуста. */
  lastUpdatedAt: string | null;
};

/** Окно cвежести курсов — 23 часа (ЦБ обновляет раз в сутки в ~11:30 МСК). */
export const CURRENCY_STALENESS_WINDOW_MS = 23 * 60 * 60 * 1000;
