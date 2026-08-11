// PURPOSE: PATCH/DELETE /api/workspaces/[id] — переименование и удаление кабинета.
// PATCH  — {name}. slug стабилен (ссылки не ломаем).
// DELETE — запрещено удалять последний и default-кабинет (409 с причиной,
//          UI показывает человекочитаемое сообщение).

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { deleteWorkspace, renameWorkspace } from '@/lib/workspaces/queries';
import { WORKSPACE_COOKIE } from '@/lib/workspaces/scope';

type Ctx = { params: Promise<{ id: string }> };

const IdSchema = z.string().uuid();
const PatchBody = z.object({ name: z.string().trim().min(1).max(120) });

const DELETE_REASON_MESSAGE: Record<string, string> = {
  not_found: 'Кабинет не найден',
  last: 'Нельзя удалить единственный кабинет',
  is_default: 'Нельзя удалить кабинет по умолчанию',
};

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { id: rawId } = await ctx.params;
  const id = IdSchema.safeParse(rawId);
  if (!id.success) {
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const body = PatchBody.safeParse(json);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? 'Bad request' },
      { status: 400 },
    );
  }

  try {
    const workspace = await renameWorkspace({
      tenantId: session.tenantId,
      userId: session.userId,
      id: id.data,
      name: body.data.name,
    });
    if (!workspace) {
      return NextResponse.json({ ok: false, error: 'Кабинет не найден' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, workspace });
  } catch (error) {
    console.error('[api/workspaces/:id] PATCH failed:', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { id: rawId } = await ctx.params;
  const id = IdSchema.safeParse(rawId);
  if (!id.success) {
    return NextResponse.json({ ok: false, error: 'Invalid id' }, { status: 400 });
  }

  try {
    const result = await deleteWorkspace({
      tenantId: session.tenantId,
      userId: session.userId,
      id: id.data,
    });
    if (!result.deleted) {
      const reason = result.reason ?? 'not_found';
      return NextResponse.json(
        { ok: false, reason, error: DELETE_REASON_MESSAGE[reason] ?? 'Не удалось удалить' },
        { status: reason === 'not_found' ? 404 : 409 },
      );
    }
    const res = NextResponse.json({ ok: true });
    // Кука могла указывать на удалённый кабинет — чистим сразу (иначе резолв
    // отработает фолбэком, но лишним запросом на каждый рендер).
    const cookieId = (await cookies()).get(WORKSPACE_COOKIE)?.value;
    if (cookieId === id.data) {
      res.cookies.set({
        name: WORKSPACE_COOKIE,
        value: '',
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
    }
    return res;
  } catch (error) {
    console.error('[api/workspaces/:id] DELETE failed:', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
