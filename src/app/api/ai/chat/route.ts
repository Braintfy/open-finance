// PURPOSE: POST /api/ai/chat — AI micro-agent chat endpoint (streaming NDJSON).
// Принимает сообщения + контекст блока. Потоковый ответ с событиями token/done/error.
// Auto-fallback на установленную модель, если запрошенная не найдена.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getSystemPrompt } from '@/lib/ai/system-prompt';
import { buildMicroAgentSystemPrompt } from '@/lib/ai/micro-agent/prompt';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { eq } from 'drizzle-orm';
import { env } from '@/lib/env';
import { listInstalledModels, isChatCapableModel } from '@/lib/ai/providers/ollama';
import { streamOpenAICompat } from '@/lib/ai/providers/openai-compat';
import type { SuggestedAction } from '@/lib/ai/micro-agent/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  images: z.array(z.string()).optional(),
});

const BlockContextSchema = z.object({
  blockId: z.string().optional(),
  blockType: z.string().optional(),
  blockTitle: z.string().optional(),
  blockData: z.record(z.unknown()).optional(),
  pageKey: z.string().optional(),
}).optional();

const RequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  blockContext: BlockContextSchema,
  quickAction: z.enum(['summarize', 'fill_cells', 'calculate', 'extract', 'categorize', 'custom']).optional(),
  model: z.string().optional(),
  blockPrompt: z.string().max(5000).optional(),
});

/** Ollama base URL из типизированного env */
const OLLAMA_BASE = env.OLLAMA_BASE_URL;

/**
 * Разрешить модель: если запрошенная установлена — ужё ок;
 * иначе взять первую из списка. Если ниодной нет — throw с понятным сообщением.
 */
async function resolveModel(requested: string): Promise<{ model: string; fallback: boolean }> {
  try {
    const installed = await listInstalledModels();
    if (installed.length === 0) {
      throw new Error(
        `Нет установленных моделей Ollama. Установите: ollama pull qwen2.5:1.5b`,
      );
    }
    // Точное совпадение (с :tag) или по имени без :tag, и только chat-capable
    const exact = installed.find((m) => m.name === requested);
    if (exact && isChatCapableModel(exact)) return { model: exact.name, fallback: false };

    const byBase = installed.find((m) => m.name.split(':')[0] === requested.split(':')[0]);
    if (byBase && isChatCapableModel(byBase)) return { model: byBase.name, fallback: false };

    // Fallback: первая chat-capable установленная модель (НЕ embedding!)
    const chatModels = installed.filter(isChatCapableModel);
    if (chatModels.length === 0) {
      const installedNames = installed.map((m) => m.name).join(', ');
      throw new Error(
        `Установлены только embedding-модели (${installedNames}). Установите chat-модель: ollama pull qwen2.5:1.5b`,
      );
    }
    return { model: chatModels[0].name, fallback: true };
  } catch (e) {
    if (e instanceof Error && (e.message.includes('ECONNREFUSED') || e.message.includes('fetch failed'))) {
      throw new Error(`Не удалось подключиться к Ollama (${OLLAMA_BASE}). Запустите: ollama serve`);
    }
    throw e;
  }
}

/** Попытаться извлечь JSON action из ответа AI */
export function parseAction(content: string): SuggestedAction | undefined {
  // Ищем ```json блок
  const jsonMatch = content.match(/```json\s*\n?([\s\S]*?)\n?\s*```/);
  if (!jsonMatch) return undefined;

  try {
    const parsed = JSON.parse(jsonMatch[1]) as { action?: string; data?: Record<string, unknown> };
    if (!parsed.action || !parsed.data) return undefined;

    switch (parsed.action) {
      case 'update_block':
        return { type: 'update_block', payload: parsed.data };
      case 'create_block': {
        const blockType = (parsed.data as { blockType?: string }).blockType ?? 'custom.data';
        const config = (parsed.data as { config?: Record<string, unknown> }).config ?? parsed.data;
        return { type: 'create_block', payload: { blockType, config } };
      }
      case 'text_only':
        return { type: 'text_only', payload: { text: (parsed.data as { text?: string }).text ?? '' } };
      default:
        return undefined;
    }
  } catch {
    return undefined;
  }
}

/**
 * Отправить событие в NDJSON streaming response.
 * Формат: один JSON объект на строку, разделитель \n.
 */
