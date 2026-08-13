// PURPOSE: GET /api/stock/balances — данные блока stock.balances (§7 блок 1).
// Возвращает UNION двух источников: журнал по ledger-местам + агрегат
// ozon_warehouse_stocks по FBO/FBS (§6.2), плюс группу «Не сопоставлено»
// и (по запросу) карантин продаж без себестоимости.
//
// ?search=&brand=&onlyLow=1&hideZero=1&quarantine=1&from=&to=

import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantRoute } from '@/lib/auth/guards';
import {
  ensureStockSetup,
  getStockBalances,
  getStockQuarantine,
  todayIsoDate,
  type StockQuarantine,
} from '@/lib/stock/queries';
import { stockErrorResponse } from '@/lib/stock/http';

export type StockBalancesResponse = Awaited<ReturnType<typeof getStockBalances>> & {
  ok: true;
  quarantine: StockQuarantine | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };
    const url = new URL(req.url);

    // Первый вход в раздел: без мест блок не сможет показать ни одной колонки.
    await ensureStockSetup(ctx);

    const balances = await getStockBalances(ctx, {
      search: url.searchParams.get('search') ?? undefined,
      brand: url.searchParams.get('brand') ?? undefined,
      onlyLow: url.searchParams.get('onlyLow') === '1',
      hideZero: url.searchParams.get('hideZero') === '1',
      includeInactive: url.searchParams.get('includeInactive') === '1',
      limit: Number(url.searchParams.get('limit') ?? 1000),
    });

    let quarantine: StockQuarantine | null = null;
    if (url.searchParams.get('quarantine') === '1') {
      const fromRaw = url.searchParams.get('from');
      const toRaw = url.searchParams.get('to');
      const to = toRaw && DATE_RE.test(toRaw) ? toRaw : todayIsoDate();
      const from =
        fromRaw && DATE_RE.test(fromRaw)
          ? fromRaw
          : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      quarantine = await getStockQuarantine(ctx, { from, to });
    }

    return NextResponse.json({ ok: true, ...balances, quarantine });
  } catch (error) {
    return stockErrorResponse('balances', error);
  }
}
