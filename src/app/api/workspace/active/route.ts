// PURPOSE: POST /api/workspace/active — переключить активный кабинет.
// Персист двойной: httpOnly-кука `of_active_workspace` (читают RSC на каждый
// запрос) + users.settings.activeWorkspaceId (переживает очистку кук).
// Клиент после ответа делает router.refresh() — RSC перечитывают раскладки.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { setActiveWorkspace } from '@/lib/workspaces/queries';
import { WORKSPACE_COOKIE } from '@/lib/workspaces/scope';

const Body = z.object({ workspaceId: z.string().uuid() });

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  const body = Body.safeParse(json);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? 'Bad request' },
      { status: 400 },
    );
  }

  try {
    // Проверка принадлежности кабинета паре (tenant,user) внутри setActiveWorkspace.
    const ok = await setActiveWorkspace({
      tenantId: session.tenantId,
      userId: session.userId,
      workspaceId: body.data.workspaceId,
    });
    if (!ok) {
      return NextResponse.json({ ok: false, error: 'Кабинет не найден' }, { status: 404 });
    }

    const res = NextResponse.json({ ok: true, activeId: body.data.workspaceId });
    res.cookies.set({
      name: WORKSPACE_COOKIE,
      value: body.data.workspaceId,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: process.env.NODE_ENV === 'production',
      maxAge: ONE_YEAR_SECONDS,
    });
    return res;
  } catch (error) {
    console.error('[api/workspace/active] POST failed:', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
