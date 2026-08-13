// PURPOSE: Общий разбор ошибок для роутов /api/stock/*. Держит два инварианта
// сразу: (1) StockError несёт свой HTTP-статус (403 «период закрыт», 409 «уже
// проведён», 404, 501 «это Релиз 2») и текст, готовый к показу человеку;
// (2) любая другая ошибка отдаётся как 500 с {ok:false,error} — без этого Next
// вернёт HTML-500 и клиент упадёт на `Unexpected end of JSON input` (drizzle.mdc).

import { NextResponse } from 'next/server';
import { StockError } from './posting';

export function stockErrorResponse(scope: string, error: unknown): NextResponse {
  if (error instanceof StockError) {
    return NextResponse.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status },
    );
  }
  console.error(`[api/stock/${scope}]`, error);
  return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
}
