// PURPOSE: On-demand слой для Performance API.
// Используется когда блокам аналитики нужны данные за СЕГОДНЯ (которые
// ещё не попали в sync-стейдж — он гонится раз в сутки).
//
// Стратегия:
//   1. Период полностью «исторический» (to < сегодня) → берём только из БД.
//   2. Период включает сегодня → исторические дни из БД + сегодняшние из
//      Performance API через mergeHistoricalAndOnDemand.
//   3. Сегодняшние данные кэшируются в Redis на 10 минут (perf:ondemand:{acc}:{date}).
//
// Pure-функции (без Performance API вызовов) тестируются отдельно.

import { getRedis } from '@/lib/redis';

const CACHE_TTL_SEC = 10 * 60;

/**
 * Per-SKU агрегат за один день (используется и в БД-данных, и в on-demand).
 */
export type PerfSkuDayAggregate = {
  sku: string;
  views: number;
  clicks: number;
  cartAdds: number;
  orders: number;
  ordersKopecks: number;
  expenseKopecks: number;
};

/**
 * Возвращает ISO-дату (YYYY-MM-DD) без времени, в Europe/Moscow.
 * MSC ≈ UTC+3 фиксированно (стабильно, без перехода зимнее время — РФ).
 */
export function todayInMoscow(now: Date = new Date()): string {
  const msc = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return msc.toISOString().slice(0, 10);
}

/**
 * Содержит ли период «сегодня».
 */
export function periodIncludesToday(period: { from: Date; to: Date }, now: Date = new Date()): boolean {
  const today = todayInMoscow(now);
  // Сравниваем как строки YYYY-MM-DD (лексикографически = хронологически).
  const fromStr = period.from.toISOString().slice(0, 10);
  const toStr = period.to.toISOString().slice(0, 10);
  return fromStr <= today && today <= toStr;
}

/**
 * Сливает исторические записи (по БД) и on-demand агрегат за сегодня.
 * Если sku есть и в historical, и в today — берём today (он свежее).
 * Pure-функция, без побочных эффектов.
 */
export function mergeHistoricalAndOnDemand(
  historical: PerfSkuDayAggregate[],
  today: PerfSkuDayAggregate[],
): PerfSkuDayAggregate[] {
  const byKey = new Map<string, PerfSkuDayAggregate>();
  for (const h of historical) {
    if (!h.sku) continue;
    byKey.set(h.sku, h);
  }
  for (const t of today) {
    if (!t.sku) continue;
    const existing = byKey.get(t.sku);
    if (existing) {
      // Сегодняшний — это дополнительный день, надо суммировать.
      byKey.set(t.sku, {
        sku: t.sku,
        views: existing.views + t.views,
        clicks: existing.clicks + t.clicks,
        cartAdds: existing.cartAdds + t.cartAdds,
        orders: existing.orders + t.orders,
        ordersKopecks: existing.ordersKopecks + t.ordersKopecks,
        expenseKopecks: existing.expenseKopecks + t.expenseKopecks,
      });
    } else {
      byKey.set(t.sku, t);
    }
  }
  return Array.from(byKey.values());
}

/**
 * Cache key для on-demand агрегата.
 */
function cacheKey(accountId: string, date: string): string {
  return `perf:ondemand:${accountId}:${date}`;
}

/**
 * Получить агрегат за день из cache.
 * Возвращает null если кэша нет или невалиден.
 */
export async function getCachedOnDemand(
  accountId: string,
  date: string,
): Promise<PerfSkuDayAggregate[] | null> {
  try {
    const redis = getRedis();
    const raw = await redis.get(cacheKey(accountId, date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PerfSkuDayAggregate[];
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setCachedOnDemand(
  accountId: string,
  date: string,
  data: PerfSkuDayAggregate[],
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(cacheKey(accountId, date), JSON.stringify(data), 'EX', CACHE_TTL_SEC);
  } catch {
    // ignore
  }
}
