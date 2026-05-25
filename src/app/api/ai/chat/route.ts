// PURPOSE: POST /api/ai/chat — AI micro-agent chat endpoint (streaming NDJSON).
// Принимает сообщения + контекст блока. Потоковый ответ с событиями token/done/error.
// Auto-fallback на установленную модель, если запрошенная не найдена.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { resolvePromptStack } from '@/lib/ai/prompt-resolver';
import { getActiveCredentials } from '@/lib/ai/user-keys';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { eq } from 'drizzle-orm';
import { env } from '@/lib/env';
import { listInstalledModels, isChatCapableModel } from '@/lib/ai/providers/ollama';
import { streamOpenAICompat } from '@/lib/ai/providers/openai-compat';
import type { BlockContext, SuggestedAction } from '@/lib/ai/micro-agent/types';

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
  /** @deprecated используй aiPromptSupplement */
  aiPrompt: z.string().max(8000).optional(),
  aiPromptSupplement: z.string().max(500).optional(),
  publishedValue: z.unknown().optional(),
  publishedMoney: z.string().optional(),
  publishedPeriodKey: z.string().optional(),
}).optional();

const RequestSchema = z.object({
  messages: z.array(MessageSchema).min(1),
  blockContext: BlockContextSchema,
  quickAction: z.enum(['summarize', 'fill_cells', 'calculate', 'extract', 'categorize', 'custom']).optional(),
  model: z.string().optional(),
  /** @deprecated используй blockContext.aiPromptSupplement */
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
export function parseAction(content: string, blockContext?: BlockContext): SuggestedAction | undefined {
  const candidates = extractJsonCandidates(content);

  for (const candidate of candidates) {
    const parsed = tryParseJson(candidate);
    const action = normalizeParsedAction(parsed, blockContext);
    if (action) return action;
  }

  return undefined;
}

function extractJsonCandidates(content: string): string[] {
  const candidates: string[] = [];
  const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(content)) !== null) {
    if (match[1]?.trim()) candidates.push(match[1].trim());
  }

  const balanced = extractFirstJsonObject(content);
  if (balanced) candidates.push(balanced);

  const trimmed = content.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) candidates.push(trimmed);

  return Array.from(new Set(candidates));
}

function extractFirstJsonObject(content: string): string | undefined {
  const start = content.indexOf('{');
  if (start === -1) return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return content.slice(start, i + 1);
    }
  }
  return undefined;
}

function tryParseJson(candidate: string): unknown {
  const normalized = candidate
    .trim()
    .replace(/^\uFEFF/, '')
    .replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(normalized);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeParsedAction(parsed: unknown, blockContext?: BlockContext): SuggestedAction | undefined {
  if (!isRecord(parsed)) return undefined;

  const action = typeof parsed.action === 'string'
    ? parsed.action
    : typeof parsed.type === 'string'
      ? parsed.type
      : undefined;

  const data = parsed.data ?? parsed.payload ?? parsed.config;

  if (action === 'update_block') {
    if (Array.isArray(data)) return { type: 'update_block', payload: { rows: data } };
    if (isRecord(data) && isRecord(data.config)) return { type: 'update_block', payload: data.config };
    if (isRecord(data)) return { type: 'update_block', payload: data };
    if (isRecord(parsed.config)) return { type: 'update_block', payload: parsed.config };
    if (looksLikeBlockConfig(parsed)) {
      const payload = Object.fromEntries(
        Object.entries(parsed).filter(([key]) => key !== 'action' && key !== 'type'),
      );
      return { type: 'update_block', payload };
    }
    return undefined;
  }

  if (action === 'create_block') {
    if (Array.isArray(data)) {
      return { type: 'create_block', payload: { blockType: 'custom.data', config: { rows: data } } };
    }
    const source = isRecord(data) ? data : parsed;
    const blockType = typeof source.blockType === 'string'
      ? source.blockType
      : typeof source.type === 'string'
        ? source.type
        : inferBlockTypeFromPayload(source);
    const config = isRecord(source.config)
      ? source.config
      : isRecord(data)
        ? data
        : source;
    return { type: 'create_block', payload: { blockType, config } };
  }

  if (action === 'text_only') {
    const source = isRecord(data) ? data : parsed;
    return {
      type: 'text_only',
      payload: { text: typeof source.text === 'string' ? source.text : '' },
    };
  }

  if (typeof parsed.blockType === 'string' || isRecord(parsed.config)) {
    const blockType = typeof parsed.blockType === 'string'
      ? parsed.blockType
      : typeof parsed.type === 'string'
        ? parsed.type
        : inferBlockTypeFromPayload(parsed);
    const config = isRecord(parsed.config) ? parsed.config : parsed;
    return { type: 'create_block', payload: { blockType, config } };
  }

  if (looksLikeBlockConfig(parsed)) {
    if (blockContext?.blockType && blockContext.blockType !== 'ai.micro-agent') {
      return { type: 'update_block', payload: parsed };
    }
    return {
      type: 'create_block',
      payload: { blockType: inferBlockTypeFromPayload(parsed), config: parsed },
    };
  }

  return undefined;
}

function looksLikeBlockConfig(value: Record<string, unknown>): boolean {
  return (
    'rows' in value ||
    'cells' in value ||
    'items' in value ||
    'title' in value ||
    'value' in value ||
    'label' in value
  );
}

function inferBlockTypeFromPayload(value: Record<string, unknown>): string {
  if ('cells' in value || 'cols' in value || 'colCount' in value) return 'sheet';
  return 'custom.data';
}

/**
 * Отправить событие в NDJSON streaming response.
 * Формат: один JSON объект на строку, разделитель \n.
 */
function sse(controller: ReadableStreamDefaultController, data: Record<string, unknown>) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(data) + '\n'));
}

