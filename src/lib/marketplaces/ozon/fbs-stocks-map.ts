// PURPOSE: Чистый маппинг ответов Ozon `/v2/warehouse/list` и
// `/v2/product/info/stocks-by-warehouse/fbs` в строки `ozon_warehouse_stocks`
// (source='FBS'). Без импорта db и клиента — тестируется офлайн
// (scripts/test-ozon-fbs-stocks-map.ts). Дрейф формы ответа не глотается:
// парсеры возвращают `problems`, а стейдж кладёт их в StageResult.warnings.

import type { ozonWarehouseStocks } from '@/lib/db/schema/marketplaces';

export type WarehouseStockInsert = typeof ozonWarehouseStocks.$inferInsert;

/** Нормализованный элемент справочника FBS/rFBS-складов продавца. */
export type FbsWarehouseItem = {
  /** int64 из Ozon, храним строкой (в JSON он приходит и числом, и строкой). */
  warehouseId: string;
  name: string;
  /** `'rFBS'` если склад помечен `is_rfbs`, иначе `'FBS'`. */
  warehouseType: 'FBS' | 'rFBS';
  status: string | null;
};

/** Остаток одного SKU на одном FBS-складе. */
export type FbsWarehouseStockRow = {
  sku: string;
  productId: string | null;
  offerId: string | null;
  warehouseId: string;
  warehouseName: string;
  /** Общее количество на складе (`present`, включает резерв). */
  present: number;
  reserved: number;
  /** `free_stock` из v2; null, если Ozon его не прислал. */
  freeStock: number | null;
  raw: Record<string, unknown>;
};

