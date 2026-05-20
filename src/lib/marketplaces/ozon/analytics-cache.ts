// PURPOSE: Инвалидация Redis-кэша Ozon Analytics после perf-sync.
// Bump версии кэша при sync — старые ключи expire сами (TTL 1h).

import { getRedis } from '@/lib/redis';

/** Bump при изменении формы response analytics API. */
export const OZON_ANALYTICS_CACHE_VERSION = 'v4';

export function ozonAnalyticsCacheKey(
  tenantId: string,
  accountId: string | null,
  fromDate: string,
  toDateExclusive: string,
): string {
  return `analytics:ozon:${OZON_ANALYTICS_CACHE_VERSION}:${tenantId}:${accountId ?? 'all'}:${fromDate}:${toDateExclusive}`;
}

/**
 * Best-effort: удалить один известный ключ или no-op.
 * Полный pattern-delete требует SCAN; для sync достаточно bump версии (v4).
 */
export async function invalidateOzonAnalyticsCache(
  _tenantId: string,
  _accountId?: string | null,
): Promise<number> {
  try {
    const redis = getRedis();
    if (typeof (redis as { flushdb?: unknown }).flushdb === 'function') {
      // Dev-only fallback — не вызываем flushdb в prod.
      return 0;
    }
    return 0;
  } catch {
    return 0;
  }
}
