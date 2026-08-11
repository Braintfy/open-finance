// PURPOSE: API для одной вкладки Юнит-экономики.
// PATCH — переименовать (label, icon).
// DELETE — soft-delete default или hard-delete custom (+ cascade блоков).

import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { renameTab, deleteTab } from '@/lib/unit-economics/tabs-queries';
import { getActiveWorkspacePageScope } from '@/lib/workspaces/active';

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.tenantId || !session?.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await ctx.params;
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ ok: false, error: 'Bad payload' }, { status: 400 });
    }
    const payload = body as { label?: string; icon?: string | null };
    const label = (payload.label ?? '').trim();
    if (!label) {
      return NextResponse.json({ ok: false, error: 'label required' }, { status: 400 });
    }
    if (label.length > 80) {
      return NextResponse.json({ ok: false, error: 'label too long' }, { status: 400 });
    }
    const tab = await renameTab({
      tenantId: session.tenantId,
      userId: session.userId,
      id,
      label,
      icon: payload.icon ?? undefined,
    });
    if (!tab) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, tab });
  } catch (error) {
    console.error('[api/unit-economics/tabs/:id] PATCH failed:', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const session = await auth();
    if (!session?.tenantId || !session?.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await ctx.params;
    const workspace = await getActiveWorkspacePageScope(session.tenantId, session.userId);
    const result = await deleteTab({
      tenantId: session.tenantId,
      userId: session.userId,
      id,
      workspace,
    });
    if (!result.deleted) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, kind: result.kind });
  } catch (error) {
    console.error('[api/unit-economics/tabs/:id] DELETE failed:', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
