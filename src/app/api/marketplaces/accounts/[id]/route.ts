// PURPOSE: GET/PATCH/DELETE одного marketplace-аккаунта.
// PATCH принимает только разрешённые поля (см. UpdateAccountSchema).
// apiKey шифруется в queries.updateAccount; в ответе никогда не отдаём raw.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireTenantRoute } from '@/lib/auth/guards';
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
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const account = await getAccount({ tenantId: t.ctx.tenantId, id });
    if (!account) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, account: toPublicAccount(account) });
  } catch (e) {
    console.error('[marketplaces] GET /accounts/[id] failed:', e);
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;

    let body: z.infer<typeof UpdateAccountSchema>;
    try {
      body = UpdateAccountSchema.parse(await req.json());
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues[0]?.message : 'Invalid body';
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }

    const updated = await updateAccount({
      tenantId: t.ctx.tenantId,
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
      { ok: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    await deleteAccount({ tenantId: t.ctx.tenantId, id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[marketplaces] DELETE /accounts/[id] failed:', e);
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}
