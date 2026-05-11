// PURPOSE: Клиент к OpenAI-совместимому API (OpenAI, OpenRouter, VSEGPT, LiteLLM, custom).
// Поддерживает streaming (Server-Sent Events), proxy через undici dispatcher.

import type { TenantSettings } from '@/lib/db/schema/tenants';
import { createProxyDispatcher } from './proxy';

export type ExternalConfig = NonNullable<TenantSettings['aiExternal']>;
export type ProxyConfig = NonNullable<TenantSettings['aiProxy']>;

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** OpenAI vision: массив base64 строк или URL */
  images?: string[];
};

/**
 * Streaming chat completion через OpenAI-совместимый /v1/chat/completions endpoint.
 * Возвращает async generator с дельтами текста.
 */
export async function* streamOpenAICompat(opts: {
  config: ExternalConfig;
  proxy?: ProxyConfig;
  messages: ChatMessage[];
  model?: string;
  signal?: AbortSignal;
}): AsyncGenerator<{ delta: string; done: boolean; usage?: { totalTokens: number } }> {
  const { config, proxy, messages, signal } = opts;
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const model = opts.model || config.defaultModel;

  // Преобразуем messages: vision images требуют OpenAI multimodal формат
  const openaiMessages = messages.map((m) => {
    if (!m.images || m.images.length === 0) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        { type: 'text', text: m.content },
        ...m.images.map((img) => ({
          type: 'image_url',
          image_url: { url: img.startsWith('http') ? img : `data:image/jpeg;base64,${img}` },
        })),
      ],
    };
  });

  // Proxy dispatcher (если включен и установлен undici)
  const useProxy = config.useProxy && proxy?.enabled;
  const dispatcher = useProxy ? await createProxyDispatcher(proxy) : undefined;

  const init: RequestInit = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      // OpenRouter требует доп.заголовки для статистики
      ...(config.provider === 'openrouter'
        ? { 'HTTP-Referer': 'https://openfinance.local', 'X-Title': 'Open Finance' }
        : {}),
    },
    body: JSON.stringify({
      model,
      messages: openaiMessages,
      stream: true,
    }),
    signal,
  };
  if (dispatcher) {
    // @ts-expect-error - undici dispatcher
    init.dispatcher = dispatcher;
  }

  const res = await fetch(`${baseUrl}/chat/completions`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${config.provider} ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.body) throw new Error('Пустой response body от провайдера');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let totalTokens = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') {
        yield { delta: '', done: true, usage: { totalTokens } };
        return;
      }
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { total_tokens?: number };
        };
        const delta = json.choices?.[0]?.delta?.content ?? '';
        if (delta) {
          totalTokens += 1; // приближение (точные tokens — в usage)
          yield { delta, done: false };
        }
        if (json.usage?.total_tokens) {
          totalTokens = json.usage.total_tokens;
        }
      } catch {
        // битый SSE chunk
      }
    }
  }

  yield { delta: '', done: true, usage: { totalTokens } };
}

/**
 * Простая проверка что API ключ валиден и endpoint отвечает.
 * GET /v1/models — стандартный OpenAI endpoint.
 */
export async function testExternalConnection(opts: {
  config: ExternalConfig;
  proxy?: ProxyConfig;
}): Promise<{ ok: true; modelsCount: number; sample: string[] } | { ok: false; error: string; status?: number }> {
  const { config, proxy } = opts;
  const baseUrl = config.baseUrl.replace(/\/$/, '');

  const useProxy = config.useProxy && proxy?.enabled;
  let dispatcher;
  try {
    dispatcher = useProxy ? await createProxyDispatcher(proxy) : undefined;
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'proxy error' };
  }

  const init: RequestInit = {
    method: 'GET',
    headers: { Authorization: `Bearer ${config.apiKey}` },
    signal: AbortSignal.timeout(10_000),
  };
  if (dispatcher) {
    // @ts-expect-error - undici dispatcher
    init.dispatcher = dispatcher;
  }

  try {
    const res = await fetch(`${baseUrl}/models`, init);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `${res.status} ${text.slice(0, 200)}`.trim(),
        status: res.status,
      };
    }
    const data = (await res.json()) as { data?: Array<{ id?: string }> };
    const models = (data.data ?? []).map((m) => m.id ?? '').filter(Boolean);
    return { ok: true, modelsCount: models.length, sample: models.slice(0, 10) };
  } catch (e) {
    if (e instanceof Error && e.name === 'TimeoutError') {
      return { ok: false, error: 'Timeout — endpoint не ответил за 10 секунд' };
    }
    return { ok: false, error: e instanceof Error ? e.message : 'unknown error' };
  }
}

/** Дефолтные baseUrl для известных провайдеров */
export const PROVIDER_DEFAULTS: Record<
  ExternalConfig['provider'],
  { baseUrl: string; modelExample: string; signupUrl: string }
> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    modelExample: 'gpt-4o-mini',
    signupUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1',
    modelExample: 'claude-3-5-haiku-20241022',
    signupUrl: 'https://console.anthropic.com/settings/keys',
  },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    modelExample: 'openai/gpt-4o-mini',
    signupUrl: 'https://openrouter.ai/keys',
  },
  vsegpt: {
    baseUrl: 'https://api.vsegpt.ru/v1',
    modelExample: 'openai/gpt-4o-mini',
    signupUrl: 'https://vsegpt.ru/Docs/API',
  },
  custom: {
    baseUrl: '',
    modelExample: '',
    signupUrl: '',
  },
};
