// PURPOSE: SSRF-безопасный фетч URL подписки VLESS. Вызывается ТОЛЬКО по кнопке
// суперадмина (никаких кронов/фоновых обновлений).
//
// Меры:
//  1. только https, без userinfo (user:pass@) в URL, без нестандартных портов кроме 443/8443/2053/2083/2087/2096;
//  2. DNS-резолв ДО подключения; каждый полученный адрес обязан быть публичным (ip-guard);
//  3. подключение пиннится на проверенный IP (custom lookup в undici Agent) — защита от DNS-rebinding;
//  4. таймаут 10с на весь запрос, ≤3 редиректа, каждый хоп валидируется заново;
//  5. жёсткий лимит тела 256KB (проверяем Content-Length и режем поток).

import dns from 'node:dns';
import { isIpLiteral, isPrivateIp } from './ip-guard';

export const SUBSCRIPTION_TIMEOUT_MS = 10_000;
export const SUBSCRIPTION_MAX_BYTES = 256 * 1024;
const MAX_REDIRECTS = 3;
/** Порты, на которых реально живут панели подписок. Всё остальное — подозрительно. */
const ALLOWED_PORTS = new Set([443, 8443, 2053, 2083, 2087, 2096]);

export class SubscriptionFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubscriptionFetchError';
  }
}

/** Валидация URL подписки без обращения к сети (используется и при сохранении). */
export function validateSubscriptionUrl(raw: string): URL {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) throw new SubscriptionFetchError('Пустой URL подписки');
  if (trimmed.length > 2000) throw new SubscriptionFetchError('URL подписки слишком длинный');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new SubscriptionFetchError('Некорректный URL подписки');
  }

  if (url.protocol !== 'https:') {
    throw new SubscriptionFetchError('Разрешён только https:// (http/ftp/file запрещены)');
  }
  if (url.username || url.password) {
    throw new SubscriptionFetchError('URL с логином/паролем (user:pass@) не поддерживается');
  }
  const port = url.port ? Number.parseInt(url.port, 10) : 443;
  if (!ALLOWED_PORTS.has(port)) {
    throw new SubscriptionFetchError(
      `Порт ${port} не разрешён. Допустимы: ${[...ALLOWED_PORTS].join(', ')}`,
    );
  }
  if (isIpLiteral(url.hostname) && isPrivateIp(url.hostname)) {
    throw new SubscriptionFetchError('Адрес подписки указывает в приватную сеть');
  }
  return url;
}

/**
 * Резолвим хост и проверяем КАЖДЫЙ адрес. Возвращаем первый публичный —
 * именно на него потом пиннится соединение.
 */
async function resolveSafeAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const host = hostname.replace(/^\[|\]$/g, '');

  if (isIpLiteral(host)) {
    if (isPrivateIp(host)) {
      throw new SubscriptionFetchError('Адрес подписки указывает в приватную сеть');
    }
    return { address: host, family: host.includes(':') ? 6 : 4 };
  }

  let records: dns.LookupAddress[];
  try {
    records = await dns.promises.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SubscriptionFetchError(`Не удалось разрешить имя ${host}`);
  }
  if (records.length === 0) {
    throw new SubscriptionFetchError(`DNS не вернул адресов для ${host}`);
  }
  // Достаточно одного приватного адреса в ответе, чтобы отказать — это либо
  // split-horizon DNS, либо попытка увести запрос внутрь периметра.
  const bad = records.find((r) => isPrivateIp(r.address));
  if (bad) {
    throw new SubscriptionFetchError(
      `Хост ${host} резолвится в приватный адрес (${bad.address}) — запрос заблокирован`,
    );
  }
  const first = records[0]!;
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}

