// PURPOSE: POST /api/ai/analyze-block — AI анализ ОДНОГО блока (точечный отчёт).
// Принимает live-снапшот целевого блока (config + output + __aiContext), опц.
// live-контекст блоков текущего раздела (доверяем — это контент страницы) и
// ref-ы на блоки других разделов (резолвятся из БД). Подмешивает последний
// отчёт самого блока (includeLastReport). Стримит строгий NDJSON (summary +
// insights[]). НЕ персистит — сохранение через /api/ai/block-reports.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { eq } from 'drizzle-orm';
import { getSystemPrompt } from '@/lib/ai/system-prompt';
import { getActiveCredentials } from '@/lib/ai/user-keys';
import { streamOpenAICompat } from '@/lib/ai/providers/openai-compat';
import { listInstalledModels, isChatCapableModel } from '@/lib/ai/providers/ollama';
import { getBlockSkill } from '@/lib/ai/prompts/block-skills/index';
import { env } from '@/lib/env';
import {
  SectionBlockSnapshotSchema,
  BlockContextSelectionSchema,
  assembleBlockContext,
  type ExternalSourceContext,
  type SectionInsight,
} from '@/lib/ai/section-insights';
import { resolveBlockContextSelections } from '@/lib/ai/block-context-sources-queries';
import { listBlockReports } from '@/lib/ai/block-reports-queries';

export const runtime = 'nodejs';
export const maxDuration = 120;

const RequestSchema = z.object({
  pageKey: z.string().min(1).max(64),
  blockId: z.string().min(1).max(64),
  blockType: z.string().max(80).optional(),
  blockTitle: z.string().max(200).optional(),
  /** Снапшот целевого блока (собран клиентом, live). */
  snapshot: SectionBlockSnapshotSchema,
  /** Фокус-вопрос пользователя. */
  userQuery: z.string().max(2000).optional(),
  /** Live-снапшоты блоков текущего раздела (доверяем — контент страницы). */
  liveContextBlocks: z.array(SectionBlockSnapshotSchema).max(20).optional(),
  /** Ref-ы на блоки других разделов (резолвятся сервером из БД). */
  externalBlocks: z.array(BlockContextSelectionSchema).max(20).optional(),
  /** Подмешать последний сохранённый отчёт самого блока (default true). */
  includeLastReport: z.boolean().optional().default(true),
});

const OLLAMA_BASE = env.OLLAMA_BASE_URL;

/** Строго структурированный system prompt для анализа блока (контракт JSON). */
function buildBlockPrompt(
  globalPrompt: string,
  blockTitle: string | undefined,
  blockSkill: string,
): string {
  return `${globalPrompt}

---

Ты — аналитик бизнес-данных. Анализируешь ОДИН блок${blockTitle ? ` «${blockTitle}»` : ''} дашборда и даёшь предпринимателю действенные выводы СТРОГО по предоставленным данным.${blockSkill ? `\n\n## Специализация блока\n${blockSkill}` : ''}

## Формат ответа — СТРОГО валидный JSON, без markdown-обёртки, без преамбул:
{
  "summary": "2-3 предложения executive summary по блоку",
  "insights": [
    {
      "type": "positive|warning|danger|info",
      "kind": "action|observation|opportunity|info",
      "category": "короткая тема",
      "title": "краткий заголовок (до 80 символов)",
      "description": "1-3 предложения с конкретикой",
      "metric": "короткий бейдж, напр. «ДРР 34%» (опц.)",
      "tags": ["короткая пилюля"],
      "recommendation": {
        "action": "что конкретно сделать",
        "basis": "на чём основано (из данных)",
        "expectedEffect": "ожидаемый эффект"
      }
    }
  ]
}

## Правила
- Только из предоставленных данных. НИЧЕГО не выдумывай. Нет данных — так и скажи в summary.
- 3-8 инсайтов, самые важные — выше. Для проблем/возможностей добавляй "recommendation".
- "type": danger = критично/убыток, warning = риск, positive = хорошо, info = нейтрально.
- "kind": action = требует действия, observation = мониторить, opportunity = рост, info = факт.
- ВАЖНО: "summary" и "description" — ОБЫЧНЫЙ текст БЕЗ markdown (никаких **, _, #, списков).
- Русский язык. Ответ — ТОЛЬКО JSON-объект, ничего до или после.`;
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

    const {
      pageKey,
      blockId,
      blockType,
      blockTitle,
      snapshot,
      userQuery,
      liveContextBlocks,
      externalBlocks,
      includeLastReport,
    } = body.data;

    const [tenant] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);
    const tenantSettings = tenant?.settings ?? null;

    // Контекст из других блоков: live (текущий раздел) + резолв из БД (другие).
    const extraBlocks: ExternalSourceContext[] = [];
    for (const b of liveContextBlocks ?? []) {
      extraBlocks.push({ label: b.title, mode: 'blocks', blocks: [b] });
    }
    if (externalBlocks && externalBlocks.length > 0) {
      const resolvedExternal = await resolveBlockContextSelections({
        tenantId: session.tenantId,
        userId: session.userId,
        selections: externalBlocks,
      });
      extraBlocks.push(...resolvedExternal);
    }

    // Последний отчёт самого блока (подмешивается по умолчанию).
    let lastReport:
      | { createdAt: string; summary: string; insights: SectionInsight[] }
      | null = null;
    if (includeLastReport) {
      const reports = await listBlockReports({
        tenantId: session.tenantId,
        userId: session.userId,
        pageKey,
        blockId,
      }).catch(() => []);
      const last = reports[0];
      if (last) {
        lastReport = {
          createdAt: last.createdAt.toISOString(),
          summary: last.summary,
          insights: last.insights,
        };
      }
    }

    const contextMessage = assembleBlockContext({
      snapshot,
      lastReport,
      extraBlocks,
      userQuery,
    });

    const blockSkill = getBlockSkill(
      blockType,
      tenantSettings?.aiPrompts?.blocks?.[blockType ?? ''],
    );
    const systemPrompt = buildBlockPrompt(getSystemPrompt(tenantSettings), blockTitle, blockSkill);

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

    const messages = [{ role: 'user' as const, content: contextMessage }];

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

    const ollamaMessages = [{ role: 'system', content: systemPrompt }, ...messages];

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
    console.error('[api/ai/analyze-block POST]', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
