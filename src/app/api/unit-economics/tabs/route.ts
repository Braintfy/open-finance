// PURPOSE: API для управления вкладками Юнит-экономики (CRUD).
// GET    — список вкладок (seed дефолтов если пусто).
// POST   — создать новую custom-вкладку (опционально клонировать существующую).

import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { listTabs, createTab } from '@/lib/unit-economics/tabs-queries';

export async function GET() {
  const session = await auth();
  if (!session?.tenantId || !session?.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const tabs = await listTabs({
    tenantId: session.tenantId,
    userId: session.userId,
  });
  return NextResponse.json({ ok: true, tabs });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.tenantId || !session?.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Bad payload' }, { status: 400 });
  }
  const payload = body as {
    label?: string;
    icon?: string | null;
    cloneFromPageKey?: string;
  };
  const label = (payload.label ?? '').trim();
  if (!label) {
    return NextResponse.json({ ok: false, error: 'label required' }, { status: 400 });
  }
  if (label.length > 80) {
    return NextResponse.json({ ok: false, error: 'label too long' }, { status: 400 });
  }
  const tab = await createTab({
    tenantId: session.tenantId,
    userId: session.userId,
    label,
    icon: payload.icon ?? null,
    cloneFromPageKey:
      typeof payload.cloneFromPageKey === 'string' && payload.cloneFromPageKey
        ? payload.cloneFromPageKey
        : undefined,
  });
  return NextResponse.json({ ok: true, tab });
}
