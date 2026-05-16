// PURPOSE: POST /api/marketplaces/accounts/[id]/test — проверка
// подключения к Ozon API через /v1/seller/info. Возвращает короткий
// summary компании или текст ошибки.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import {
  decryptAccountApiKey,
  getAccount,
  updateAccount,
} from '@/lib/marketplaces/queries';
import { OzonClient } from '@/lib/marketplaces/ozon/client';
import { sellerInfo } from '@/lib/marketplaces/ozon/endpoints';

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

    if (account.marketplace !== 'ozon') {
      return NextResponse.json(
        { ok: false, error: 'Тест поддерживается только для Ozon в текущей версии.' },
        { status: 400 },
      );
    }

    const apiKey = decryptAccountApiKey(account);
    const client = new OzonClient({ clientId: account.clientId, apiKey });

    try {
      const info = await sellerInfo(client);
      const companyInfo = (info.result ?? {}) as Record<string, unknown>;
      await updateAccount({
        tenantId: session.tenantId,
        id,
        patch: { status: 'active', companyInfo },
      });
      return NextResponse.json({ ok: true, companyInfo });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connection failed';
      await updateAccount({
        tenantId: session.tenantId,
        id,
        patch: { status: 'error' },
      });
      return NextResponse.json({ ok: false, error: msg }, { status: 502 });
    }
  } catch (e) {
    console.error('[marketplaces] POST /accounts/[id]/test failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
