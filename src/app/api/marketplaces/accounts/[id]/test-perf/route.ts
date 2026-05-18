// PURPOSE: POST /api/marketplaces/accounts/[id]/test-perf — пробный
// OAuth-запрос для Performance API. Если получаем access_token —
// возвращаем ok+expiresIn. Не логируем секрет ни при каких условиях.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  decryptAccountPerfSecret,
  getAccount,
  updateAccountPerfStatus,
} from '@/lib/marketplaces/queries';
import { OzonPerformanceClient } from '@/lib/marketplaces/ozon/performance/client';

export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: RouteCtx) {
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
    if (!account.perfClientId || !account.perfClientSecretEnc) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Performance API не подключён для этого аккаунта.',
        },
        { status: 400 },
      );
    }

    const secret = decryptAccountPerfSecret(account);
    if (!secret) {
      return NextResponse.json(
        { ok: false, error: 'Не удалось расшифровать perf-secret' },
        { status: 500 },
      );
    }

    const client = new OzonPerformanceClient({
      accountId: account.id,
      clientId: account.perfClientId,
      clientSecret: secret,
    });

    try {
      await client.getAccessToken();
      await updateAccountPerfStatus({
        tenantId: session.tenantId,
        id,
        status: 'active',
        error: null,
        lastSyncAt: account.perfLastSyncAt,
      });
      // expiresIn нам не возвращается напрямую (кэшируется в client), вернём
      // приблизительно — Performance выписывает 1800 сек.
      return NextResponse.json({ ok: true, expiresIn: 1800 });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      await updateAccountPerfStatus({
        tenantId: session.tenantId,
        id,
        status: 'error',
        error: message,
      });
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
  } catch (e) {
    console.error('[marketplaces] POST /accounts/[id]/test-perf failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
