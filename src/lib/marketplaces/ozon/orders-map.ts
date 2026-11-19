// PURPOSE: Чистый маппинг отправлений Ozon (/v4/posting/fbs/list, /v3/posting/fbo/list)
// в строки ozon_orders + cursor-пагинация. Без импорта db — тестируется офлайн
// (scripts/test-ozon-orders-map.ts).
//
// Формат дат по справочнику Ozon: RFC3339 date-time в UTC («2026-05-04T06:44:37Z»).
// Способ записи времени в БД здесь НЕ меняется (отдельная задача): Date из строки как есть.

import type { FbsPosting, FboPosting } from './types';

/** Позиция в ozon_orders.items (jsonb). `price` — строка-число в рублях (читают SQL `it->>'price'`). */
export type OrderItem = {
  sku: number;
  offerId: string;
  name?: string;
  quantity: number;
  price: string;
};

export type MappedOrder = {
  postingNumber: string;
  scheme: 'fbs' | 'fbo';
  status: string;
  orderCreatedAt: Date | null;
  cancelledAt: Date | null;
  items: OrderItem[];
};

export type MapResult =
  | { ok: true; order: MappedOrder }
  | { ok: false; postingNumber: string; reason: string };

/**
 * Цена: FBO — строка «29990.00» (или число), FBS v4 — `{ amount: "300", currency }`
 * (amount — строка или число). Конечное число ≥ 0 → строка-рубли; иначе null.
 */
export function moneyToAmountString(price: unknown): string | null {
  const raw =
    typeof price === 'string' || typeof price === 'number'
      ? price
      : price && typeof price === 'object'
        ? (price as { amount?: unknown }).amount
        : undefined;
  if (typeof raw === 'number') {
    // String(1e21) = '1e+21' — экспонента в jsonb сломала бы ::numeric-чтение.
    if (!Number.isFinite(raw) || raw < 0) return null;
    const s = String(raw);
    return PLAIN_DECIMAL_RE.test(s) ? s : null;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // Только десятичная запись: Number() принял бы '0x10' / '1e3' / 'Infinity',
  // а SQL `(it->>'price')::numeric` на '0x10' падает.
  if (!PLAIN_DECIMAL_RE.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? trimmed : null;
}

/** Неотрицательное десятичное число без знака, экспоненты и hex: «300», «29990.00». */
const PLAIN_DECIMAL_RE = /^\d+(?:\.\d+)?$/;

/** Целое из number | string (int64 в grpc-gateway приходит строкой). null = мусор. */
export function parseIntLike(v: unknown, min: number): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\d+$/.test(v.trim())) n = Number(v.trim());
  else return null;
  return Number.isSafeInteger(n) && n >= min ? n : null;
}

/** Максимальная длина окна дат у методов списков отправлений (год). */
export const MAX_WINDOW_DAYS = 365;

/**
 * Режет [since, to] на последовательные куски ≤ maxDays (границы смежные: конец
 * куска = начало следующего; дубль на границе гасит идемпотентный upsert).
 * to <= since — один кусок как есть (решение за API).
 */
export function splitDateWindow(
  since: Date,
  to: Date,
  maxDays: number = MAX_WINDOW_DAYS,
): Array<{ since: Date; to: Date }> {
  const step = maxDays * 24 * 60 * 60 * 1000;
  if (!(to.getTime() > since.getTime()) || !(step > 0)) return [{ since, to }];
  const out: Array<{ since: Date; to: Date }> = [];
  let start = since.getTime();
  const end = to.getTime();
  while (start < end) {
    const stop = Math.min(start + step, end);
    out.push({ since: new Date(start), to: new Date(stop) });
    start = stop;
  }
  return out;
}

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

type RawPosting = {
  posting_number?: unknown;
  status?: unknown;
  products?: unknown;
};

