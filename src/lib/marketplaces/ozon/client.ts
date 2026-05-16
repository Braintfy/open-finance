// PURPOSE: HTTP-клиент Ozon Seller API.
// - Нативный fetch с таймаутом 30s
// - Заголовки Client-Id / Api-Key
// - Token-bucket rate-limit 40 RPS per Client-Id (Ozon allow 50 RPS, держим запас)
// - Exponential backoff на 429/5xx (max 3 retry)
// - Никогда не логируем api_key

import type { ZodSchema } from 'zod';

const BASE_URL = 'https://api-seller.ozon.ru';
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

/**
 * Per-clientId token-bucket. Живёт в памяти Node-процесса. При горизонтальном
 * масштабе мигрировать в Redis. См. CHANGELOG/MEMORY граблю «rate-limit
 * in-memory» (currency v0.16.0 уже это упоминает).
 */
const RATE_LIMITERS = new Map<string, RateLimiter>();

class RateLimiter {
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private tokens: number;
  private lastRefill: number;

  constructor(capacity = 40, refillPerSec = 40) {
    this.capacity = capacity;
    this.refillPerMs = refillPerSec / 1000;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
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

function getLimiter(clientId: string): RateLimiter {
  const existing = RATE_LIMITERS.get(clientId);
  if (existing) return existing;
  const limiter = new RateLimiter();
  RATE_LIMITERS.set(clientId, limiter);
  return limiter;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type OzonCredentials = {
  clientId: string;
  apiKey: string;
};

export class OzonApiError extends Error {
  readonly status: number;
  readonly path: string;
  readonly body?: unknown;
  constructor(message: string, status: number, path: string, body?: unknown) {
    super(message);
    this.name = 'OzonApiError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

export class OzonClient {
  private readonly creds: OzonCredentials;

  constructor(creds: OzonCredentials) {
    this.creds = creds;
  }

  /**
   * Низкоуровневый POST-вызов. Возвращает распарсенный JSON.
   * Прогоняет через Zod если schema передана.
   */
  async post<T>(
    path: string,
    body: unknown,
    schema?: ZodSchema<T>,
    options?: { timeoutMs?: number; retry?: number },
  ): Promise<T> {
    const limiter = getLimiter(this.creds.clientId);
    let attempt = 0;
    let lastError: unknown = null;
    const maxRetry = options?.retry ?? MAX_RETRIES;

    while (attempt <= maxRetry) {
      await limiter.acquire();
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        options?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );
      try {
        const res = await fetch(`${BASE_URL}${path}`, {
          method: 'POST',
          headers: {
            'Client-Id': this.creds.clientId,
            'Api-Key': this.creds.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body ?? {}),
          signal: controller.signal,
        });

        if (res.status === 429 || res.status >= 500) {
          const text = await res.text().catch(() => '');
          if (attempt < maxRetry) {
            await sleep(backoffMs(attempt));
            attempt += 1;
            continue;
          }
          throw new OzonApiError(
            `Ozon ${res.status} on ${path}: ${text.slice(0, 200)}`,
            res.status,
            path,
            text,
          );
        }

        const json = (await res.json().catch(() => null)) as unknown;
        if (!res.ok) {
          throw new OzonApiError(
            `Ozon ${res.status} on ${path}: ${describeError(json)}`,
            res.status,
            path,
            json,
          );
        }

        if (!schema) return json as T;
        const parsed = schema.safeParse(json);
        if (!parsed.success) {
          throw new OzonApiError(
            `Ozon ${path}: ответ не прошёл валидацию (${parsed.error.issues
              .map((i) => i.path.join('.') + ': ' + i.message)
              .slice(0, 3)
              .join('; ')})`,
            res.status,
            path,
            json,
          );
        }
        return parsed.data;
      } catch (e) {
        lastError = e;
        // Сетевые ошибки (AbortError, fetch failed) — тоже ретраим.
        if (
          attempt < maxRetry &&
          !(e instanceof OzonApiError && e.status !== 0 && e.status < 500 && e.status !== 429)
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
    throw lastError ?? new Error(`Ozon ${path}: exhausted retries`);
  }
}

function backoffMs(attempt: number): number {
  // 0 → 500ms, 1 → 1500ms, 2 → 4000ms (плюс джиттер 0..200ms)
  const base = [500, 1500, 4000][attempt] ?? 8000;
  return base + Math.floor(Math.random() * 200);
}

function describeError(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'unknown';
  const p = payload as Record<string, unknown>;
  if (typeof p.message === 'string') return p.message;
  if (typeof p.code === 'string') return p.code;
  return JSON.stringify(payload).slice(0, 200);
}