function sse(controller: ReadableStreamDefaultController, data: Record<string, unknown>) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(data) + '\n'));
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const json = await req.json();
  const body = RequestSchema.safeParse(json);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: 'Invalid request', details: body.error.flatten() },
      { status: 400 },
    );
  }

  const { messages, blockContext, quickAction, model, blockPrompt } = body.data;

  // Получить tenant settings для system prompt + AI config
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const tenantSettings = tenant?.settings ?? null;
  const globalSystemPrompt = getSystemPrompt(tenantSettings);

  // Собрать полный system prompt
  const systemPrompt = buildMicroAgentSystemPrompt({
    globalSystemPrompt,
    blockContext: blockContext ?? undefined,
    quickAction: quickAction ?? undefined,
    blockPrompt: blockPrompt ?? undefined,
  });

  const externalConfig = tenantSettings?.aiExternal;
  const proxyConfig = tenantSettings?.aiProxy;
  const useExternal = externalConfig?.enabled && externalConfig.apiKey && externalConfig.baseUrl;

  // Пробросить abort от клиента (кнопка "Остановить")
  const upstreamController = new AbortController();
  req.signal.addEventListener('abort', () => upstreamController.abort());

  // ─────────────── External provider (OpenAI-compat) ───────────────
  if (useExternal) {
    const externalModel = model || externalConfig.defaultModel || 'gpt-4o-mini';
    const stream = new ReadableStream({
      async start(controller) {
        try {
          sse(controller, {
            type: 'start',
            model: externalModel,
            fallback: false,
            provider: externalConfig.provider,
          });
          const startedAt = Date.now();
          let fullContent = '';
          let tokenCount = 0;
          for await (const chunk of streamOpenAICompat({
            config: externalConfig,
            proxy: proxyConfig,
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
            model: externalModel,
            signal: upstreamController.signal,
          })) {
            if (chunk.delta) {
              fullContent += chunk.delta;
              tokenCount += 1;
              sse(controller, { type: 'token', delta: chunk.delta, total: tokenCount });
            }
            if (chunk.done) {
              const durationSec = (Date.now() - startedAt) / 1000;
              const totalTokens = chunk.usage?.totalTokens ?? tokenCount;
              sse(controller, {
                type: 'done',
                content: fullContent,
                suggestedAction: parseAction(fullContent),
                model: externalModel,
                provider: externalConfig.provider,
                totalTokens,
                durationSec,
                tokensPerSec: durationSec > 0 ? totalTokens / durationSec : 0,
              });
            }
          }
          controller.close();
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') {
            sse(controller, { type: 'aborted' });
            controller.close();
            return;
          }
          sse(controller, {
            type: 'error',
            error: e instanceof Error ? e.message : 'External provider error',
          });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // ─────────────── Ollama (локальная модель) ───────────────
  let resolvedModel: string;
  let usedFallback = false;
  try {
    const res = await resolveModel(model || env.OLLAMA_DEFAULT_MODEL);
    resolvedModel = res.model;
    usedFallback = res.fallback;
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }

  const ollamaMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.images && m.images.length > 0 ? { images: m.images } : {}),
    })),
  ];

  const stream = new ReadableStream({
    async start(controller) {
      try {
        sse(controller, { type: 'start', model: resolvedModel, fallback: usedFallback, provider: 'ollama' });

        const ollamaRes = await fetch(`${OLLAMA_BASE}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: resolvedModel,
            messages: ollamaMessages,
            stream: true,
          }),
          signal: upstreamController.signal,
        });

        if (!ollamaRes.ok) {
          const text = await ollamaRes.text().catch(() => '');
          sse(controller, {
            type: 'error',
            error: `Ollama error ${ollamaRes.status}: ${text.slice(0, 200)}`,
          });
          controller.close();
          return;
        }

        if (!ollamaRes.body) {
          sse(controller, { type: 'error', error: 'Ollama вернул пустой ответ' });
          controller.close();
          return;
        }

        const reader = ollamaRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullContent = '';
        let totalTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line) as {
                message?: { content?: string };
                done?: boolean;
                eval_count?: number;
                eval_duration?: number;
              };
              const piece = chunk.message?.content ?? '';
              if (piece) {
                fullContent += piece;
                totalTokens += 1;
                sse(controller, { type: 'token', delta: piece, total: totalTokens });
              }
              if (chunk.done) {
                const evalCount = chunk.eval_count ?? totalTokens;
                const evalDurationSec = chunk.eval_duration ? chunk.eval_duration / 1e9 : 0;
                const suggestedAction = parseAction(fullContent);
                sse(controller, {
                  type: 'done',
                  content: fullContent,
                  suggestedAction,
                  model: resolvedModel,
                  provider: 'ollama',
                  totalTokens: evalCount,
                  durationSec: evalDurationSec,
                  tokensPerSec: evalDurationSec > 0 ? evalCount / evalDurationSec : 0,
                });
              }
            } catch {
              // сломанный chunk — пропускаем
            }
          }
        }

        controller.close();
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
          sse(controller, { type: 'aborted' });
          controller.close();
          return;
        }
        const message = e instanceof Error ? e.message : 'Unknown error';
        sse(controller, {
          type: 'error',
          error:
            message.includes('ECONNREFUSED') || message.includes('fetch failed')
              ? `Не удалось подключиться к Ollama (${OLLAMA_BASE}). Запустите: ollama serve`
              : message,
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}