function mapItems(p: RawPosting): { items: OrderItem[] } | { error: string } {
  if (!Array.isArray(p.products)) return { error: 'нет массива products' };
  const items: OrderItem[] = [];
  for (const [i, raw] of (p.products as Array<Record<string, unknown>>).entries()) {
    const price = moneyToAmountString(raw?.price);
    if (price === null) return { error: `products[${i}].price отсутствует или не число` };
    const sku = parseIntLike(raw.sku, 1);
    if (sku === null) return { error: `products[${i}].sku не целое > 0` };
    const quantity = parseIntLike(raw.quantity, 0);
    if (quantity === null) return { error: `products[${i}].quantity не целое ≥ 0` };
    items.push({
      sku,
      offerId: typeof raw.offer_id === 'string' ? raw.offer_id : '',
      name: typeof raw.name === 'string' ? raw.name : undefined,
      quantity,
      price,
    });
  }
  return { items };
}

function mapCommon(
  p: RawPosting,
  scheme: 'fbs' | 'fbo',
): { postingNumber: string; status: string; items: OrderItem[] } | { postingNumber: string; error: string } {
  const postingNumber = typeof p.posting_number === 'string' ? p.posting_number : '';
  if (!postingNumber) return { postingNumber: '?', error: `${scheme}: нет posting_number` };
  if (typeof p.status !== 'string') return { postingNumber, error: 'нет status' };
  const it = mapItems(p);
  if ('error' in it) return { postingNumber, error: it.error };
  return { postingNumber, status: p.status, items: it.items };
}

export function mapFbsPosting(p: FbsPosting): MapResult {
  const c = mapCommon(p, 'fbs');
  if ('error' in c) return { ok: false, postingNumber: c.postingNumber, reason: c.error };
  return {
    ok: true,
    order: {
      postingNumber: c.postingNumber,
      scheme: 'fbs',
      status: c.status,
      // v4 FBS в примере справочника отдаёт in_process_at (created_at нет) — fallback сохранён.
      orderCreatedAt: parseDate(p.created_at) ?? parseDate(p.in_process_at),
      cancelledAt: parseDate(p.cancellation?.cancelled_at),
      items: c.items,
    },
  };
}

export function mapFboPosting(p: FboPosting): MapResult {
  const c = mapCommon(p, 'fbo');
  if ('error' in c) return { ok: false, postingNumber: c.postingNumber, reason: c.error };
  return {
    ok: true,
    order: {
      postingNumber: c.postingNumber,
      scheme: 'fbo',
      status: c.status,
      orderCreatedAt: parseDate(p.created_at) ?? parseDate(p.in_process_at),
      cancelledAt: null,
      items: c.items,
    },
  };
}

export type PostingPage<T> = { postings?: T[]; has_next?: boolean; cursor?: string };

/** Верхняя граница страниц (100 шт/стр): защита от бесконечного цикла при кривом cursor. */
export const MAX_POSTING_PAGES = 2000;

/**
 * Cursor-пагинация до конца. Останавливается при has_next=false, пустой странице
 * или пустом cursor; повтор того же cursor или превышение MAX_POSTING_PAGES — ошибка
 * (а не тихий обрыв). Ответ без массива `postings` — тоже ошибка (смена контракта).
 */
export async function forEachPostingPage<T>(
  fetchPage: (cursor: string) => Promise<PostingPage<T>>,
  onPage: (postings: T[]) => Promise<void>,
): Promise<{ pages: number }> {
  let cursor = '';
  const seen = new Set<string>();
  let pages = 0;
  while (true) {
    const res = await fetchPage(cursor);
    if (!res || !Array.isArray(res.postings)) {
      throw new Error('ответ без массива postings (контракт метода изменился?)');
    }
    if (typeof res.has_next !== 'boolean') {
      throw new Error('в ответе нет has_next (boolean) — полнота выборки неизвестна (контракт изменился?)');
    }
    pages += 1;
    await onPage(res.postings);
    if (!res.has_next || res.postings.length === 0) break;
    const next = res.cursor ?? '';
    if (next === '') throw new Error('has_next=true, но cursor пуст — данные неполные');
    if (seen.has(next) || next === cursor) {
      throw new Error('cursor не продвигается (has_next=true, cursor повторился)');
    }
    if (pages >= MAX_POSTING_PAGES) {
      throw new Error(`превышен лимит страниц (${MAX_POSTING_PAGES})`);
    }
    seen.add(next);
    cursor = next;
  }
  return { pages };
}
