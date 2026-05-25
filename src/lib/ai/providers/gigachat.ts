// PURPOSE: Клиент к GigaChat API (Сбер).
// Auth: OAuth2 (client_credentials flow), scope: GIGACHAT_API_PERS.
// API: https://gigachat.devices.sberbank.ru/api/v1/chat/completions (SSE).
// НЕ является полным OpenAI-compat — требует OAuth2 token exchange перед вызовами.

type GigaChatConfig = {
  /** Client credentials: base64(client_id:client_secret) или полные данные */
  authKey: string;
  /** Скоуп авторизации. Дефолт: GIGACHAT_API_PERS */
  scope?: 'GIGACHAT_API_PERS' | 'GIGACHAT_API_B2B' | 'GIGACHAT_API_CORP';
  /** Модель. Дефолт: GigaChat-Max */
  model?: string;
};

type GigaChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

const GIGACHAT_AUTH_URL = 'https://ngw.devices.sberbank.ru:9443/api/v2/oauth';
const GIGACHAT_API_BASE = 'https://gigachat.devices.sberbank.ru/api/v1';

/** In-memory кэш access token (per authKey) */
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Получить или обновить OAuth2 access token GigaChat.
 * Token живёт ~30 минут, кэшируем с запасом.
 */
async function getAccessToken(config: GigaChatConfig): Promise<string> {
  const cacheKey = config.authKey;
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const scope = config.scope ?? 'GIGACHAT_API_PERS';

  const res = await fetch(GIGACHAT_AUTH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${config.authKey}`,
      RqUID: crypto.randomUUID(),
    },
    body: new URLSearchParams({ scope }),
    // GigaChat TLS требует принять самоподписанный cert в dev — в prod OK
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GigaChat auth error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_at: number; // unix ms
  };

  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: data.expires_at,
  });

  return data.access_token;
}

/**
 * Streaming chat через GigaChat API (SSE).
 */
export async function* streamGigaChat(opts: {
  config: GigaChatConfig;
  messages: GigaChatMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<{ delta: string; done: boolean }> {
  const { config, messages, signal } = opts;
  const token = await getAccessToken(config);
  const model = config.model ?? 'GigaChat-Max';

  const body = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: true,
    temperature: 0.7,
    max_tokens: 2048,
  };

  const res = await fetch(`${GIGACHAT_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GigaChat error ${res.status}: ${text.slice(0, 300)}`);
  }

  if (!res.body) throw new Error('GigaChat: пустой body ответа');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') {
          if (trimmed === 'data: [DONE]') {
            yield { delta: '', done: true };
            return;
          }
          continue;
        }

        if (!trimmed.startsWith('data: ')) continue;
        const jsonStr = trimmed.slice(6);

        try {
          const parsed = JSON.parse(jsonStr) as {
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string | null;
            }>;
          };

          const choice = parsed.choices?.[0];
          if (!choice) continue;

          const delta = choice.delta?.content ?? '';
          if (delta) yield { delta, done: false };

          if (choice.finish_reason === 'stop') {
            yield { delta: '', done: true };
            return;
          }
        } catch {
          // Пропускаем не-JSON строки
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  yield { delta: '', done: true };
}

/**
 * Проверить подключение — попытка получить access token.
 */
export async function testGigaChatConnection(config: GigaChatConfig): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    await getAccessToken(config);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}
