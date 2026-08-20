// PURPOSE: GET /api/stock/expiry — партии с истекающим сроком для блока
// stock.expiry (§7 блок 5). Для БАДов это самый дешёвый способ окупить модуль:
// просрочка видна ДО того, как станет списанием.
//
// ?horizon=90&critical=14&limit=300
//
// limit — потолок ВИТРИНЫ. Суммы и счётчики считаются отдельным SQL-агрегатом
// по всем партиям под фильтр, поэтому «Деньги под риском» от лимита не зависят;
// признак усечения приходит полями totalCount/truncated.
//
// Списание отсюда идёт обычным документом через /api/stock/docs
// ({kind:'writeoff', reason:'expired', post:true}). Отдельной «проводки партии»
// нет специально, иначе появился бы второй путь списания со своей арифметикой.
// Конкретную партию выбирает движок по lot_policy (fefo|fifo) — она отдаётся в
// ответе, чтобы блок не выдумывал за движок, какая партия уйдёт.

import { NextResponse, type NextRequest } from 'next/server';
import { requireTenantRoute } from '@/lib/auth/guards';
import { ensureStockSetup, getExpiringBatches } from '@/lib/stock/queries';
import { stockErrorResponse } from '@/lib/stock/http';

export type StockExpiryResponse = Awaited<ReturnType<typeof getExpiringBatches>> & {
  ok: true;
};

export async function GET(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };
    const url = new URL(req.url);

    await ensureStockSetup(ctx);

    const result = await getExpiringBatches(ctx, {
      horizonDays: Number(url.searchParams.get('horizon') ?? 90),
      criticalDays: Number(url.searchParams.get('critical') ?? 14),
      limit: Number(url.searchParams.get('limit') ?? 300),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return stockErrorResponse('expiry', error);
  }
}
