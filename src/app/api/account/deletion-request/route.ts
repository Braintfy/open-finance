// PURPOSE: /api/account/deletion-request — self-service заявка на удаление
// аккаунта (152-ФЗ «право на удаление»). GET: активная заявка; POST: создать
// (ручное подтверждение super_admin в админке); DELETE: отменить pending.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { internalError } from '@/lib/api-error';
import {
  createDeletionRequest,
  getActiveDeletionRequest,
  cancelDeletionRequest,
} from '@/lib/account/deletion-queries';

export const runtime = 'nodejs';

const Body = z.object({ reason: z.string().max(1000).optional() });

export async function GET() {
  try {
    const session = await auth();
    if (!session?.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const request = await getActiveDeletionRequest(session.userId);
    return NextResponse.json({ ok: true, request });
  } catch (e) {
    console.error('[account] GET /deletion-request failed:', e);
    return internalError();
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.userId || !session.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    const reason = parsed.success ? parsed.data.reason : undefined;

    const request = await createDeletionRequest({
      userId: session.userId,
      tenantId: session.tenantId,
      email: session.email,
      reason,
    });
    return NextResponse.json({ ok: true, request });
  } catch (e) {
    console.error('[account] POST /deletion-request failed:', e);
    return internalError();
  }
}

export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const cancelled = await cancelDeletionRequest({ userId: session.userId });
    return NextResponse.json({ ok: true, cancelled });
  } catch (e) {
    console.error('[account] DELETE /deletion-request failed:', e);
    return internalError();
  }
}
