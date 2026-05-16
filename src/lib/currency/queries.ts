// PURPOSE: CRUD/refresh курсов валют. Чтения из БД, lazy-refresh, bulk upsert.
import { desc, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { currencyRates } from '@/lib/db/schema/currency';
import { fetchCbrDaily } from './sources/cbr';
import {
  CURRENCY_STALENESS_WINDOW_MS,
  type CurrencyRate,
  type CurrencyStaleness,
} from './types';

function rowToRate(row: typeof currencyRates.$inferSelect): CurrencyRate {
  return {
    code: row.code,
    nominal: row.nominal,
    name: row.name,
    rateRub: Number(row.rateRub),
    previousRub: row.previousRub === null ? null : Number(row.previousRub),
    source: row.source,
    sourceDate: row.sourceDate.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Возвращает текущие курсы из БД. Если `codes` указан — только эти коды.
 * Сортировка по коду, чтобы порядок был стабильным для UI.
 */
export async function getCurrencyRates(codes?: string[]): Promise<CurrencyRate[]> {
  const upperCodes = codes?.map((c) => c.toUpperCase()).filter(Boolean);
  const query =
    upperCodes && upperCodes.length > 0
      ? db.select().from(currencyRates).where(inArray(currencyRates.code, upperCodes))
      : db.select().from(currencyRates);
  const rows = await query;
  return rows.map(rowToRate).sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Возраст самого свежего snapshot'а в БД. Используется для lazy-refresh
 * на стороне `GET /api/currency/rates`.
 */
export async function getStaleness(): Promise<CurrencyStaleness> {
  const rows = await db
    .select({ updatedAt: currencyRates.updatedAt })
    .from(currencyRates)
    .orderBy(desc(currencyRates.updatedAt))
    .limit(1);
  if (rows.length === 0) {
    return { ageMs: Number.POSITIVE_INFINITY, isStale: true, lastUpdatedAt: null };
  }
  const last = rows[0].updatedAt;
  const ageMs = Date.now() - last.getTime();
  return {
    ageMs,
    isStale: ageMs >= CURRENCY_STALENESS_WINDOW_MS,
    lastUpdatedAt: last.toISOString(),
  };
}

/**
 * Тянет свежие курсы у ЦБ и делает bulk upsert. Возвращает обновлённый список.
 * При ошибке fetch пробрасывает её — caller должен решить, отдавать ли cached.
 */
export async function refreshCurrencyRates(): Promise<CurrencyRate[]> {
  const rates = await fetchCbrDaily();
  if (rates.length === 0) {
    throw new Error('CBR вернул пустой список валют');
  }
  await db
    .insert(currencyRates)
    .values(
      rates.map((r) => ({
        code: r.code,
        nominal: r.nominal,
        name: r.name,
        rateRub: r.rateRub.toFixed(6),
        previousRub: r.previousRub !== null ? r.previousRub.toFixed(6) : null,
        source: r.source,
        sourceDate: new Date(r.sourceDate),
        updatedAt: new Date(r.updatedAt),
      })),
    )
    .onConflictDoUpdate({
      target: currencyRates.code,
      set: {
        nominal: sql`excluded.nominal`,
        name: sql`excluded.name`,
        rateRub: sql`excluded.rate_rub`,
        previousRub: sql`excluded.previous_rub`,
        source: sql`excluded.source`,
        sourceDate: sql`excluded.source_date`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
  return getCurrencyRates();
}