/** Общая часть постраничного разбора: курсор и признак продолжения. */
export type PageMeta = {
  cursor: string;
  hasNext: boolean;
  /** false — в ответе нет обязательного массива (форма «уехала»). */
  shapeOk: boolean;
  /** Человекочитаемые замечания для StageResult.warnings. */
  problems: string[];
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Справочник: `has_next` — boolean, в примере строка → принимаем оба. */
function readHasNext(v: unknown): boolean {
  return v === true || v === 'true';
}

function readCursor(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function idToString(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string') return v.trim();
  return '';
}

/** int64 у grpc-gateway бывает строкой → принимаем число и числовую строку. */
function finiteOrNull(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Доля пропущенных строк страницы, выше которой форма считается «уехавшей». */
const MAX_SKIPPED_SHARE = 0.1;

/** Одна страница `/v2/warehouse/list`. */
export function parseWarehouseListPage(
  data: unknown,
): PageMeta & { items: FbsWarehouseItem[] } {
  const problems: string[] = [];
  if (!isRecord(data) || !Array.isArray(data.warehouses)) {
    return {
      items: [],
      cursor: '',
      hasNext: false,
      shapeOk: false,
      problems: ['/v2/warehouse/list: в ответе нет массива warehouses'],
    };
  }
  const items: FbsWarehouseItem[] = [];
  let skipped = 0;
  for (const w of data.warehouses) {
    const id = isRecord(w) ? idToString(w.warehouse_id) : '';
    if (!isRecord(w) || !id) {
      skipped += 1;
      continue;
    }
    const name = typeof w.name === 'string' ? w.name.trim() : '';
    items.push({
      warehouseId: id,
      name: name || `Склад ${id}`,
      warehouseType: w.is_rfbs === true ? 'rFBS' : 'FBS',
      status: typeof w.status === 'string' ? w.status : null,
    });
  }
  if (skipped > 0) {
    problems.push(`/v2/warehouse/list: ${skipped} складов без warehouse_id пропущено`);
  }
  return {
    items,
    cursor: readCursor(data.cursor),
    hasNext: readHasNext(data.has_next),
    shapeOk: true,
    problems,
  };
}

/** Одна страница `/v2/product/info/stocks-by-warehouse/fbs`. */
export function parseStocksByWarehouseFbsPage(
  data: unknown,
): PageMeta & { rows: FbsWarehouseStockRow[] } {
  const problems: string[] = [];
  // grpc-gateway может опускать пустой массив: объект без products и без
  // has_next=true — это пустая страница, а не дрейф формы.
  if (
    isRecord(data) &&
    data.products === undefined &&
    !readHasNext(data.has_next) &&
    Object.keys(data).every((k) => k === 'cursor' || k === 'has_next')
  ) {
    return { rows: [], cursor: '', hasNext: false, shapeOk: true, problems: [] };
  }
  if (!isRecord(data) || !Array.isArray(data.products)) {
    return {
      rows: [],
      cursor: '',
      hasNext: false,
      shapeOk: false,
      problems: [
        '/v2/product/info/stocks-by-warehouse/fbs: в ответе нет массива products',
      ],
    };
  }
  const rows: FbsWarehouseStockRow[] = [];
  let skipped = 0;
  for (const r of data.products) {
    if (!isRecord(r)) {
      skipped += 1;
      continue;
    }
    const sku = idToString(r.sku);
    const warehouseId = idToString(r.warehouse_id);
    const present = finiteOrNull(r.present);
    const reserved = finiteOrNull(r.reserved);
    // Ключевые поля обязательны: строку без sku/склада/present не пишем,
    // а не подставляем 0 (иначе остаток молча обнулится).
    if (!sku || !warehouseId || present === null || reserved === null) {
      skipped += 1;
      continue;
    }
    rows.push({
      sku,
      productId: idToString(r.product_id) || null,
      offerId: typeof r.offer_id === 'string' && r.offer_id ? r.offer_id : null,
      warehouseId,
      warehouseName: typeof r.warehouse_name === 'string' ? r.warehouse_name.trim() : '',
      present,
      reserved,
      freeStock: finiteOrNull(r.free_stock),
      raw: r,
    });
  }
  if (skipped > 0) {
    problems.push(
      `/v2/product/info/stocks-by-warehouse/fbs: ${skipped} строк без sku/warehouse_id/present/reserved пропущено`,
    );
  }
  // Массовый дрейф поля (например, present сменил тип) — не «успех с
  // предупреждением»: иначе окно заменится почти пустым снапшотом.
  const total = data.products.length;
  const tooMany = skipped > 0 && skipped / total > MAX_SKIPPED_SHARE;
  if (tooMany) {
    problems.push(
      `/v2/product/info/stocks-by-warehouse/fbs: пропущено ${skipped} из ${total} строк — форма ответа изменилась`,
    );
  }
  return {
    rows,
    cursor: readCursor(data.cursor),
    hasNext: readHasNext(data.has_next),
    shapeOk: !tooMany,
    problems,
  };
}

/** Строки FBS-остатков → вставки `ozon_warehouse_stocks` (source='FBS'). */
export function buildFbsStockInsertRows(args: {
  tenantId: string;
  accountId: string;
  stocks: FbsWarehouseStockRow[];
  warehousesById: Map<string, FbsWarehouseItem>;
  offerBySku: Map<string, string>;
}): WarehouseStockInsert[] {
  const out: WarehouseStockInsert[] = [];
  for (const r of args.stocks) {
    const meta = args.warehousesById.get(r.warehouseId) ?? null;
    const warehouseName = r.warehouseName || meta?.name || `Склад ${r.warehouseId}`;
    // int64 → number: id складов Ozon (~1e13) < 2^53, но перестраховываемся.
    const numericId = Number(r.warehouseId);
    out.push({
      tenantId: args.tenantId,
      accountId: args.accountId,
      sku: r.sku,
      offerId: args.offerBySku.get(r.sku) ?? r.offerId ?? null,
      warehouseName,
      source: 'FBS',
      warehouseId: Number.isSafeInteger(numericId) ? numericId : null,
      warehouseType: meta?.warehouseType ?? 'FBS',
      // Кластеры — только у фулфилмента Ozon (см. шапку sync/fbs-warehouse-stocks.ts).
      clusterId: null,
      clusterName: null,
      clusterType: null,
      // «Доступно к продаже» = свободный остаток. Потребители считают
      // количество как free + reserved, поэтому без free_stock пишем
      // present − reserved (present включает резерв), иначе резерв задвоится.
      freeToSellAmount: r.freeStock ?? Math.max(0, r.present - r.reserved),
      // У FBS нет «ожидается»: Ozon отдаёт только present/reserved/free_stock.
      promisedAmount: 0,
      reservedAmount: r.reserved,
      raw: r.raw,
    });
  }
  return out;
}

/**
 * Курсорная выборка с инъекцией `fetchPage` (чистая, тестируется офлайн).
 * `complete=false` — выборка оборвана (нет курсора при has_next, курсор не
 * сдвинулся, лимит страниц): вызывающий НЕ должен заменять снапшот частью.
 */
export async function collectCursorPages<T>(opts: {
  label: string;
  maxPages: number;
  fetchPage: (cursor: string) => Promise<unknown>;
  parse: (data: unknown) => PageMeta & { items: T[] };
}): Promise<{ items: T[]; shapeOk: boolean; complete: boolean; warnings: string[] }> {
  const items: T[] = [];
  const warnings: string[] = [];
  let cursor = '';
  for (let page = 0; page < opts.maxPages; page += 1) {
    const parsed = opts.parse(await opts.fetchPage(cursor));
    warnings.push(...parsed.problems);
    if (!parsed.shapeOk) return { items, shapeOk: false, complete: false, warnings };
    items.push(...parsed.items);
    if (!parsed.hasNext) return { items, shapeOk: true, complete: true, warnings };
    if (!parsed.cursor || parsed.cursor === cursor) {
      warnings.push(
        `${opts.label}: has_next=true, но курсор пуст или не изменился — выборка неполная`,
      );
      return { items, shapeOk: true, complete: false, warnings };
    }
    cursor = parsed.cursor;
  }
  warnings.push(`${opts.label}: достигнут лимит ${opts.maxPages} страниц — выборка неполная`);
  return { items, shapeOk: true, complete: false, warnings };
}
