// PURPOSE: Единый ключ товара (item_key) и резолв сшивки «товар канала → внутренний товар склада».
// Чистый модуль: индекс строится один раз из строк stock_item_links, поиск — O(1).
// Порядок поиска (аккаунт точнее общего '-') зафиксирован в docs/METRICS_LAYER_DESIGN.md §5.

export type ItemKeyKind = 'offer' | 'sku' | 'item' | 'none';

const SKU_PREFIX = 'sku:';
const ITEM_PREFIX = 'item:';
const OFFER_PREFIX = 'offer:';

/**
 * offer_id → сам; иначе sku:<n>; иначе item:<id>; иначе ''.
 * Если сам offer_id похож на служебный префикс, он кодируется как offer:<значение>,
 * иначе parseItemKey принял бы артикул продавца за sku/склад.
 */
export function makeItemKey(input: {
  offerId?: string | null;
  sku?: string | number | null;
  stockItemId?: string | null;
}): string {
  const offer = (input.offerId ?? '').trim();
  if (offer !== '') {
    if (
      offer.startsWith(SKU_PREFIX) ||
      offer.startsWith(ITEM_PREFIX) ||
      offer.startsWith(OFFER_PREFIX)
    ) {
      return OFFER_PREFIX + offer;
    }
    return offer;
  }
  const sku = input.sku === null || input.sku === undefined ? '' : String(input.sku).trim();
  if (sku !== '') return SKU_PREFIX + sku;
  const item = (input.stockItemId ?? '').trim();
  if (item !== '') return ITEM_PREFIX + item;
  return '';
}

export function parseItemKey(key: string): { kind: ItemKeyKind; value: string } {
  if (key === '') return { kind: 'none', value: '' };
  if (key.startsWith(SKU_PREFIX)) return { kind: 'sku', value: key.slice(SKU_PREFIX.length) };
  if (key.startsWith(ITEM_PREFIX)) return { kind: 'item', value: key.slice(ITEM_PREFIX.length) };
  if (key.startsWith(OFFER_PREFIX)) return { kind: 'offer', value: key.slice(OFFER_PREFIX.length) };
  return { kind: 'offer', value: key };
}

export interface LinkRow {
  itemId: string;
  channel: string;
  scopeKey: string;
  externalId: string;
  externalSku: string | null;
  qtyPerUnit: number;
}

interface IndexedLink {
  itemId: string;
  qtyPerUnit: number;
}

export interface LinkIndex {
  readonly byId: ReadonlyMap<string, IndexedLink>;
  readonly bySku: ReadonlyMap<string, IndexedLink>;
}

export interface ResolvedLink {
  itemId: string;
  qtyPerUnit: number;
  via: 'account_id' | 'shared_id' | 'account_sku' | 'shared_sku' | 'item_key';
}

/** NUL не встречается в реальных ключах — безопасный разделитель составного ключа. */
function k(channel: string, scopeKey: string, value: string): string {
  return `${channel}\u0000${scopeKey}\u0000${value}`;
}

/** Мусор в qty_per_unit (0, дробь, NaN) не должен ронять расчёт — считаем 1 штуку. */
function sanitizeQty(q: number): number {
  return Number.isInteger(q) && q >= 1 ? q : 1;
}

export function buildLinkIndex(links: readonly LinkRow[]): LinkIndex {
  const byId = new Map<string, IndexedLink>();
  const bySku = new Map<string, IndexedLink>();
  for (const l of links) {
    const value: IndexedLink = { itemId: l.itemId, qtyPerUnit: sanitizeQty(l.qtyPerUnit) };
    // trim симметричен makeItemKey: пробелы вокруг артикула не должны ломать попадание.
    const extId = l.externalId.trim();
    if (extId !== '') {
      const idKey = k(l.channel, l.scopeKey, extId);
      // Первая по порядку входа побеждает — детерминизм при дублях.
      if (!byId.has(idKey)) byId.set(idKey, value);
    }
    const sku = (l.externalSku ?? '').trim();
    if (sku !== '') {
      const skuKey = k(l.channel, l.scopeKey, sku);
      if (!bySku.has(skuKey)) bySku.set(skuKey, value);
    }
  }
  return { byId, bySku };
}

export function resolveLink(
  index: LinkIndex,
  q: { channel: string; scopeKey: string; itemKey: string; externalSku?: string | null },
): ResolvedLink | null {
  const parsed = parseItemKey(q.itemKey);
  if (parsed.kind === 'none') return null;
  if (parsed.kind === 'item') {
    // Ключ уже внутренний (складские документы) — индекс не нужен.
    return parsed.value !== '' ? { itemId: parsed.value, qtyPerUnit: 1, via: 'item_key' } : null;
  }

  const externalId = parsed.kind === 'offer' ? parsed.value : '';
  const explicitSku = (q.externalSku ?? '').trim();
  const externalSku = explicitSku !== '' ? explicitSku : parsed.kind === 'sku' ? parsed.value : '';

  if (externalId !== '') {
    const a = index.byId.get(k(q.channel, q.scopeKey, externalId));
    if (a) return { ...a, via: 'account_id' };
    const s = index.byId.get(k(q.channel, '-', externalId));
    if (s) return { ...s, via: 'shared_id' };
  }
  if (externalSku !== '') {
    const a = index.bySku.get(k(q.channel, q.scopeKey, externalSku));
    if (a) return { ...a, via: 'account_sku' };
    const s = index.bySku.get(k(q.channel, '-', externalSku));
    if (s) return { ...s, via: 'shared_sku' };
  }
  return null;
}
