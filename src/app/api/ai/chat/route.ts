// PURPOSE: POST /api/ai/chat — AI micro-agent chat endpoint.
// Принимает сообщения + контекст блока, вызывает Ollama /api/chat или OpenAI.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getSystemPrompt } from '@/lib/ai/system-prompt';
import { buildMicroAgentSystemPrompt } from '@/lib/ai/micro-agent/prompt';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { eq } from 'drizzle-orm';
import type { MicroAgentResponse, SuggestedAction } from '@/lib/ai/micro-agent/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

/** Ollama base URL */
const OLLAMA_BASE = process.env.OLLAMA_HOST ?? 'http://localhost:11434';

/** Вызвать Ollama /api/chat */
async function callOllama(
  model: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string; images?: string[] }>,
): Promise<{ content: string; model: string }> {
  const ollamaMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.images && m.images.length > 0 ? { images: m.images } : {}),
    })),
  ];

  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: ollamaMessages,
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Ollama error ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as { message?: { content?: string }; model?: string };
  return {
    content: data.message?.content ?? '',
    model: data.model ?? model,
  };
}

/** Попытаться извлечь JSON action из ответа AI */
function parseAction(content: string): SuggestedAction | undefined {
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

  // Получить tenant settings для system prompt
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const globalSystemPrompt = getSystemPrompt(tenant?.settings ?? null);

  // Собрать полный system prompt
  const systemPrompt = buildMicroAgentSystemPrompt({
    globalSystemPrompt,
    blockContext: blockContext ?? undefined,
    quickAction: quickAction ?? undefined,
    blockPrompt: blockPrompt ?? undefined,
  });

  // Выбрать модель (дефолт — первая установленная или qwen2.5:7b)
  const selectedModel = model || 'qwen2.5:7b';

  try {
    const result = await callOllama(selectedModel, systemPrompt, messages);

    // Попытаться распарсить action из ответа
    const suggestedAction = parseAction(result.content);

    const response: MicroAgentResponse = {
      content: result.content,
      suggestedAction,
      model: result.model,
    };

    return NextResponse.json({ ok: true, ...response });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
