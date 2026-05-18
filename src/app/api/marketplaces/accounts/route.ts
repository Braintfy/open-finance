// PURPOSE: GET /api/marketplaces/accounts — список аккаунтов tenant'а;
//          POST — создание нового (с проверкой plan-gate).
//
// Никогда не возвращаем расшифрованный api_key. На клиент идёт `apiKeyMasked`.

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import {
  canAddAccount,
  createAccount,
  listAccounts,
  toPublicAccount,
} from '@/lib/marketplaces/queries';
import { CreateAccountSchema } from '@/lib/marketplaces/types';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const marketplaceRaw = url.searchParams.get('marketplace') ?? undefined;
    const marketplace =
      marketplaceRaw && ['ozon', 'yandex', 'wb'].includes(marketplaceRaw)
        ? (marketplaceRaw as 'ozon' | 'yandex' | 'wb')
        : undefined;

    const accounts = await listAccounts({
      tenantId: session.tenantId,
      marketplace,
    });
    return NextResponse.json({
      ok: true,
      accounts: accounts.map(toPublicAccount),
    });
  } catch (e) {
    console.error('[marketplaces] GET /accounts failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed to list accounts' },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.tenantId || !session.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    let body: z.infer<typeof CreateAccountSchema>;
    try {
      body = CreateAccountSchema.parse(await req.json());
    } catch (e) {
      const msg = e instanceof z.ZodError ? e.issues[0]?.message : 'Invalid body';
      return NextResponse.json({ ok: false, error: msg }, { status: 400 });
    }

    const gate = await canAddAccount({
      tenantId: session.tenantId,
      marketplace: body.marketplace,
    });
    if (!gate.allowed) {
      return NextResponse.json(
        { ok: false, error: gate.reason ?? 'Лимит на количество магазинов' },
        { status: 402 },
      );
    }

    const account = await createAccount({
      tenantId: session.tenantId,
      userId: session.userId,
      marketplace: body.marketplace,
      name: body.name,
      clientId: body.clientId,
      apiKey: body.apiKey,
      perfClientId: body.perfClientId ?? null,
      perfClientSecret: body.perfClientSecret ?? null,
      syncSettings: body.syncSettings,
    });
    return NextResponse.json({ ok: true, account: toPublicAccount(account) });
  } catch (e) {
    console.error('[marketplaces] POST /accounts failed:', e);
    const msg = e instanceof Error ? e.message : 'Failed to create account';
    const isMissingTable = /relation .*marketplace_accounts.* does not exist/i.test(msg);
    return NextResponse.json(
      {
        ok: false,
        error: isMissingTable
          ? 'Таблица marketplace_accounts не создана. Применить SQL: docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/07-marketplaces.sql'
          : msg,
      },
      { status: isMissingTable ? 503 : 500 },
    );
  }
}
