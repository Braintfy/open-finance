// PURPOSE: GET/POST /api/workspaces — список и создание кабинетов (воркспейсов).
// GET  — все кабинеты пары (tenant,user) + id активного (для переключателя).
// POST — создать кабинет: пустой ('blank'), из шаблона ('seller-ozon') или
//        клон текущего (cloneFromWorkspaceId — копия всех block_layouts).
//
// Раскладки шаблона НЕ материализуются INSERT'ами: новый кабинет пуст в БД и
// рисуется код-дефолтом getDefaultLayout(pageKey, template) — см.
// src/lib/blocks/default-layouts.ts.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { createWorkspace, listWorkspaces } from '@/lib/workspaces/queries';
import { getWorkspaceScope } from '@/lib/workspaces/active';
import {
  DEFAULT_WORKSPACE_TEMPLATE,
  WORKSPACE_TEMPLATE_IDS,
} from '@/lib/blocks/default-layouts';

const CreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  template: z.enum(WORKSPACE_TEMPLATE_IDS).optional(),
  cloneFromWorkspaceId: z.string().uuid().optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const [workspaces, scope] = await Promise.all([
      listWorkspaces({ tenantId: session.tenantId, userId: session.userId }),
      getWorkspaceScope(session.tenantId, session.userId),
    ]);
    return NextResponse.json({
      ok: true,
      workspaces,
      activeId: scope.activeId,
      defaultId: scope.defaultId,
    });
  } catch (error) {
    console.error('[api/workspaces] GET failed:', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}

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
  const body = CreateBody.safeParse(json);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? 'Bad request' },
      { status: 400 },
    );
  }

  try {
    // Клон наследует шаблон источника неявно: template нужен только для
    // код-дефолтов страниц, которых у клона не будет (все скопированы).
    const workspace = await createWorkspace({
      tenantId: session.tenantId,
      userId: session.userId,
      name: body.data.name,
      template: body.data.template ?? DEFAULT_WORKSPACE_TEMPLATE,
      cloneFromWorkspaceId: body.data.cloneFromWorkspaceId,
    });
    return NextResponse.json({ ok: true, workspace });
  } catch (error) {
    console.error('[api/workspaces] POST failed:', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
