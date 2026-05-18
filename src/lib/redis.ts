// PURPOSE: Минимальная Redis-абстракция. По умолчанию — in-memory заглушка
// (для dev и SaaS Phase 1). В Phase 2 (горизонтальный масштаб) подключить
// настоящий ioredis: `pnpm add ioredis` и заменить implementation в этом
// файле — все потребители (perf-token-cache, on-demand analytics-cache,
// rate-limiter) работают через одинаковый интерфейс `RedisLike`.

export interface RedisLike {
  get(key: string): Promise<string | null>;
  /** EX = seconds. Совместимо с ioredis сигнатурой. */
  set(key: string, value: string, mode?: 'EX', ttlSec?: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

class InMemoryRedis implements RedisLike {
  private store = new Map<string, { value: string; expiresAt: number | null }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(
    key: string,
    value: string,
    mode?: 'EX',
    ttlSec?: number,
  ): Promise<unknown> {
    const expiresAt = mode === 'EX' && ttlSec ? Date.now() + ttlSec * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async del(key: string): Promise<unknown> {
    return this.store.delete(key) ? 1 : 0;
  }
}

let _client: RedisLike | null = null;

/**
 * Возвращает Redis-клиента (или in-memory shim).
 * Никогда не бросает — если Redis недоступен, отдаёт in-memory map.
 */
export function getRedis(): RedisLike {
  if (_client) return _client;
  // TODO: когда подключим ioredis, тут будет проверка REDIS_URL и инициализация.
  // Пока in-memory достаточно для одного-процессного SaaS.
  _client = new InMemoryRedis();
  return _client;
}
