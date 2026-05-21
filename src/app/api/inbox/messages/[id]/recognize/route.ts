// PURPOSE: POST /api/inbox/messages/[id]/recognize — запускает AI vision на
// прикреплённом изображении (или прилагает свой через multipart). Сохраняет
// результат в inbox_messages.aiExtracted + aiProvider + aiExtractedAt.

import { NextResponse } from 'next/server';
import { eq, and } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { inboxMessages } from '@/lib/db/schema/inbox';
import { getVisionProvider, type VisionHint, type VisionInput } from '@/lib/ai/vision';

const VALID_HINTS: VisionHint[] = ['receipt', 'invoice', 'contract', 'auto'];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.tenantId || !session?.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { id: messageId } = await ctx.params;

  // Загружаем сообщение
  const rows = await db
    .select()
    .from(inboxMessages)
    .where(and(eq(inboxMessages.id, messageId), eq(inboxMessages.tenantId, session.tenantId)))
    .limit(1);
  const msg = rows[0];
  if (!msg) {
    return NextResponse.json({ ok: false, error: 'Сообщение не найдено' }, { status: 404 });
  }

  const url = new URL(req.url);
  const hintParam = url.searchParams.get('hint') ?? 'auto';
  const hint: VisionHint = VALID_HINTS.includes(hintParam as VisionHint)
    ? (hintParam as VisionHint)
    : 'auto';
  const overrideProvider = url.searchParams.get('provider') ?? undefined;

  // Источник изображения: 1) multipart upload, 2) attachment URL из metadata
  const contentType = req.headers.get('content-type') ?? '';
  let visionInput: VisionInput | null = null;

  if (contentType.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const file = form.get('file');
    if (file instanceof File) {
      const buf = Buffer.from(await file.arrayBuffer());
      visionInput = {
        kind: 'buffer',
        buffer: buf,
        mimeType: file.type || 'image/jpeg',
        filename: file.name,
      };
    }
  } else {
    // Ищем attachment URL в metadata (зависит от channel-feed schema)
    const meta = (msg.metadata ?? {}) as Record<string, unknown>;
    const attachments = (meta.attachments as Array<{ url?: string; mimeType?: string }>) ?? [];
    const first = attachments[0];
    if (first?.url) {
      visionInput = { kind: 'url', url: first.url, mimeType: first.mimeType };
    }
  }

  if (!visionInput) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Нет изображения для распознавания. Прикрепите файл через multipart или к сообщению.',
      },
      { status: 400 },
    );
  }

  const provider = getVisionProvider({ override: overrideProvider ?? undefined });
  if (!provider.supports(visionInput.mimeType ?? '')) {
    return NextResponse.json(
      {
        ok: false,
        error: `Провайдер ${provider.id} не поддерживает ${visionInput.mimeType ?? 'этот формат'}`,
      },
      { status: 400 },
    );
  }

  try {
    const extracted = await provider.recognize(visionInput, hint, {
      tenantId: session.tenantId,
      userId: session.userId,
    });
    // Сохраняем результат в БД
    await db
      .update(inboxMessages)
      .set({
        aiExtracted: extracted as unknown as Record<string, unknown>,
        aiProvider: provider.id,
        aiExtractedAt: new Date(),
      })
      .where(and(eq(inboxMessages.id, messageId), eq(inboxMessages.tenantId, session.tenantId)));

    return NextResponse.json({
      ok: true,
      extracted,
      provider: provider.id,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Vision provider error: ${(err as Error).message}`,
        provider: provider.id,
      },
      { status: 500 },
    );
  }
}
