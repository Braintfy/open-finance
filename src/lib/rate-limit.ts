// PURPOSE: Простой fixed-window rate-limiter поверх RedisLike (src/lib/redis.ts).
// Работает на in-memory shim сейчас и на ioredis после Phase 2 (тот же интерфейс).
// Security-throttle: защита /api/auth/* (брутфорс) и /api/ai/* (раздувание счёта).
//
// Замечание: get→set не атомарны. Для одно-процессного in-memory это ок; при
// переходе на ioredis заменить на атомарный INCR+EXPIRE в getRedis() или здесь.

import { NextResponse } from 'next/server';
import { getRedis } from './redis';

export type RateLimitResult = {
  /** true = запрос разрешён, false = лимит превышен. */
  ok: boolean;
  remaining: number;
  limit: number;
  /** Секунд до сброса текущего окна (для заголовка Retry-After). */
  retryAfterSec: number;
};

/**
 * Fixed-window счётчик. Ключ окна = `rl:{key}:{windowIndex}`.
 * @param key уникальный идентификатор бакета (например `auth:login:ip:1.2.3.4`)
 * @param limit максимум обращений за окно
 * @param windowSec размер окна в секундах
 */
export async function rateLimit(opts: {
  key: string;
  limit: number;
  windowSec: number;
}): Promise<RateLimitResult> {
  const { key, limit, windowSec } = opts;
  const redis = getRedis();
  const now = Date.now();
  const windowMs = windowSec * 1000;
  const windowIndex = Math.floor(now / windowMs);
  const bucketKey = `rl:${key}:${windowIndex}`;
  const windowEndMs = (windowIndex + 1) * windowMs;
  const retryAfterSec = Math.max(1, Math.ceil((windowEndMs - now) / 1000));

  const raw = await redis.get(bucketKey);
  const count = raw ? Number.parseInt(raw, 10) || 0 : 0;

  if (count >= limit) {
    return { ok: false, remaining: 0, limit, retryAfterSec };
  }

  // TTL = остаток окна, чтобы ключ умер на границе окна.
  await redis.set(bucketKey, String(count + 1), 'EX', retryAfterSec);
  return { ok: true, remaining: Math.max(0, limit - (count + 1)), limit, retryAfterSec };
}

/** Достаёт клиентский IP из заголовков прокси. */
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip')?.trim() || 'unknown';
}

/** Стандартный 429-ответ с Retry-After. */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  return NextResponse.json(
    { ok: false, error: 'Слишком много запросов. Попробуйте позже.' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } },
  );
}
