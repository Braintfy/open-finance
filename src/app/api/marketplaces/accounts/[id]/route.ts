// PURPOSE: GET/PATCH/DELETE одного marketplace-аккаунта.
// PATCH принимает только разрешённые поля (см. UpdateAccountSchema).
// apiKey шифруется в queries.updateAccount; в ответе никогда не отдаём raw.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import {
  deleteAccount,
  getAccount,
  toPublicAccount,
  updateAccount,
} from '@/lib/marketplaces/queries';
import { UpdateAccountSchema } from '@/lib/marketplaces/types';

export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const account = await getAccount({ tenantId: session.tenantId, id });
    if (!account) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, account: toPublicAccount(account) });
  } catch (e) {
    console.error('[marketplaces] GET /accounts/[id] failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    let body: z.infer<typeof UpdateAccountSchema>;
    try {
      body = UpdateAccountSchema.parse(await req.json());
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues[0]?.message : 'Invalid body';
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }

    const updated = await updateAccount({
      tenantId: session.tenantId,
      id,
      patch: body,
    });
    if (!updated) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, account: toPublicAccount(updated) });
  } catch (e) {
    console.error('[marketplaces] PATCH /accounts/[id] failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    await deleteAccount({ tenantId: session.tenantId, id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[marketplaces] DELETE /accounts/[id] failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