/** Динамический импорт undici (как в providers/proxy.ts — не падать без пакета). */
async function loadUndici(): Promise<Record<string, unknown> | null> {
  try {
    const importRuntime = new Function('specifier', 'return import(specifier)') as (
      s: string,
    ) => Promise<unknown>;
    return (await importRuntime('undici')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export type SubscriptionFetchResult = {
  text: string;
  bytes: number;
  /** Финальный URL после редиректов (замаскированный вызывающим кодом). */
  finalUrl: string;
  redirects: number;
};

/**
 * Скачать содержимое подписки с полным набором SSRF-мер.
 * Возвращает сырой текст (base64-блоб или plain-список) — разбирает parseSubscription().
 */
export async function fetchSubscription(rawUrl: string): Promise<SubscriptionFetchResult> {
  const undici = await loadUndici();
  const started = Date.now();

  let current = validateSubscriptionUrl(rawUrl);
  let redirects = 0;

  for (;;) {
    const remainingMs = SUBSCRIPTION_TIMEOUT_MS - (Date.now() - started);
    if (remainingMs <= 0) throw new SubscriptionFetchError('Таймаут 10с при загрузке подписки');

    const pinned = await resolveSafeAddress(current.hostname);
    const response = await requestOnce(current, pinned, remainingMs, undici);

    if (response.status >= 300 && response.status < 400 && response.location) {
      if (redirects >= MAX_REDIRECTS) {
        throw new SubscriptionFetchError('Слишком много редиректов (>3)');
      }
      redirects += 1;
      let next: URL;
      try {
        next = new URL(response.location, current);
      } catch {
        throw new SubscriptionFetchError('Некорректный Location в редиректе');
      }
      current = validateSubscriptionUrl(next.toString());
      continue;
    }

    if (response.status !== 200) {
      throw new SubscriptionFetchError(`Подписка ответила HTTP ${response.status}`);
    }
    if (!response.text.trim()) {
      throw new SubscriptionFetchError('Подписка вернула пустой ответ');
    }

    return {
      text: response.text,
      bytes: response.bytes,
      finalUrl: current.toString(),
      redirects,
    };
  }
}

type RawResponse = { status: number; location?: string; text: string; bytes: number };

async function requestOnce(
  url: URL,
  pinned: { address: string; family: 4 | 6 },
  timeoutMs: number,
  undici: Record<string, unknown> | null,
): Promise<RawResponse> {
  const headers = {
    'user-agent': 'OpenFinance-VPN-Admin/1.0',
    accept: 'text/plain, */*',
  };

  if (undici) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { Agent, request } = undici as any;
    const agent = new Agent({
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
      connect: {
        timeout: timeoutMs,
        // Пиннинг на проверенный адрес: DNS-rebinding между проверкой и коннектом невозможен.
        lookup: (
          _hostname: string,
          _options: unknown,
          cb: (err: Error | null, address: string, family: number) => void,
        ) => cb(null, pinned.address, pinned.family),
      },
    });

    try {
      const res = await request(url.toString(), {
        method: 'GET',
        headers,
        maxRedirections: 0, // редиректы обрабатываем сами, с повторной валидацией
        signal: AbortSignal.timeout(timeoutMs),
        dispatcher: agent,
      });

      const status: number = res.statusCode;
      const location = firstHeader(res.headers, 'location');
      const declared = Number.parseInt(firstHeader(res.headers, 'content-length') ?? '', 10);
      if (Number.isFinite(declared) && declared > SUBSCRIPTION_MAX_BYTES) {
        res.body?.destroy?.();
        throw new SubscriptionFetchError('Подписка больше 256KB — отказ');
      }

      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of res.body) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buf.length;
        if (bytes > SUBSCRIPTION_MAX_BYTES) {
          res.body.destroy();
          throw new SubscriptionFetchError('Подписка больше 256KB — отказ');
        }
        chunks.push(buf);
      }

      return { status, location, text: Buffer.concat(chunks).toString('utf8'), bytes };
    } catch (e) {
      if (e instanceof SubscriptionFetchError) throw e;
      throw new SubscriptionFetchError(describeNetworkError(e));
    } finally {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (agent as any).close?.();
      } catch {
        /* агент всё равно одноразовый */
      }
    }
  }

  // Fail-closed: без undici нет ни пиннинга на проверенный IP (голый fetch резолвит
  // имя заново — окно для DNS-rebinding между проверкой и коннектом), ни потокового
  // лимита тела. undici — твёрдая зависимость репо (package.json), поэтому сюда
  // попадаем только при поломанной установке, и правильный ответ — отказ, а не
  // ослабленный запрос.
  throw new SubscriptionFetchError(
    'Проверка подписки требует пакет undici (не установлен) — запрос отклонён',
  );
}

function firstHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const v = headers?.[name] ?? headers?.[name.toLowerCase()];
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : undefined;
  return typeof v === 'string' ? v : undefined;
}

function describeNetworkError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/timeout|aborted|TimeoutError/i.test(msg)) return 'Таймаут 10с при загрузке подписки';
  return `Не удалось загрузить подписку: ${msg}`;
}
