// PURPOSE: Тонкий клиент /api/stock/* для блоков и диалогов склада.
// Один разбор ответа на весь модуль: роуты всегда отдают {ok:boolean,error?},
// а без терпимого парсинга HTML-500 от Next превращается в
// «Unexpected end of JSON input» прямо в UI (drizzle.mdc).
//
// Деньги живут в чистом src/lib/stock/money.ts (его же гоняет
// scripts/test-stock-money.ts) и ре-экспортируются отсюда, чтобы у модуля был
// ОДИН парсер и ОДИН форматтер — см. комментарий в money.ts.

'use client';

export {
  formatMoney,
  kopecksToRublesInput,
  linesTotalKopecks,
  parseQty,
  rublesToKopecks,
} from '@/lib/stock/money';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

export async function stockFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      ...init,
      headers:
        init?.body != null
          ? { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }
          : init?.headers,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return {
        ok: false,
        error: `Сервер вернул не JSON (HTTP ${res.status}). Проверьте логи роута.`,
      };
    }
    const body = (json ?? {}) as { ok?: boolean; error?: string };
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error ?? `HTTP ${res.status}` };
    }
    return { ok: true, data: body as T };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Сеть недоступна' };
  }
}

