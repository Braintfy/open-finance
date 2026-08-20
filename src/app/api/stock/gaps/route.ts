// PURPOSE: GET /api/stock/gaps — единый карантин для блока stock.gaps
// (§7 блок 6, инвариант §1.10 «молчаливого нуля не бывает»): продажи без
// сшивки и без себестоимости (с суммой выручки), позиции канала без товара,
// товары с остатком но без цены, отрицательные пулы, непокрытые движения и
// открытые расхождения сверки.
//
// ?from=YYYY-MM-DD&to=YYYY-MM-DD (по умолчанию — последние 30 дней по МСК)

import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantRoute } from '@/lib/auth/guards';
import { ensureStockSetup, getStockGaps, todayIsoDate } from '@/lib/stock/queries';
import { shiftIsoDate } from '@/lib/marketplaces/ozon/sync/perf-period';
import { stockErrorResponse } from '@/lib/stock/http';

export type StockGapsResponse = Awaited<ReturnType<typeof getStockGaps>> & { ok: true };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };
    const url = new URL(req.url);

    await ensureStockSetup(ctx);

    const toRaw = url.searchParams.get('to');
    const fromRaw = url.searchParams.get('from');
    // Границы — календарные дни МОСКВЫ (как фильтр ленты документов).
    const to = toRaw && DATE_RE.test(toRaw) ? toRaw : todayIsoDate();
    const from = fromRaw && DATE_RE.test(fromRaw) ? fromRaw : shiftIsoDate(to, -29);

    const result = await getStockGaps(ctx, { from, to });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return stockErrorResponse('gaps', error);
  }
}
