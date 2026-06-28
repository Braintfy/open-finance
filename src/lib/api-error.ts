// PURPOSE: Единый ответ на непредвиденные (5xx) ошибки в API-роутах.
// Логирует полную ошибку на сервере, наружу отдаёт нейтральное сообщение —
// чтобы текст ошибок Postgres/Drizzle (имена таблиц/колонок/constraint) и
// стектрейсы не утекали клиенту (CWE-209).
//
// Использовать ТОЛЬКО для catch/непредвиденных ошибок. Явные 4xx
// (Unauthorized, Not found, ошибки zod-валидации) возвращать как есть —
// они безопасны и полезны для UX.

import { NextResponse } from 'next/server';

/**
 * @param context метка для лога, например '[marketplaces] GET /ozon/kpi'
 * @param e пойманная ошибка (логируется целиком, наружу не уходит)
 * @param status HTTP-статус (по умолчанию 500; для upstream — 502)
 */
export function apiError(context: string, e: unknown, status = 500): NextResponse {
  console.error(`${context} failed:`, e);
  return NextResponse.json({ ok: false, error: 'Internal error' }, { status });
}

/**
 * Чистый нейтральный 5xx-ответ БЕЗ логирования — для catch-блоков, где
 * контекстный `console.error(...)` уже стоит выше. Не отдаёт `e.message`.
 */
export function internalError(status = 500): NextResponse {
  return NextResponse.json({ ok: false, error: 'Internal error' }, { status });
}
