// PURPOSE: POST /api/marketplaces/ozon/ai-insights — ИИ-генерация инсайтов
// для блока «Ozon · AI инсайты». Принимает готовый текстовый контекст
// (KPI + аналитика + авто-инсайты, собранный клиентом), строит строго
// структурированный промпт и стримит NDJSON-ответ.
// Формат событий: { type: 'start'|'token'|'done'|'error'|'aborted', ... }.
// НЕ персистит — сохранение идёт через .../ai-insights/reports.
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
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const maxDuration = 120;

const RequestSchema = z.object({
  /** Готовый markdown-контекст: KPI, аналитика, авто-инсайты, топ-SKU. */
  context: z.string().min(1).max(16000),
  /** Опциональный фокус-вопрос пользователя. */
  userQuery: z.string().max(1000).optional(),
  /** Человеко-читаемый период для шапки промпта. */
  periodLabel: z.string().max(120).optional(),
});

const OLLAMA_BASE = env.OLLAMA_BASE_URL;

/**
 * Строго структурированный system prompt для анализа Ozon.
 * Контракт ответа — ОДИН JSON-объект (summary + insights[]).
 */
function buildOzonInsightsPrompt(globalPrompt: string): string {
  return `${globalPrompt}

---

Ты — старший аналитик маркетплейса Ozon. Анализируешь срез метрик магазина и
даёшь предпринимателю действенные выводы. Анализируй СТРОГО по структуре, по
разделам в этом порядке:
1. Выручка и динамика (category: "revenue")
2. Реклама и ДРР (category: "ads")
3. Товары и ассортимент / маржинальность (category: "products")
4. Остатки и оборачиваемость (category: "stock")
5. Возвраты и выкуп (category: "returns")
6. Общие выводы (category: "general")

## Формат ответа — СТРОГО валидный JSON, без markdown-обёртки, без преамбул:
{
  "summary": "2-4 предложения executive summary: главное за период",
  "insights": [
    {
      "category": "revenue|ads|products|stock|returns|general",
      "type": "positive|warning|danger|info",
      "kind": "action|observation|opportunity|info",
      "priority": 1,
      "title": "краткий заголовок (до 80 символов)",
      "description": "1-3 предложения с конкретикой",
      "metric": "короткий бейдж, напр. «ДРР 34%» (опционально)",
      "sku": "артикул/SKU товара (только для per-SKU инсайтов, опционально)",
      "tags": ["короткая пилюля", "ещё пилюля"],
      "recommendation": {
        "action": "что конкретно сделать",
        "basis": "на чём основано (из данных)",
        "expectedEffect": "ожидаемый эффект"
      }
    }
  ]
}

## Правила
- Только из предоставленных данных. НИЧЕГО не выдумывай. Нет данных по разделу — пропусти его.
- 6-12 инсайтов суммарно, самые важные — priority 1.
- "type": danger = критично/убыток, warning = риск, positive = хорошо, info = нейтрально.
- "kind": action = требует действия сейчас, observation = мониторить, opportunity = точка роста, info = факт.
- Для проблемных/перспективных товаров давай per-SKU инсайт: укажи "sku", "tags" и "recommendation" (action/basis/expectedEffect).
- ВАЖНО: "summary" и "description" — ОБЫЧНЫЙ текст БЕЗ markdown-разметки (никаких **, _, #, списков). Числа писать как есть, без звёздочек.
- Суммы — рубли как в данных, проценты с 1 знаком.
- Русский язык. Без «конечно», «вот анализ» и прочих вступлений.
- Ответ — ТОЛЬКО JSON-объект, ничего до или после.`;
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
    const { context, userQuery, periodLabel } = body.data;

    const [tenant] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);
    const tenantSettings = tenant?.settings ?? null;

    const systemPrompt = buildOzonInsightsPrompt(getSystemPrompt(tenantSettings));

    const contextMessage = [
      periodLabel ? `## Период: ${periodLabel}` : '',
      '## Данные среза Ozon:',
      context,
      userQuery ? `\n## Фокус-вопрос пользователя:\n${userQuery}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const activeCreds = await getActiveCredentials(
      session.userId,
      session.tenantId,
      tenantSettings,
    );

    const externalConfig =
      activeCreds.source !== 'none' && activeCreds.enabled
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
                sse(controller, { type: 'token', delta: chunk.delta, total: fullContent.length });
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

    // Ollama fallback.
    let resolvedModel: string;
    try {
      const installed = await listInstalledModels();
      const chatModels = installed.filter(isChatCapableModel);
      if (chatModels.length === 0) throw new Error('Нет установленных chat-моделей Ollama');
      const preferred = tenantSettings?.aiModel;
      const match = preferred ? chatModels.find((m) => m.name === preferred) : null;
      resolvedModel = match?.name ?? chatModels[0].name;
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : 'Ollama error' },
        { status: 502 },
      );
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
                  sse(controller, { type: 'token', delta, total: fullContent.length });
                }
                if (ev.done) {
                  sse(controller, { type: 'done', content: fullContent, model: resolvedModel });
                }
              } catch {
                /* skip non-JSON line */
              }
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
    console.error('[api/marketplaces/ozon/ai-insights POST]', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
