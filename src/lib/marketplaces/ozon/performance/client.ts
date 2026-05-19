// PURPOSE: HTTP-клиент Ozon Performance API.
// - OAuth client_credentials, токен кэшируется в Redis (fallback в memory).
// - Bearer-авторизация для всех запросов.
// - Token-bucket rate-limit на per-clientId (10 RPS — консервативно).
// - Lenient Zod валидация по умолчанию.
// - Никогда не логируем client_secret.

import type { ZodSchema } from 'zod';

const BASE_URL = 'https://api-performance.ozon.ru';
const TOKEN_PATH = '/api/client/token';
const DEFAULT_TIMEOUT_MS = 60_000; // некоторые отчётные endpoints отдают долго
const MAX_RETRIES = 3;
const TOKEN_TTL_SAFETY_SEC = 60; // выписываем за минуту до истечения

// In-memory fallback токенов (когда Redis недоступен / dev-окружение).
const TOKEN_MEMORY = new Map<string, { token: string; expiresAt: number }>();

// In-memory token-bucket аналогично OzonClient.
const RATE_LIMITERS = new Map<string, PerfRateLimiter>();
const LIMITER_TTL_MS = 60 * 60 * 1000;

class PerfRateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private tokens: number;
  private lastRefill: number;
  lastUsedAt: number;

  constructor(capacity = 10, refillPerSec = 10) {
    this.capacity = capacity;
    this.refillPerMs = refillPerSec / 1000;
    this.tokens = capacity;
    this.lastRefill = Date.now();
    this.lastUsedAt = Date.now();
  }

  async acquire(): Promise<void> {
    this.lastUsedAt = Date.now();
    while (true) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.max(10, Math.ceil((1 - this.tokens) / this.refillPerMs));
      await sleep(waitMs);
    }
  }

  private refill() {
    const now = Date.now();
    const delta = (now - this.lastRefill) * this.refillPerMs;
    if (delta > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + delta);
      this.lastRefill = now;
    }
  }
}

function cleanupLimiters() {
  const now = Date.now();
  for (const [key, limiter] of RATE_LIMITERS) {
    if (now - limiter.lastUsedAt > LIMITER_TTL_MS) RATE_LIMITERS.delete(key);
  }
}

