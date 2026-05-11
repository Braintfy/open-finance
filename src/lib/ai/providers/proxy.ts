// PURPOSE: HTTP/SOCKS5 proxy support для запросов к внешним AI API (OpenAI, Anthropic, etc).
// Использует undici ProxyAgent (через dynamic import, чтобы не падать если undici не установлен).
// Активен только когда tenant.aiProxy.enabled=true.

import type { TenantSettings } from '@/lib/db/schema/tenants';

export type ProxyConfig = NonNullable<TenantSettings['aiProxy']>;

/** Dispatcher тип из undici — заменён any чтобы не требовать types/undici. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Dispatcher = any;

/**
 * Сборка proxy URL с auth-credentials, если они заданы отдельно.
 * Пример: { url: 'http://example.com:3128', username: 'u', password: 'p' }
 *      → 'http://u:p@example.com:3128'
 */
export function buildProxyUrl(config: ProxyConfig): string {
  let { url } = config;
  if (!url) return '';

  // Если url уже содержит auth — оставляем как есть
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return url;
  } catch {
    // некорректный URL — возвращаем как есть, undici отреагирует
    return url;
  }

  if (config.username || config.password) {
    try {
      const parsed = new URL(url);
      parsed.username = config.username ?? '';
      parsed.password = config.password ?? '';
      url = parsed.toString();
    } catch {
      // ignore
    }
  }
  return url;
}

/**
 * Создать dispatcher для fetch() с настройками прокси.
 * Возвращает undefined если прокси выключен или undici не установлен.
 *
 * Использование:
 *   const dispatcher = await createProxyDispatcher(tenant.settings.aiProxy);
 *   await fetch(url, dispatcher ? { dispatcher } : {});
 *
 * Note: SOCKS5 пока не поддерживается напрямую — используйте HTTP-обёртку.
 */
export async function createProxyDispatcher(
  config: ProxyConfig | undefined,
): Promise<Dispatcher | undefined> {
  if (!config?.enabled || !config.url) return undefined;

  const url = buildProxyUrl(config);
  if (!url) return undefined;

  if (config.type === 'socks5') {
    throw new Error('SOCKS5 пока не поддерживается. Используйте HTTP/HTTPS прокси (Squid, Tinyproxy).');
  }

  if (config.type === 'http' || config.type === 'https') {
    try {
      // Dynamic import чтобы не требовать undici как зависимость на этапе build
      // Next.js Node runtime содержит undici внутри, но не всегда экспортирует.
      // @ts-expect-error - undici опциональная зависимость
      const undici = await import('undici').catch(() => null);
      if (!undici) {
        throw new Error(
          'Пакет undici не установлен. Установите: pnpm add undici',
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { ProxyAgent } = undici as any;
      return new ProxyAgent(url);
    } catch (e) {
      if (e instanceof Error && e.message.includes('undici не установлен')) throw e;
      throw new Error(`Не удалось создать proxy dispatcher: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }

  return undefined;
}

/**
 * Получить внешний IP через прокси для диагностики.
 * Возвращает IP-адрес и информацию о геолокации.
 */
export async function getExternalIp(
  config?: ProxyConfig,
): Promise<{ ip: string; country?: string; city?: string; via: 'direct' | 'proxy' }> {
  const dispatcher = config ? await createProxyDispatcher(config) : undefined;
  const init: RequestInit = { signal: AbortSignal.timeout(5000) };
  if (dispatcher) {
    // @ts-expect-error - undici dispatcher param на Node.js fetch
    init.dispatcher = dispatcher;
  }
  const res = await fetch('https://ipinfo.io/json', init);
  if (!res.ok) throw new Error(`IP lookup failed: ${res.status}`);
  const data = (await res.json()) as { ip?: string; country?: string; city?: string };
  return {
    ip: data.ip ?? 'unknown',
    country: data.country,
    city: data.city,
    via: dispatcher ? 'proxy' : 'direct',
  };
}
