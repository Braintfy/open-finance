// PURPOSE: Клиент к Yandex Foundation Models (YandexGPT 5).
// API: https://llm.api.cloud.yandex.net/foundationModels/v1/completion
// Auth: Api-Key header + x-folder-id header.
// НЕ является OpenAI-compat — требует отдельный клиент.

type YandexGptMessage = {
  role: 'system' | 'user' | 'assistant';
  text: string;
};

type YandexGptConfig = {
  apiKey: string;
  folderId: string;
  /** Модель. Дефолт: yandexgpt (v5 lite), или yandexgpt/rc для preview */
  modelUri?: string;
  /** Дефолт: 0.7 */
  temperature?: number;
  /** Дефолт: 2000 */
  maxTokens?: number;
};

const YANDEX_GPT_BASE = 'https://llm.api.cloud.yandex.net';

/**
 * Streaming chat через Yandex Foundation Models.
 * Возвращает async generator с дельтами (Yandex не даёт SSE — используем completionStream).
 *
 * Примечание: Yandex Foundation Models поддерживает гибкий stream через
 * POST /foundationModels/v1/completionStream (аналог OpenAI streaming).
 */
export async function* streamYandexGpt(opts: {
  config: YandexGptConfig;
  messages: YandexGptMessage[];
  signal?: AbortSignal;
}): AsyncGenerator<{ delta: string; done: boolean }> {
  const { config, messages, signal } = opts;
  const folderId = config.folderId;
  const modelUri = config.modelUri ?? `gpt://${folderId}/yandexgpt/latest`;

  const body = {
    modelUri,
    completionOptions: {
      stream: true,
      temperature: config.temperature ?? 0.7,
      maxTokens: String(config.maxTokens ?? 2000),
    },
    messages: messages.map((m) => ({ role: m.role, text: m.text })),
  };

  const res = await fetch(`${YANDEX_GPT_BASE}/foundationModels/v1/completionStream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Api-Key ${config.apiKey}`,
      'x-folder-id': folderId,
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Yandex GPT error ${res.status}: ${text.slice(0, 300)}`);
  }

  if (!res.body) throw new Error('Yandex GPT: пустой body ответа');

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
        if (!trimmed || trimmed === 'data: [DONE]') continue;

        // Yandex возвращает JSON объекты построчно (NDJSON) или data: {...}
        const jsonStr = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;

        try {
          const parsed = JSON.parse(jsonStr) as {
            result?: {
              alternatives?: Array<{
                message?: { text?: string };
                status?: string;
              }>;
            };
          };

          const alt = parsed.result?.alternatives?.[0];
          if (!alt) continue;

          const text = alt.message?.text ?? '';
          const isDone = alt.status === 'ALTERNATIVE_STATUS_FINAL';

          if (text) yield { delta: text, done: false };
          if (isDone) {
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
 * Проверить подключение к Yandex GPT (получить список доступных моделей).
 */
export async function testYandexGptConnection(config: YandexGptConfig): Promise<{
  ok: boolean;
  error?: string;
}> {
  try {
    const res = await fetch(`${YANDEX_GPT_BASE}/foundationModels/v1/listFoundationModels`, {
      headers: {
        Authorization: `Api-Key ${config.apiKey}`,
        'x-folder-id': config.folderId,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}
