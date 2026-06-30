// PURPOSE: /api/admin/deletion-requests — обработка заявок на удаление аккаунтов
// (152-ФЗ). GET: список (фильтр по статусу). POST: выполнить/отклонить заявку.
// Доступ к /api/admin гейтит middleware (admin|super_admin); физическое удаление
// (action=complete) дополнительно ограничено super_admin.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { internalError } from '@/lib/api-error';
import {
  listDeletionRequests,
  processDeletionRequest,
} from '@/lib/account/deletion-queries';

export const runtime = 'nodejs';

const STATUSES = ['pending', 'completed', 'rejected', 'cancelled'] as const;

const Body = z.object({
  requestId: z.string().uuid(),
  action: z.enum(['complete', 'reject']),
  note: z.string().max(1000).optional(),
});

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const raw = new URL(req.url).searchParams.get('status');
    const status = STATUSES.includes(raw as (typeof STATUSES)[number])
      ? (raw as (typeof STATUSES)[number])
      : undefined;
    const requests = await listDeletionRequests({ status });
    return NextResponse.json({ ok: true, requests });
  } catch (e) {
    console.error('[admin] GET /deletion-requests failed:', e);
    return internalError();
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (session?.globalRole !== 'super_admin') {
      return NextResponse.json(
        { ok: false, error: 'Только super_admin может обрабатывать заявки' },
        { status: 403 },
      );
    }
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Некорректный запрос' },
        { status: 400 },
      );
    }
    const result = await processDeletionRequest({
      requestId: parsed.data.requestId,
      processedBy: session.userId,
      action: parsed.data.action,
      note: parsed.data.note,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error('[admin] POST /deletion-requests failed:', e);
    return internalError();
  }
}
