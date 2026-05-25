// PURPOSE: POST /api/ai/analyze-section — AI анализ раздела (страницы BlockGrid).
// Загружает layout блоков, собирает контекст, стримит NDJSON ответ.
// Формат: { type: 'start'|'token'|'done'|'error'|'aborted', ... }
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { eq } from 'drizzle-orm';
import { loadLayout } from '@/lib/blocks/queries';
import { getBlockDef } from '@/lib/blocks/registry';
import { resolvePromptStack } from '@/lib/ai/prompt-resolver';
import { getActiveCredentials } from '@/lib/ai/user-keys';
import { streamOpenAICompat } from '@/lib/ai/providers/openai-compat';
import { listInstalledModels, isChatCapableModel } from '@/lib/ai/providers/ollama';
import { env } from '@/lib/env';
import type { BlockInstance } from '@/lib/blocks/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

const RequestSchema = z.object({
  pageKey: z.string().min(1).max(64),
  /** Конкретные blockIds для анализа (если не задан — берём все блоки страницы) */
  blockIds: z.array(z.string()).max(50).optional(),
  /** Пользовательский вопрос */
  userQuery: z.string().max(2000).optional(),
  /** 'all' — все блоки, 'subgraph' — автоподбор связанных (dependency tree) */
  scope: z.enum(['all', 'subgraph']).default('all'),
});

const OLLAMA_BASE = env.OLLAMA_BASE_URL;

/** Сериализовать блок в краткий текст для контекста AI */
function serializeBlock(block: BlockInstance): string {
  const def = getBlockDef(block.type);
  const title = block.appearance?.title ?? def?.displayName ?? block.type;
  const parts = [`[${title} (${block.type})]`];

  if (block.config && Object.keys(block.config).length > 0) {
    const configStr = JSON.stringify(block.config);
    const truncated = configStr.length > 600 ? configStr.slice(0, 600) + '...' : configStr;
    parts.push(`  config: ${truncated}`);
  }

  if (block.dependencies?.sources && block.dependencies.sources.length > 0) {
    const srcs = block.dependencies.sources.map((s) => s.label ?? s.blockId).join(', ');
    parts.push(`  источники: ${srcs}`);
  }

  return parts.join('\n');
}

/** Построить subgraph — найти все блоки связанные с указанным (источники + потребители) */
function buildSubgraph(blocks: BlockInstance[]): BlockInstance[] {
  const allDepsBlockIds = new Set<string>();

  for (const block of blocks) {
    if (block.dependencies?.sources) {
      for (const src of block.dependencies.sources) {
        allDepsBlockIds.add(src.blockId);
      }
    }
  }

  // Все блоки у которых есть зависимости И их источники
  return blocks.filter(
    (b) =>
      (b.dependencies?.sources && b.dependencies.sources.length > 0) ||
      allDepsBlockIds.has(b.id),
  );
}