function getLimiter(clientId: string): PerfRateLimiter {
  const existing = RATE_LIMITERS.get(clientId);
  if (existing) return existing;
  if (RATE_LIMITERS.size > 0 && RATE_LIMITERS.size % 8 === 0) cleanupLimiters();
  const limiter = new PerfRateLimiter();
  RATE_LIMITERS.set(clientId, limiter);
  return limiter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type OzonPerfCredentials = {
  /** Уникальный идентификатор аккаунта в нашей БД — для кэш-ключей. */
  accountId: string;
  clientId: string;
  clientSecret: string;
};

export class OzonPerfApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body?: unknown;
  constructor(message: string, status: number, path: string, body?: unknown) {
    super(message);
    this.name = 'OzonPerfApiError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

/**
 * Парсит ответ OAuth /api/client/token. Pure-функция, тестируется отдельно.
 */
export function parseTokenResponse(payload: unknown): {
  token: string;
  expiresInSec: number;
} {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Performance API: пустой ответ токена');
  }
  const p = payload as Record<string, unknown>;
  const token = typeof p.access_token === 'string' ? p.access_token : null;
  const expires =
    typeof p.expires_in === 'number'
      ? p.expires_in
      : typeof p.expires_in === 'string'
        ? Number(p.expires_in)
        : NaN;
  if (!token) throw new Error('Performance API: access_token отсутствует');
  if (!Number.isFinite(expires) || expires <= 0)
    throw new Error('Performance API: некорректный expires_in');
  return { token, expiresInSec: expires };
}

/**
 * Рассчитывает Redis-TTL для токена с учётом запаса:
 *   actualTtl = expiresIn - TOKEN_TTL_SAFETY_SEC
 * Никогда не <= 0 (как минимум 30 секунд — иначе нет смысла кэшировать).
 */
export function calcTokenTtl(expiresInSec: number): number {
  const ttl = expiresInSec - TOKEN_TTL_SAFETY_SEC;
  return Math.max(30, ttl);
}

export class OzonPerformanceClient {
  private readonly creds: OzonPerfCredentials;

  constructor(creds: OzonPerfCredentials) {
    this.creds = creds;
  }

  /**
   * Получить access_token из кэша или взять свежий через client_credentials.
   * Redis — основной кэш; in-memory — fallback.
   */
  async getAccessToken(): Promise<string> {
    const cacheKey = `perf:token:${this.creds.accountId}`;
    const now = Date.now();

    // 1. Redis-like кэш (см. src/lib/redis.ts; пока in-memory shim).
    try {
      const { getRedis } = await import('@/lib/redis');
      const redis = getRedis();
      const cached = await redis.get(cacheKey);
      if (cached) return cached;
    } catch {
      // Cache недоступен — fallback на локальный Map.
    }

    // 2. Доп-fallback на локальный Map модуля.
    const mem = TOKEN_MEMORY.get(cacheKey);
    if (mem && mem.expiresAt > now + TOKEN_TTL_SAFETY_SEC * 1000) {
      return mem.token;
    }

    // 3. Запрашиваем свежий.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const res = await fetch(`${BASE_URL}${TOKEN_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: this.creds.clientId,
          client_secret: this.creds.clientSecret,
          grant_type: 'client_credentials',
        }),
        signal: controller.signal,
      });
      const json = (await res.json().catch(() => null)) as unknown;
      if (!res.ok) {
        // Не логируем сам секрет, но статус + summary полезно.
        throw new OzonPerfApiError(
          `Performance API token: HTTP ${res.status}`,
          res.status,
          TOKEN_PATH,
          json,
        );
      }
      const { token, expiresInSec } = parseTokenResponse(json);
      const ttl = calcTokenTtl(expiresInSec);

      // Кэшируем.
      try {
        const { getRedis } = await import('@/lib/redis');
        const redis = getRedis();
        await redis.set(cacheKey, token, 'EX', ttl);
      } catch {
        // ignore: упадём только на in-memory map
      }
      TOKEN_MEMORY.set(cacheKey, { token, expiresAt: now + ttl * 1000 });
      return token;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Низкоуровневый GET-запрос к Performance API. Bearer-авторизация.
   * Lenient валидация (warning + raw).
   */
  async post<T>(
    path: string,
    body: unknown,
    schema?: ZodSchema<T>,
    options?: { timeoutMs?: number; retry?: number; strict?: boolean },
  ): Promise<T> {
    return this.request<T>('POST', path, undefined, body, schema, options);
  }

  /**
   * Низкоуровневый GET-запрос к Performance API. Bearer-авторизация.
   * Lenient валидация (warning + raw).
   */
  async get<T>(
    path: string,
    query?: Record<string, string | number | undefined | null>,
    schema?: ZodSchema<T>,
    options?: { timeoutMs?: number; retry?: number; strict?: boolean; binary?: boolean },
  ): Promise<T> {
    return this.request<T>('GET', path, query, undefined, schema, options);
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    query?: Record<string, string | number | undefined | null>,
    body?: unknown,
    schema?: ZodSchema<T>,
    options?: { timeoutMs?: number; retry?: number; strict?: boolean; binary?: boolean },
  ): Promise<T> {
    const limiter = getLimiter(this.creds.clientId);
    let attempt = 0;
    let lastError: unknown = null;
    const maxRetry = options?.retry ?? MAX_RETRIES;

    let url = `${BASE_URL}${path}`;
    if (query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        params.set(k, String(v));
      }
      const q = params.toString();
      if (q) url += `?${q}`;
    }

    while (attempt <= maxRetry) {
      await limiter.acquire();
      const token = await this.getAccessToken();
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
          Accept: options?.binary ? 'text/csv, application/octet-stream' : 'application/json',
        };
        if (method === 'POST' && body !== undefined) {
          headers['Content-Type'] = 'application/json';
        }
        const res = await fetch(url, {
          method,
          headers,
          body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        if (res.status === 429 || res.status >= 500) {
          const text = await res.text().catch(() => '');
          if (attempt < maxRetry) {
            await sleep(backoffMs(attempt));
            attempt += 1;
            continue;
          }
          throw new OzonPerfApiError(
            `Ozon Perf ${res.status} on ${path}: ${text.slice(0, 200)}`,
            res.status,
            path,
            text,
          );
        }

        if (options?.binary) {
          // CSV / отчёты: возвращаем текст как есть.
          const text = await res.text();
          if (!res.ok) {
            throw new OzonPerfApiError(
              `Ozon Perf ${res.status} on ${path}: ${text.slice(0, 200)}`,
              res.status,
              path,
              text,
            );
          }
          return text as unknown as T;
        }

        const json = (await res.json().catch(() => null)) as unknown;
        if (!res.ok) {
          throw new OzonPerfApiError(
            `Ozon Perf ${res.status} on ${path}: ${describeError(json)}`,
            res.status,
            path,
            json,
          );
        }
        if (!schema) return json as T;
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          const summary = parsed.error.issues
            .map((i) => i.path.join('.') + ': ' + i.message)
            .slice(0, 3)
            .join('; ');
          if (options?.strict) {
            throw new OzonPerfApiError(
              `Ozon Perf ${path}: ответ не прошёл валидацию (${summary})`,
              res.status,
              path,
              json,
            );
          }
          console.warn(`[ozon-perf] schema mismatch on ${path}: ${summary}`);
          return json as T;
        }
        return parsed.data;
      } catch (e) {
        lastError = e;
        if (
          attempt < maxRetry &&
          !(
            e instanceof OzonPerfApiError &&
            e.status !== 0 &&
            e.status < 500 &&
            e.status !== 429
          )
        ) {
          await sleep(backoffMs(attempt));
          attempt += 1;
          continue;
        }
        throw e;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastError ?? new Error(`Ozon Perf ${path}: exhausted retries`);
  }
}

function backoffMs(attempt: number): number {
  const base = [500, 1500, 4000][attempt] ?? 8000;
  return base + Math.floor(Math.random() * 200);
}

function describeError(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'unknown';
  const p = payload as Record<string, unknown>;
  if (typeof p.message === 'string') return p.message;
  if (typeof p.code === 'string') return p.code;
  if (typeof p.error === 'string') return p.error;
  return JSON.stringify(payload).slice(0, 200);
}