function formatOllamaError(status: number, text: string, model: string): string {
  let message = text.trim();
  try {
    const parsed = JSON.parse(message) as { error?: string };
    if (parsed.error) message = parsed.error;
  } catch {
    message = text.trim();
  }

  if (/unable to load model/i.test(message)) {
    return `Ollama не смогла загрузить модель "${model}". Обычно это повреждённый или неполностью скачанный blob модели. Удалите модель в разделе AI модели и скачайте заново; если это HuggingFace GGUF — попробуйте другую квантизацию или repo. Детали: ${message}`;
  }

  return `Ollama error ${status}: ${message.slice(0, 200)}`;
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

  // Резолвим промпт через иерархию (global → section → block-type → supplement)
  const { systemPrompt } = resolvePromptStack({
    tenantSettings,
    pageKey: blockContext?.pageKey,
    blockType: blockContext?.blockType,
    blockTitle: blockContext?.blockTitle,
    blockData: blockContext?.blockData,
    // Приоритет: blockContext.aiPromptSupplement > legacy blockPrompt > blockContext.aiPrompt
    aiPromptSupplement: blockContext?.aiPromptSupplement ?? (blockPrompt?.trim() ? blockPrompt : undefined),
    aiPromptLegacy: blockContext?.aiPrompt,
    publishedValue: blockContext?.publishedValue,
    publishedMoney: blockContext?.publishedMoney,
    publishedPeriodKey: blockContext?.publishedPeriodKey,
    scope: 'block',
    quickAction: quickAction ?? undefined,
  });

  // Резолвим активные credentials (user → tenant → none → Ollama)
  const activeCreds = session.userId
    ? await getActiveCredentials(session.userId, session.tenantId, tenantSettings)
    : null;

  const externalConfig = activeCreds?.source !== 'none' && activeCreds?.enabled
    ? {
        enabled: true,
        provider: activeCreds.provider as 'openai',
        baseUrl: activeCreds.baseUrl,
        apiKey: activeCreds.apiKey,
        defaultModel: activeCreds.defaultModel || 'gpt-4o-mini',
        useProxy: activeCreds.useProxy,
      }
    : tenantSettings?.aiExternal;
  const proxyConfig = tenantSettings?.aiProxy;
  const useExternal =
    tenantSettings?.aiProvider !== 'ollama' &&
    externalConfig?.enabled &&
    externalConfig.apiKey &&
    externalConfig.baseUrl;

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
                suggestedAction: parseAction(fullContent, blockContext ?? undefined),
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
    const res = await resolveModel(model || tenantSettings?.aiModel || env.OLLAMA_DEFAULT_MODEL);
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
            error: formatOllamaError(ollamaRes.status, text, resolvedModel),
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
                error?: string;
              };
              if (chunk.error) {
                sse(controller, {
                  type: 'error',
                  error: formatOllamaError(500, JSON.stringify({ error: chunk.error }), resolvedModel),
                });
                controller.close();
                return;
              }
              const piece = chunk.message?.content ?? '';
              if (piece) {
                fullContent += piece;
                totalTokens += 1;
                sse(controller, { type: 'token', delta: piece, total: totalTokens });
              }
              if (chunk.done) {
                const evalCount = chunk.eval_count ?? totalTokens;
                const evalDurationSec = chunk.eval_duration ? chunk.eval_duration / 1e9 : 0;
                const suggestedAction = parseAction(fullContent, blockContext ?? undefined);
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
