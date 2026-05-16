// PURPOSE: Snapshot последних курсов валют (общая таблица, не tenant-scoped).
// Источник по умолчанию — ЦБ РФ (cbr-xml-daily.ru). Хранятся курсы за 1 единицу
// валюты к рублю (Nominal уже нормализован при upsert через refresh).
import {
  pgTable,
  varchar,
  integer,
  text,
  numeric,
  timestamp,
} from 'drizzle-orm/pg-core';

export const currencyRates = pgTable('currency_rates', {
  /** ISO-4217 код валюты (USD, EUR, CNY, ...). Primary key — каждый код хранится один раз. */
  code: varchar('code', { length: 8 }).primaryKey(),
  /**
   * Номинал курса, как пришёл от источника (10 для KRW/JPY/IDR — для удобства поиска).
   * `rateRub` ВСЕГДА уже нормализован к 1 единице валюты, это поле — справочное.
   */
  nominal: integer('nominal').notNull().default(1),
  /** Человекочитаемое название (Доллар США, Китайский юань). */
  name: text('name').notNull(),
  /** Курс за 1 единицу валюты в рублях. */
  rateRub: numeric('rate_rub', { precision: 18, scale: 6 }).notNull(),
  /** Предыдущий курс (для расчёта Δ%); может быть null для свежего snapshot'а. */
  previousRub: numeric('previous_rub', { precision: 18, scale: 6 }),
  /** Идентификатор источника (`cbr`, `frankfurter`, ...). */
  source: text('source').notNull().default('cbr'),
  /** Дата актуальности курса с источника (например, дата ЦБ). */
  sourceDate: timestamp('source_date', { withTimezone: true }).notNull(),
  /** Когда snapshot был записан в нашу БД. */
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type CurrencyRateRow = typeof currencyRates.$inferSelect;
export type NewCurrencyRateRow = typeof currencyRates.$inferInsert;