function sse(controller: ReadableStreamDefaultController, data: Record<string, unknown>) {
  controller.enqueue(JSON.stringify(data) + '\n');
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId || !session.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const json = await req.json();
    const body = RequestSchema.safeParse(json);
    if (!body.success) {
      return NextResponse.json(
        { ok: false, error: body.error.issues[0]?.message ?? 'Bad request' },
        { status: 400 },
      );
    }

    const { pageKey, blockIds, userQuery, scope } = body.data;

    // Загрузить layout страницы
    const layout = await loadLayout({
      tenantId: session.tenantId,
      userId: session.userId,
      pageKey,
    });

    let targetBlocks = layout.blocks as BlockInstance[];

    // Фильтр по blockIds если передан
    if (blockIds && blockIds.length > 0) {
      targetBlocks = targetBlocks.filter((b) => blockIds.includes(b.id));
    }

    // Если scope=subgraph — берём только связанные блоки
    if (scope === 'subgraph') {
      const subgraph = buildSubgraph(targetBlocks);
      if (subgraph.length > 0) targetBlocks = subgraph;
    }

    // Ограничиваем до 20 блоков для token budget
    const limitedBlocks = targetBlocks.slice(0, 20);

    // Сериализуем блоки в контекст
    const sectionBlocksCtx = limitedBlocks.map((b) => ({
      blockId: b.id,
      blockType: b.type,
      blockTitle: b.appearance?.title ?? getBlockDef(b.type)?.displayName,
      config: b.config as Record<string, unknown> | undefined,
    }));

    const blocksText = limitedBlocks.map(serializeBlock).join('\n\n');

    // Загрузить tenant settings
    const [tenant] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);
    const tenantSettings = tenant?.settings ?? null;

    // Сформировать user message
    const contextMessage = [
      `## Блоки раздела "${pageKey}" (${limitedBlocks.length} из ${targetBlocks.length}${scope === 'subgraph' ? ', только связанные' : ''}):`,
      '',
      blocksText,
      userQuery ? `\n## Вопрос пользователя:\n${userQuery}` : '',
      !userQuery ? '\n## Задача:\nПроанализируй данный раздел. Дай краткое резюме (3-5 наблюдений), выяви потенциальные проблемы, предложи рекомендации.' : '',
    ].filter(Boolean).join('\n');

    // Резолвим промпт
    const { systemPrompt } = resolvePromptStack({
      tenantSettings,
      pageKey,
      scope: 'section',
      sectionBlocks: sectionBlocksCtx,
    });

    // Резолвим credentials
    const activeCreds = await getActiveCredentials(
      session.userId,
      session.tenantId,
      tenantSettings,
    );

    const externalConfig = activeCreds.source !== 'none' && activeCreds.enabled
      ? {
          enabled: true as const,
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

    const upstreamController = new AbortController();
    req.signal.addEventListener('abort', () => upstreamController.abort());

    const messages = [
      { role: 'user' as const, content: contextMessage },
    ];

    if (useExternal && externalConfig) {
      const externalModel = externalConfig.defaultModel || 'gpt-4o-mini';
      const stream = new ReadableStream({
        async start(controller) {
          try {
            sse(controller, { type: 'start', model: externalModel, provider: externalConfig.provider });
            let fullContent = '';
            for await (const chunk of streamOpenAICompat({
              config: externalConfig,
              proxy: proxyConfig,
              messages: [{ role: 'system', content: systemPrompt }, ...messages],
              model: externalModel,
              signal: upstreamController.signal,
            })) {
              if (chunk.delta) {
                fullContent += chunk.delta;
                sse(controller, { type: 'token', delta: chunk.delta });
              }
              if (chunk.done) {
                sse(controller, { type: 'done', content: fullContent, model: externalModel });
              }
            }
            controller.close();
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') {
              sse(controller, { type: 'aborted' });
            } else {
              sse(controller, { type: 'error', error: e instanceof Error ? e.message : 'Provider error' });
            }
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

    // Ollama
    let resolvedModel: string;
    try {
      const installed = await listInstalledModels();
      const chatModels = installed.filter(isChatCapableModel);
      if (chatModels.length === 0) throw new Error('Нет установленных chat-моделей Ollama');
      const preferred = tenantSettings?.aiModel;
      const match = preferred ? chatModels.find((m) => m.name === preferred) : null;
      resolvedModel = match?.name ?? chatModels[0].name;
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'Ollama error' }, { status: 502 });
    }

    const ollamaMessages = [
      { role: 'system', content: systemPrompt },
      ...messages,
    ];

    const stream = new ReadableStream({
      async start(controller) {
        try {
          sse(controller, { type: 'start', model: resolvedModel });
          const ollamaRes = await fetch(`${OLLAMA_BASE}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: resolvedModel, messages: ollamaMessages, stream: true }),
            signal: upstreamController.signal,
          });

          if (!ollamaRes.ok || !ollamaRes.body) {
            const text = await ollamaRes.text();
            sse(controller, { type: 'error', error: `Ollama ${ollamaRes.status}: ${text.slice(0, 200)}` });
            controller.close();
            return;
          }

          const reader = ollamaRes.body.getReader();
          const decoder = new TextDecoder();
          let fullContent = '';
          let buf = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const ev = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
                const delta = ev.message?.content ?? '';
                if (delta) {
                  fullContent += delta;
                  sse(controller, { type: 'token', delta });
                }
                if (ev.done) {
                  sse(controller, { type: 'done', content: fullContent, model: resolvedModel });
                }
              } catch { /* skip */ }
            }
          }
          controller.close();
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') {
            sse(controller, { type: 'aborted' });
          } else {
            sse(controller, { type: 'error', error: e instanceof Error ? e.message : 'Ollama error' });
          }
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
  } catch (error) {
    console.error('[api/ai/analyze-section POST]', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
