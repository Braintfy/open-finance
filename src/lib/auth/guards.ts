// PURPOSE: Tenant-scope guard (I1 review-gate). Единственный канонический способ
// получить tenant-контекст в API-роутах / server actions / RSC. ЛЮБОЙ запрос к
// tenant-таблице ОБЯЗАН использовать tenantId, полученный отсюда (а не из тела
// запроса/params). Правила и чек-лист: docs/TENANT_SCOPING.md.
import { NextResponse } from 'next/server';
import { getSession } from './actions';
import type { SessionPayload } from './session';

export type TenantContext = {
  userId: string;
  tenantId: string;
  email: string;
  globalRole: SessionPayload['globalRole'];
};

export class TenantAuthError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'TenantAuthError';
  }
}

/**
 * Server actions / RSC / lib: вернуть tenant-контекст или бросить TenantAuthError.
 * tenantId гарантированно определён в возвращаемом контексте.
 */
export async function requireTenant(): Promise<TenantContext> {
  const session = await getSession();
  if (!session?.tenantId) {
    throw new TenantAuthError();
  }
  return {
    userId: session.userId,
    tenantId: session.tenantId,
    email: session.email,
    globalRole: session.globalRole,
  };
}

/**
 * API routes: дискриминированный результат — без throw.
 *   const t = await requireTenantRoute();
 *   if (!t.ok) return t.response;   // 401 JSON
 *   // t.ctx.tenantId — всегда определён, использовать в WHERE tenant_id = ...
 */
export async function requireTenantRoute(): Promise<
  { ok: true; ctx: TenantContext } | { ok: false; response: NextResponse }
> {
  try {
    const ctx = await requireTenant();
    return { ok: true, ctx };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 }),
    };
  }
}
