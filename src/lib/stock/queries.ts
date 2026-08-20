// PURPOSE: ЧТЕНИЕ модуля «Склад · Поставки · Себестоимость» — остатки, документы,
// карточка товара, «что заканчивается», карантин. Канон — docs/STOCK_MODULE_DESIGN.md
// §1 (инварианты), §3 (авторитет мест), §6.2 (UNION журнала и ozon_warehouse_stocks),
// §7 (блоки). Запись (проводка/сторно/пересчёт) — в соседнем posting.ts.
//
// ЖЁСТКИЕ ПРАВИЛА ЭТОГО ФАЙЛА:
//   1. tenantId приходит ТОЛЬКО из сессии (requireTenant / requireTenantRoute) —
//      ни одна функция не принимает его из тела запроса. Каждый WHERE содержит
//      tenant_id (docs/TENANT_SCOPING.md).
//   2. Здесь НЕТ UPDATE/DELETE по stock_moves (§2.7). Файл только читает;
//      единственное исключение на весь модуль — recalcFrom() в posting.ts.
//   3. Остаток по ledger-местам = SUM(qty_delta), стоимость = SUM(value_delta)
//      (§1.1). Остатки складов Ozon мы НЕ ведём — их отдаёт ozon_warehouse_stocks
//      (§1.2), поэтому «ИТОГО» — это UNION двух источников, а не одна таблица.
//   4. Молчаливого нуля не бывает (§1.10): позиции без сшивки и продажи без
//      себестоимости возвращает getStockQuarantine(), а не «COGS = 0» втихую.
//
// postgres.js gotcha (drizzle.mdc): Date НЕЛЬЗЯ передавать в sql`${dateObj}` —
// только ISO-строку с явным кастом (`${iso}::timestamp`).

import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL } from 'drizzle-orm';
import { db, type DB } from '@/lib/db/client';
import {
  stockItemLinks,
  stockItems,
  stockPlaces,
  type StockChannel,
  type StockItem,
  type StockPlace,
} from '@/lib/db/schema/stock';
import {
  stockBatches,
  stockDocLines,
  stockDocs,
  stockMoves,
  stockRecon,
  stockSettings,
  type StockDoc,
  type StockDocKind,
  type StockDocStatus,
  type StockSettingsRow,
} from '@/lib/db/schema/stock-ledger';
import { moscowDateString, shiftIsoDate } from '@/lib/marketplaces/ozon/sync/perf-period';
import { BUILTIN_STOCK_PLACES } from './places';

/**
 * db-клиент ИЛИ транзакция. Все функции модуля принимают его первым
 * аргументом-опцией, чтобы posting.ts мог читать ВНУТРИ своей транзакции
 * (иначе реплей увидит состояние до вставки движений).
 */
export type StockDb = DB | Parameters<Parameters<DB['transaction']>[0]>[0];

/** Tenant-скоуп. Приходит из requireTenant()/requireTenantRoute(), не из тела. */
export interface StockCtx {
  tenantId: string;
  userId: string;
}

/** Окно расчёта скорости продаж для «дней запаса». */
const VELOCITY_WINDOW_DAYS = 30;

/**
 * Потолки витрин «Пробелов». Именованные константы, потому что по ним же
 * считается признак усечения: захардкоженный лимит в SQL и отдельная цифра в
 * сравнении разъезжаются при первой же правке, и блок начинает врать «всё влезло».
 */
const NO_COST_ITEMS_LIMIT = 200;
const UNMATCHED_OFFERS_LIMIT = 500;

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

/**
 * 'YYYY-MM-DD' сегодняшнего дня по календарю МОСКВЫ — той же зоне, в которой
 * работают фильтры документов и проставляются doc_date из UI (грабля Релиза 1:
 * локальные геттеры Date дают пользователю западнее UTC документ, не попадающий
 * в свой же период, а сроку годности — «минус сутки»).
 */
export function todayIsoDate(): string {
  return moscowDateString(new Date());
}

// ---------------------------------------------------------------------------
// Настройки и справочник мест
// ---------------------------------------------------------------------------

/**
 * Идемпотентный сид раздела: девять встроенных мест (§3) + строка настроек.
 * Вызывается при первом входе на /app/warehouse и любым роутом, которому нужны
 * места. Повторный вызов ничего не создаёт (onConflictDoNothing по уник-индексам).
 */
export async function ensureStockSetup(
  ctx: StockCtx,
  client: StockDb = db,
): Promise<{ places: StockPlace[]; settings: StockSettingsRow }> {
  await client
    .insert(stockPlaces)
    .values(
      BUILTIN_STOCK_PLACES.map((p) => ({
        tenantId: ctx.tenantId,
        code: p.code,
        name: p.name,
        kind: p.kind,
        authority: p.authority,
        externalSource: p.externalSource ?? null,
        sortOrder: p.sortOrder,
      })),
    )
    .onConflictDoNothing({ target: [stockPlaces.tenantId, stockPlaces.code] });

  await client
    .insert(stockSettings)
    .values({ tenantId: ctx.tenantId })
    .onConflictDoNothing({ target: [stockSettings.tenantId] });

  const [places, settings] = await Promise.all([
    listStockPlaces(ctx, client),
    getStockSettings(ctx, client),
  ]);
  return { places, settings };
}

export async function listStockPlaces(
  ctx: StockCtx,
  client: StockDb = db,
): Promise<StockPlace[]> {
  return client
    .select()
    .from(stockPlaces)
    .where(eq(stockPlaces.tenantId, ctx.tenantId))
    .orderBy(asc(stockPlaces.sortOrder), asc(stockPlaces.code));
}

/** Настройки tenant'а. Если строки нет — создаёт дефолтную (§2.8). */
export async function getStockSettings(
  ctx: StockCtx,
  client: StockDb = db,
): Promise<StockSettingsRow> {
  const [row] = await client
    .select()
    .from(stockSettings)
    .where(eq(stockSettings.tenantId, ctx.tenantId))
    .limit(1);
  if (row) return row;

  await client
    .insert(stockSettings)
    .values({ tenantId: ctx.tenantId })
    .onConflictDoNothing({ target: [stockSettings.tenantId] });
  const [created] = await client
    .select()
    .from(stockSettings)
    .where(eq(stockSettings.tenantId, ctx.tenantId))
    .limit(1);
  return created;
}

export interface StockSettingsPatch {
  costingMode?: StockSettingsRow['costingMode'];
  lotPolicy?: StockSettingsRow['lotPolicy'];
  /**
   * §12.2: меняет ТОЛЬКО дефолт для новых документов. Исторические партии
   * остаются в своём базисе — UI обязан это сказать словами.
   */
  costBasis?: StockSettingsRow['costBasis'];
  ledgerStartDate?: string | null;
  lockedThrough?: string | null;
  allowNegative?: boolean;
}

export async function updateStockSettings(
  ctx: StockCtx,
  patch: StockSettingsPatch,
  client: StockDb = db,
): Promise<StockSettingsRow> {
  await getStockSettings(ctx, client);
  const [row] = await client
    .update(stockSettings)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(stockSettings.tenantId, ctx.tenantId))
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Номенклатура
// ---------------------------------------------------------------------------

export interface ListItemsFilter {
  search?: string;
  brand?: string;
  includeInactive?: boolean;
  limit?: number;
  offset?: number;
}

export async function listStockItems(
  ctx: StockCtx,
  filter: ListItemsFilter = {},
  client: StockDb = db,
): Promise<StockItem[]> {
  const conds: SQL[] = [eq(stockItems.tenantId, ctx.tenantId)];
  if (!filter.includeInactive) conds.push(eq(stockItems.isActive, true));
  if (filter.brand) conds.push(eq(stockItems.brand, filter.brand));
  if (filter.search?.trim()) {
    const like = `%${filter.search.trim().toLowerCase()}%`;
    conds.push(
      sql`(lower(${stockItems.name}) LIKE ${like} OR lower(${stockItems.sku}) LIKE ${like} OR lower(coalesce(${stockItems.barcode}, '')) LIKE ${like})`,
    );
  }
  return client
    .select()
    .from(stockItems)
    .where(and(...conds))
    .orderBy(asc(stockItems.name), asc(stockItems.sku))
    .limit(Math.min(2000, Math.max(1, filter.limit ?? 500)))
    .offset(Math.max(0, filter.offset ?? 0));
}

export interface StockLinkRow {
  id: string;
  itemId: string;
  channel: StockChannel;
  scopeKey: string;
  externalId: string;
  externalSku: string | null;
  qtyPerUnit: number;
  unitProductId: string | null;
  accountId: string | null;
  matchSource: string;
  matchConfidence: number;
}

export async function listStockLinks(
  ctx: StockCtx,
  filter: { channel?: StockChannel; itemId?: string } = {},
  client: StockDb = db,
): Promise<StockLinkRow[]> {
  const conds: SQL[] = [eq(stockItemLinks.tenantId, ctx.tenantId)];
  if (filter.channel) conds.push(eq(stockItemLinks.channel, filter.channel));
  if (filter.itemId) conds.push(eq(stockItemLinks.itemId, filter.itemId));
  const rows = await client
    .select()
    .from(stockItemLinks)
    .where(and(...conds))
    .orderBy(asc(stockItemLinks.externalId));
  return rows.map((r) => ({
    id: r.id,
    itemId: r.itemId,
    channel: r.channel,
    scopeKey: r.scopeKey,
    externalId: r.externalId,
    externalSku: r.externalSku,
    qtyPerUnit: r.qtyPerUnit,
    unitProductId: r.unitProductId,
    accountId: r.accountId,
    matchSource: r.matchSource,
    matchConfidence: r.matchConfidence,
  }));
}

// ---------------------------------------------------------------------------
// Остатки: журнал (ledger) + внешние места (Ozon)
// ---------------------------------------------------------------------------

/** Остаток одного товара в одном ledger-месте. */
export interface LedgerBalanceRow {
  itemId: string;
  placeId: string;
  qty: number;
  valueKopecks: number;
}

/**
 * SUM по журналу — единственный источник правды по подконтрольным местам (§1.1).
 * Держится в отдельной функции: её же зовёт карточка товара и карантин.
 */
export async function getLedgerBalances(
  ctx: StockCtx,
  itemIds?: string[],
  client: StockDb = db,
): Promise<LedgerBalanceRow[]> {
  if (itemIds && itemIds.length === 0) return [];
  const conds: SQL[] = [eq(stockMoves.tenantId, ctx.tenantId)];
  if (itemIds) conds.push(inArray(stockMoves.itemId, itemIds));
  const rows = await client
    .select({
      itemId: stockMoves.itemId,
      placeId: stockMoves.placeId,
      qty: sql<string>`sum(${stockMoves.qtyDelta})`,
      value: sql<string>`sum(${stockMoves.valueDeltaKopecks})`,
    })
    .from(stockMoves)
    .where(and(...conds))
    .groupBy(stockMoves.itemId, stockMoves.placeId);
  return rows.map((r) => ({
    itemId: r.itemId,
    placeId: r.placeId,
    qty: num(r.qty),
    valueKopecks: num(r.value),
  }));
}

/** Остаток на складах Ozon по нашим товарам (через сшивку). */
export interface ExternalBalanceRow {
  itemId: string;
  /** 'FBO' | 'FBS' — совпадает с ozon_warehouse_stocks.source. */
  source: string;
  qty: number;
  /** Ожидается (в пути по данным Ozon) — показываем отдельно, в ИТОГО не входит. */
  promisedQty: number;
}

/**
 * Остатки Ozon, приведённые к БАЗОВЫМ единицам через qty_per_unit (§2.3):
 * карточка «3 банки» с остатком 4 шт — это 12 банок на складе.
 *
 * Одна строка ozon_warehouse_stocks сшивается РОВНО с одной ссылкой
 * (LATERAL + LIMIT 1, приоритет у совпадения по offer_id): иначе товар,
 * у которого сшивка есть и по offer_id, и по числовому sku, посчитался бы дважды.
 */
export async function getOzonExternalBalances(
  ctx: StockCtx,
  client: StockDb = db,
): Promise<ExternalBalanceRow[]> {
  const rows = await client.execute<{
    item_id: string;
    source: string;
    qty: string;
    promised: string;
  }>(sql`
    SELECT
      l.item_id,
      ws.source,
      SUM((ws.free_to_sell_amount + ws.reserved_amount) * l.qty_per_unit) AS qty,
      SUM(ws.promised_amount * l.qty_per_unit) AS promised
    FROM ozon_warehouse_stocks ws
    JOIN LATERAL (
      SELECT sl.item_id, sl.qty_per_unit
      FROM stock_item_links sl
      WHERE sl.tenant_id = ${ctx.tenantId}
        AND sl.channel = 'ozon'
        AND (sl.scope_key = ws.account_id::text OR sl.scope_key = '-')
        AND (sl.external_id = ws.offer_id OR sl.external_sku = ws.sku)
      ORDER BY (sl.external_id = ws.offer_id) DESC, sl.id
      LIMIT 1
    ) l ON TRUE
    WHERE ws.tenant_id = ${ctx.tenantId}
    GROUP BY l.item_id, ws.source
  `);
  return Array.from(rows).map((r) => ({
    itemId: r.item_id,
    source: r.source,
    qty: num(r.qty),
    promisedQty: num(r.promised),
  }));
}

/** Позиция канала, у которой сшивки нет — группа «Не сопоставлено» (§7 блок 1). */
export interface UnmatchedChannelRow {
  channel: StockChannel;
  accountId: string | null;
  externalId: string;
  externalSku: string | null;
  name: string | null;
  qty: number;
}

export async function getUnmatchedOzonOffers(
  ctx: StockCtx,
  client: StockDb = db,
): Promise<UnmatchedChannelRow[]> {
  const rows = await client.execute<{
    account_id: string;
    offer_id: string | null;
    sku: string;
    qty: string;
  }>(sql`
    SELECT
      ws.account_id::text AS account_id,
      ws.offer_id,
      ws.sku,
      SUM(ws.free_to_sell_amount + ws.reserved_amount) AS qty
    FROM ozon_warehouse_stocks ws
    WHERE ws.tenant_id = ${ctx.tenantId}
      AND NOT EXISTS (
        SELECT 1 FROM stock_item_links sl
        WHERE sl.tenant_id = ${ctx.tenantId}
          AND sl.channel = 'ozon'
          AND (sl.scope_key = ws.account_id::text OR sl.scope_key = '-')
          AND (sl.external_id = ws.offer_id OR sl.external_sku = ws.sku)
      )
    GROUP BY ws.account_id, ws.offer_id, ws.sku
    ORDER BY qty DESC
    LIMIT ${UNMATCHED_OFFERS_LIMIT}
  `);
  return Array.from(rows).map((r) => ({
    channel: 'ozon' as const,
    accountId: r.account_id,
    externalId: r.offer_id ?? r.sku,
    externalSku: r.sku,
    name: null,
    qty: num(r.qty),
  }));
}

/**
 * Скорость продаж в БАЗОВЫХ единицах в день за последние 30 дней — вход для
 * «дней запаса». Источник — ozon_orders (заказы за вычетом отмен и возвратов),
 * приведённые к нашим товарам через сшивку и qty_per_unit.
 *
 * Почему не ozon_realization: у неё естественный ключ (account, period, sku) и
 * период закрывается раз в месяц — для «дней запаса» нужна свежая скользящая
 * скорость, а не бухгалтерский срез (в COGS периода, наоборот, пойдёт realization).
 */
export async function getSalesVelocityPerDay(
  ctx: StockCtx,
  client: StockDb = db,
): Promise<Map<string, number>> {
  const sinceIso = isoDaysAgo(VELOCITY_WINDOW_DAYS);
  const rows = await client.execute<{ item_id: string; qty: string }>(sql`
    WITH sold AS (
      SELECT
        (it->>'offerId')::text AS offer_id,
        (it->>'sku')::text AS sku,
        COALESCE(NULLIF(it->>'quantity', '')::numeric, 0) AS qty
      FROM ozon_orders o
      CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
      WHERE o.tenant_id = ${ctx.tenantId}
        AND o.order_created_at >= ${sinceIso}::timestamp
        AND o.cancelled_at IS NULL
        AND o.returned_at IS NULL
        AND lower(o.status) NOT LIKE '%cancel%'
        AND lower(o.status) NOT LIKE '%return%'
    )
    SELECT l.item_id, SUM(sold.qty * l.qty_per_unit) AS qty
    FROM sold
    JOIN LATERAL (
      SELECT sl.item_id, sl.qty_per_unit
      FROM stock_item_links sl
      WHERE sl.tenant_id = ${ctx.tenantId}
        AND sl.channel = 'ozon'
        AND (sl.external_id = sold.offer_id OR sl.external_sku = sold.sku)
      ORDER BY (sl.external_id = sold.offer_id) DESC, sl.id
      LIMIT 1
    ) l ON TRUE
    GROUP BY l.item_id
  `);
  const map = new Map<string, number>();
  for (const r of Array.from(rows)) {
    map.set(r.item_id, num(r.qty) / VELOCITY_WINDOW_DAYS);
  }
  return map;
}

/** Строка блока stock.balances: товар × места. */
export interface StockBalanceRow {
  itemId: string;
  sku: string;
  name: string;
  brand: string | null;
  category: string | null;
  unit: string;
  minQty: number;
  /** placeId → штук (только ledger-места). */
  byPlace: Record<string, number>;
  /** 'FBO' | 'FBS' → штук (внешние места, из ozon_warehouse_stocks). */
  byExternal: Record<string, number>;
  /** Ожидается на складах Ozon; в ИТОГО НЕ входит (это ещё не остаток). */
  promisedQty: number;
  /** Штук в journaled-местах (Σ qty_delta) — то же, что кэш qty_pool. */
  ledgerQty: number;
  /** ИТОГО = журнал + склады Ozon. */
  totalQty: number;
  /** Себестоимость единицы: override ?? скользящая средняя. */
  unitCostKopecks: number;
  /** Себестоимость — ручной override, а не расчёт журнала. */
  isOverride: boolean;
  /** Стоимость ВСЕГО остатка (ИТОГО × себестоимость), копейки. */
  totalValueKopecks: number;
  /** Стоимость журнального пула (Σ value_delta) — «деньги на своём складе». */
  ledgerValueKopecks: number;
  /** Базис оценки: gross | net | mixed (§12.2). */
  costBasis: string;
  /** Продаж в базовых единицах в день (30-дневное окно). */
  salesPerDay: number;
  /** Дней запаса; null — продаж нет или скорость неизвестна. */
  daysOfSupply: number | null;
  /** Заканчивается: ИТОГО <= min_qty (при min_qty > 0). */
  isLow: boolean;
  /** Себестоимость неизвестна — товар попадает в карантин (§1.10). */
  noCost: boolean;
}

export interface StockBalancesResult {
  places: StockPlace[];
  rows: StockBalanceRow[];
  unmatched: UnmatchedChannelRow[];
  totals: {
    itemsCount: number;
    ledgerQty: number;
    totalQty: number;
    /** Полная капитализация склада (журнал + Ozon) — публикуется как __money. */
    totalValueKopecks: number;
    /** Только журнальные места (свой склад, транзит, сайты). */
    ledgerValueKopecks: number;
    lowCount: number;
    noCostCount: number;
    unmatchedCount: number;
  };
}

export interface BalancesFilter {
  search?: string;
  brand?: string;
  includeInactive?: boolean;
  /** Только «заканчивается» (ИТОГО <= min_qty). */
  onlyLow?: boolean;
  /** Скрыть позиции с нулевым остатком везде. */
  hideZero?: boolean;
  limit?: number;
}

/**
 * Главный экран модуля: строка = товар, колонки = места (§7 блок 1).
 * UNION двух источников (§6.2): журнал по authority='ledger' + агрегат
 * ozon_warehouse_stocks по source. Собственный расчётный остаток на складах
 * Ozon мы не ведём принципиально — расходиться нечему (§3).
 */
export async function getStockBalances(
  ctx: StockCtx,
  filter: BalancesFilter = {},
  client: StockDb = db,
): Promise<StockBalancesResult> {
  const [places, items, external, unmatched, velocity] = await Promise.all([
    listStockPlaces(ctx, client),
    listStockItems(
      ctx,
      {
        search: filter.search,
        brand: filter.brand,
        includeInactive: filter.includeInactive,
        limit: filter.limit ?? 1000,
      },
      client,
    ),
    getOzonExternalBalances(ctx, client),
    getUnmatchedOzonOffers(ctx, client),
    getSalesVelocityPerDay(ctx, client),
  ]);

  const itemIds = items.map((i) => i.id);
  const ledger = await getLedgerBalances(ctx, itemIds, client);

  const ledgerByItem = new Map<string, LedgerBalanceRow[]>();
  for (const row of ledger) {
    const list = ledgerByItem.get(row.itemId);
    if (list) list.push(row);
    else ledgerByItem.set(row.itemId, [row]);
  }
  const externalByItem = new Map<string, ExternalBalanceRow[]>();
  for (const row of external) {
    const list = externalByItem.get(row.itemId);
    if (list) list.push(row);
    else externalByItem.set(row.itemId, [row]);
  }

  const rows: StockBalanceRow[] = [];
  for (const item of items) {
    const byPlace: Record<string, number> = {};
    let ledgerQty = 0;
    let ledgerValue = 0;
    for (const b of ledgerByItem.get(item.id) ?? []) {
      byPlace[b.placeId] = (byPlace[b.placeId] ?? 0) + b.qty;
      ledgerQty += b.qty;
      ledgerValue += b.valueKopecks;
    }

    const byExternal: Record<string, number> = {};
    let externalQty = 0;
    let promisedQty = 0;
    for (const e of externalByItem.get(item.id) ?? []) {
      byExternal[e.source] = (byExternal[e.source] ?? 0) + e.qty;
      externalQty += e.qty;
      promisedQty += e.promisedQty;
    }

    const totalQty = ledgerQty + externalQty;
    const isOverride = item.costOverrideKopecks != null;
    const unitCost = isOverride
      ? (item.costOverrideKopecks as number)
      : item.avgCostKopecks;
    const salesPerDay = velocity.get(item.id) ?? 0;

    const row: StockBalanceRow = {
      itemId: item.id,
      sku: item.sku,
      name: item.name,
      brand: item.brand,
      category: item.category,
      unit: item.unit,
      minQty: item.minQty,
      byPlace,
      byExternal,
      promisedQty,
      ledgerQty,
      totalQty,
      unitCostKopecks: unitCost,
      isOverride,
      // Оценка ВСЕГО остатка идёт по одной цене — включая товар на складах
      // Ozon (§10 риск 2: это текущая средняя, а не средняя на момент отгрузки).
      totalValueKopecks: unitCost * totalQty,
      ledgerValueKopecks: ledgerValue,
      costBasis: item.costBasisMixed ? 'mixed' : item.costBasis,
      salesPerDay,
      daysOfSupply: salesPerDay > 0 ? Math.round(totalQty / salesPerDay) : null,
      isLow: item.minQty > 0 && totalQty <= item.minQty,
      noCost: unitCost <= 0 && totalQty !== 0,
    };
    if (filter.onlyLow && !row.isLow) continue;
    if (filter.hideZero && totalQty === 0) continue;
    rows.push(row);
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.itemsCount += 1;
      acc.ledgerQty += r.ledgerQty;
      acc.totalQty += r.totalQty;
      acc.totalValueKopecks += r.totalValueKopecks;
      acc.ledgerValueKopecks += r.ledgerValueKopecks;
      if (r.isLow) acc.lowCount += 1;
      if (r.noCost) acc.noCostCount += 1;
      return acc;
    },
    {
      itemsCount: 0,
      ledgerQty: 0,
      totalQty: 0,
      totalValueKopecks: 0,
      ledgerValueKopecks: 0,
      lowCount: 0,
      noCostCount: 0,
      unmatchedCount: unmatched.length,
    },
  );

  return { places, rows, unmatched, totals };
}

/** «Что заканчивается» — товары, где ИТОГО опустился до min_qty (§7 блок 1). */
export async function getLowStockItems(
  ctx: StockCtx,
  limit = 50,
  client: StockDb = db,
): Promise<StockBalanceRow[]> {
  const { rows } = await getStockBalances(ctx, { onlyLow: true }, client);
  return rows
    .sort((a, b) => {
      const da = a.daysOfSupply ?? Number.POSITIVE_INFINITY;
      const dbs = b.daysOfSupply ?? Number.POSITIVE_INFINITY;
      if (da !== dbs) return da - dbs;
      return a.totalQty - b.totalQty;
    })
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Документы
// ---------------------------------------------------------------------------

export interface DocsFilter {
  kind?: StockDocKind;
  status?: StockDocStatus;
  /** 'YYYY-MM-DD' включительно. */
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface StockDocListRow {
  id: string;
  kind: StockDocKind;
  status: StockDocStatus;
  number: string | null;
  docDate: string;
  supplier: string;
  docNumber: string | null;
  totalKopecks: number;
  vatTotalKopecks: number;
  extraCostKopecks: number;
  costBasis: string;
  linesCount: number;
  qtyTotal: number;
  reversesDocId: string | null;
  comment: string | null;
  postedAt: string | null;
}

export async function listStockDocs(
  ctx: StockCtx,
  filter: DocsFilter = {},
  client: StockDb = db,
): Promise<{
  rows: StockDocListRow[];
  totals: {
    purchasesKopecks: number;
    docsCount: number;
    lossKopecks: number;
    mpShortageKopecks: number;
    salesCogsKopecks: number;
  };
}> {
  const conds: SQL[] = [eq(stockDocs.tenantId, ctx.tenantId)];
  if (filter.kind) conds.push(eq(stockDocs.kind, filter.kind));
  if (filter.status) conds.push(eq(stockDocs.status, filter.status));
  if (filter.from) conds.push(gte(stockDocs.docDate, filter.from));
  if (filter.to) conds.push(lte(stockDocs.docDate, filter.to));
  if (filter.search?.trim()) {
    const like = `%${filter.search.trim().toLowerCase()}%`;
    conds.push(
      sql`(lower(${stockDocs.supplier}) LIKE ${like} OR lower(coalesce(${stockDocs.number}, '')) LIKE ${like} OR lower(coalesce(${stockDocs.docNumber}, '')) LIKE ${like})`,
    );
  }

  const rows = await client
    .select({
      id: stockDocs.id,
      kind: stockDocs.kind,
      status: stockDocs.status,
      number: stockDocs.number,
      docDate: stockDocs.docDate,
      supplier: stockDocs.supplier,
      docNumber: stockDocs.docNumber,
      totalKopecks: stockDocs.totalKopecks,
      vatTotalKopecks: stockDocs.vatTotalKopecks,
      extraCostKopecks: stockDocs.extraCostKopecks,
      costBasis: stockDocs.costBasis,
      reversesDocId: stockDocs.reversesDocId,
      comment: stockDocs.comment,
      postedAt: stockDocs.postedAt,
      // tenant_id в КАЖДОМ запросе, включая коррелированные подзапросы
      // (security.mdc). Утечки тут нет и без него — внешний запрос уже скоуплен,
      // а doc_id это PK, — но правило не знает исключений «здесь и так видно»:
      // именно так подзапрос переживает копипаст в место без внешнего скоупа.
      linesCount: sql<string>`(SELECT count(*) FROM ${stockDocLines} dl WHERE dl.tenant_id = ${ctx.tenantId} AND dl.doc_id = ${stockDocs.id})`,
      qtyTotal: sql<string>`(SELECT coalesce(sum(dl.qty), 0) FROM ${stockDocLines} dl WHERE dl.tenant_id = ${ctx.tenantId} AND dl.doc_id = ${stockDocs.id})`,
    })
    .from(stockDocs)
    .where(and(...conds))
    .orderBy(desc(stockDocs.docDate), desc(stockDocs.createdAt))
    .limit(Math.min(500, Math.max(1, filter.limit ?? 100)))
    .offset(Math.max(0, filter.offset ?? 0));

  // «Закуплено за период» — только проведённые приходные документы.
  // Сторно (status='void' у оригинала + отдельный сторно-документ) из суммы
  // выпадает автоматически: у сторно-документа total_kopecks отрицательный.
  //
  // Возвраты ИМПОРТА продаж (WB/ЯМ) исключены сознательно: их стоимость взята
  // по текущей средней, ничего при этом не закупалось, и «Закуплено за период»
  // росло бы на каждый возврат покупателя. Ручной return_in остаётся в сумме —
  // там речь про реальный приход на склад.
  const purchaseConds: SQL[] = [
    eq(stockDocs.tenantId, ctx.tenantId),
    eq(stockDocs.status, 'posted'),
    inArray(stockDocs.kind, ['purchase', 'opening', 'return_in']),
    sql`NOT (${stockDocs.kind} = 'return_in' AND ${stockDocs.source} LIKE 'import:%')`,
  ];
  if (filter.from) purchaseConds.push(gte(stockDocs.docDate, filter.from));
  if (filter.to) purchaseConds.push(lte(stockDocs.docDate, filter.to));
  const [agg] = await client
    .select({
      total: sql<string>`coalesce(sum(${stockDocs.totalKopecks}), 0)`,
      count: sql<string>`count(*)`,
    })
    .from(stockDocs)
    .where(and(...purchaseConds));

  // Потери и себестоимость проданного за тот же период — по ЛЕНТЕ, а не по
  // шапкам: у списания и продажи «сумма документа» нулевая, деньги живут в
  // движениях. Разделены сознательно (§1.8): просрочка, недостача маркетплейса
  // и себестоимость проданного — три разные строки будущего P&L, и «сколько
  // товара съел маркетплейс» обязано быть видно отдельной суммой (§5).
  const moveConds: SQL[] = [eq(stockMoves.tenantId, ctx.tenantId)];
  if (filter.from) moveConds.push(gte(stockMoves.docDate, filter.from));
  if (filter.to) moveConds.push(lte(stockMoves.docDate, filter.to));
  const [moveAgg] = await client
    .select({
      loss: sql<string>`coalesce(-sum(${stockMoves.valueDeltaKopecks}) FILTER (WHERE ${stockMoves.kind} = 'writeoff'), 0)`,
      shortage: sql<string>`coalesce(-sum(${stockMoves.valueDeltaKopecks}) FILTER (WHERE ${stockMoves.reason} = 'mp_shortage'), 0)`,
      cogs: sql<string>`coalesce(-sum(${stockMoves.valueDeltaKopecks}) FILTER (WHERE ${stockMoves.kind} = 'sale'), 0)`,
    })
    .from(stockMoves)
    .where(and(...moveConds));

  return {
    rows: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      number: r.number,
      docDate: r.docDate,
      supplier: r.supplier,
      docNumber: r.docNumber,
      totalKopecks: num(r.totalKopecks),
      vatTotalKopecks: num(r.vatTotalKopecks),
      extraCostKopecks: num(r.extraCostKopecks),
      costBasis: r.costBasis,
      linesCount: num(r.linesCount),
      qtyTotal: num(r.qtyTotal),
      reversesDocId: r.reversesDocId,
      comment: r.comment,
      postedAt: r.postedAt ? r.postedAt.toISOString() : null,
    })),
    totals: {
      purchasesKopecks: num(agg?.total),
      docsCount: num(agg?.count),
      /** Все потери периода (списания + недостачи маркетплейса), копейки. */
      lossKopecks: num(moveAgg?.loss),
      /** Из них — съедено маркетплейсом при приёмке (reason='mp_shortage'). */
      mpShortageKopecks: num(moveAgg?.shortage),
      /** Себестоимость проданного по каналам с журналом (WB/ЯМ/сайты). */
      salesCogsKopecks: num(moveAgg?.cogs),
    },
  };
}

export interface StockDocLineView {
  id: string;
  lineNo: number;
  itemId: string;
  itemSku: string;
  itemName: string;
  direction: 'in' | 'out';
  qty: number;
  unitPriceKopecks: number;
  vatRateBp: number;
  vatKopecks: number;
  extraAllocKopecks: number;
  valueKopecks: number;
  batchNumber: string | null;
  expiresAt: string | null;
  isEstimated: boolean;
  /** adjust — посчитанный факт; accept — сколько принял маркетплейс. */
  countedQty: number | null;
  /** regrade — номер расходной строки, чью стоимость забрала эта приходная. */
  pairLineNo: number | null;
  comment: string | null;
}

export async function getStockDoc(
  ctx: StockCtx,
  docId: string,
  client: StockDb = db,
): Promise<{ doc: StockDoc; lines: StockDocLineView[] } | null> {
  const [doc] = await client
    .select()
    .from(stockDocs)
    .where(and(eq(stockDocs.tenantId, ctx.tenantId), eq(stockDocs.id, docId)))
    .limit(1);
  if (!doc) return null;

  const lines = await client
    .select({
      id: stockDocLines.id,
      lineNo: stockDocLines.lineNo,
      itemId: stockDocLines.itemId,
      itemSku: stockItems.sku,
      itemName: stockItems.name,
      direction: stockDocLines.direction,
      qty: stockDocLines.qty,
      unitPriceKopecks: stockDocLines.unitPriceKopecks,
      vatRateBp: stockDocLines.vatRateBp,
      vatKopecks: stockDocLines.vatKopecks,
      extraAllocKopecks: stockDocLines.extraAllocKopecks,
      valueKopecks: stockDocLines.valueKopecks,
      batchNumber: stockDocLines.batchNumber,
      expiresAt: stockDocLines.expiresAt,
      isEstimated: stockDocLines.isEstimated,
      countedQty: stockDocLines.countedQty,
      pairLineNo: stockDocLines.pairLineNo,
      comment: stockDocLines.comment,
    })
    .from(stockDocLines)
    .innerJoin(stockItems, eq(stockItems.id, stockDocLines.itemId))
    .where(
      and(eq(stockDocLines.tenantId, ctx.tenantId), eq(stockDocLines.docId, docId)),
    )
    .orderBy(asc(stockDocLines.lineNo));

  return {
    doc,
    lines: lines.map((l) => ({
      ...l,
      qty: num(l.qty),
      unitPriceKopecks: num(l.unitPriceKopecks),
      vatKopecks: num(l.vatKopecks),
      extraAllocKopecks: num(l.extraAllocKopecks),
      valueKopecks: num(l.valueKopecks),
    })),
  };
}

/** Автокомплит поставщиков: справочника в v1 нет, только SELECT DISTINCT (§2.4). */
export async function listSuppliers(
  ctx: StockCtx,
  client: StockDb = db,
): Promise<string[]> {
  const rows = await client
    .selectDistinct({ supplier: stockDocs.supplier })
    .from(stockDocs)
    .where(and(eq(stockDocs.tenantId, ctx.tenantId), sql`${stockDocs.supplier} <> ''`))
    .orderBy(asc(stockDocs.supplier))
    .limit(200);
  return rows.map((r) => r.supplier);
}

// ---------------------------------------------------------------------------
// Карточка товара
// ---------------------------------------------------------------------------

export interface StockItemCard {
  item: StockItem;
  links: StockLinkRow[];
  balances: Array<{ placeId: string; placeCode: string; placeName: string; qty: number; valueKopecks: number }>;
  externalBalances: ExternalBalanceRow[];
  batches: Array<{
    id: string;
    lotNo: string | null;
    batchNumber: string | null;
    supplier: string;
    receivedAt: string;
    expiresAt: string | null;
    qtyIn: number;
    qtyLeft: number;
    unitCostKopecks: number;
    valueInKopecks: number;
    costBasis: string;
    isEstimated: boolean;
  }>;
  moves: Array<{
    id: string;
    seq: number;
    docId: string;
    docDate: string;
    kind: string;
    reason: string | null;
    placeId: string;
    qtyDelta: number;
    valueDeltaKopecks: number;
    unitValueKopecks: number;
    uncoveredQty: number;
  }>;
}

export async function getStockItemCard(
  ctx: StockCtx,
  itemId: string,
  client: StockDb = db,
): Promise<StockItemCard | null> {
  const [item] = await client
    .select()
    .from(stockItems)
    .where(and(eq(stockItems.tenantId, ctx.tenantId), eq(stockItems.id, itemId)))
    .limit(1);
  if (!item) return null;

  const [places, links, ledger, external, batches, moves] = await Promise.all([
    listStockPlaces(ctx, client),
    listStockLinks(ctx, { itemId }, client),
    getLedgerBalances(ctx, [itemId], client),
    getOzonExternalBalances(ctx, client),
    client
      .select()
      .from(stockBatches)
      .where(and(eq(stockBatches.tenantId, ctx.tenantId), eq(stockBatches.itemId, itemId)))
      .orderBy(desc(stockBatches.receivedAt))
      .limit(200),
    client
      .select()
      .from(stockMoves)
      .where(and(eq(stockMoves.tenantId, ctx.tenantId), eq(stockMoves.itemId, itemId)))
      .orderBy(desc(stockMoves.docDate), desc(stockMoves.seq))
      .limit(200),
  ]);

  const placeById = new Map(places.map((p) => [p.id, p]));

  return {
    item,
    links,
    balances: ledger.map((b) => ({
      placeId: b.placeId,
      placeCode: placeById.get(b.placeId)?.code ?? '',
      placeName: placeById.get(b.placeId)?.name ?? '',
      qty: b.qty,
      valueKopecks: b.valueKopecks,
    })),
    externalBalances: external.filter((e) => e.itemId === itemId),
    batches: batches.map((b) => ({
      id: b.id,
      lotNo: b.lotNo,
      batchNumber: b.batchNumber,
      supplier: b.supplier,
      receivedAt: b.receivedAt,
      expiresAt: b.expiresAt,
      qtyIn: b.qtyIn,
      qtyLeft: b.qtyLeft,
      unitCostKopecks: num(b.unitCostKopecks),
      valueInKopecks: num(b.valueInKopecks),
      costBasis: b.costBasis,
      isEstimated: b.isEstimated,
    })),
    moves: moves.map((m) => ({
      id: m.id,
      seq: num(m.seq),
      docId: m.docId,
      docDate: m.docDate,
      kind: m.kind,
      reason: m.reason,
      placeId: m.placeId,
      qtyDelta: m.qtyDelta,
      valueDeltaKopecks: num(m.valueDeltaKopecks),
      unitValueKopecks: num(m.unitValueKopecks),
      uncoveredQty: m.uncoveredQty,
    })),
  };
}

// ---------------------------------------------------------------------------
// Сроки годности (§7 блок 5) — для БАДов самый дешёвый способ окупить модуль
// ---------------------------------------------------------------------------

/** Светофор партии по остатку срока. */
export type ExpiryStatus = 'expired' | 'critical' | 'soon' | 'ok';

export interface ExpiringBatchRow {
  batchId: string;
  itemId: string;
  sku: string;
  name: string;
  brand: string | null;
  lotNo: string | null;
  batchNumber: string | null;
  supplier: string;
  receivedAt: string;
  /** 'YYYY-MM-DD'; строки без срока сюда не попадают. */
  expiresAt: string;
  /** Дней до срока по календарю Москвы; отрицательное — уже просрочено. */
  daysLeft: number;
  qtyLeft: number;
  /**
   * ТЕКУЩАЯ себестоимость единицы товара (override, иначе скользящая средняя
   * пула) — именно по ней спишется партия, если протухнет (§4.4), и именно ею
   * оценивает остаток блок «Склад · Остатки».
   */
  unitCostKopecks: number;
  /**
   * Витринная цена прихода САМОЙ партии — `round(value_in/qty_in)`. Держится
   * рядом справочно («по какой цене брали»), в оценке НЕ участвует: схема
   * помечает это поле «для оценки не используется» (§2.6).
   */
  batchUnitCostKopecks: number;
  /** qty_left × текущая себестоимость — сколько денег на кону. */
  valueKopecks: number;
  isEstimated: boolean;
  status: ExpiryStatus;
}

export interface ExpiryResult {
  today: string;
  rows: ExpiringBatchRow[];
  /** Партий под фильтр ВСЕГО (без limit) — витрина может быть усечена. */
  totalCount: number;
  /** rows короче реального списка: цифры в totals всё равно полные. */
  truncated: boolean;
  /** Порядок списания штук из партий (§2.8) — от него зависит, что заберёт FEFO. */
  lotPolicy: StockSettingsRow['lotPolicy'];
  totals: {
    /** Деньги в партиях, попавших в горизонт. ВКЛЮЧАЕТ просрочку. */
    valueKopecks: number;
    expiredValueKopecks: number;
    expiredCount: number;
    criticalCount: number;
    soonCount: number;
    qtyLeft: number;
    /**
     * Партий, у товара которых себестоимость неизвестна (нет override и
     * avg = 0). Их вклад в «деньги под риском» — ноль, и это НЕ «бесплатно»
     * (§1.10): цифру надо показывать рядом с суммой, иначе сумма врёт вниз.
     */
    noCostCount: number;
  };
}

export interface ExpiryFilter {
  /** Горизонт в днях (по умолчанию 90). Просроченное показывается всегда. */
  horizonDays?: number;
  /** Порог «красной зоны», дней (по умолчанию 14). */
  criticalDays?: number;
  limit?: number;
}

/**
 * Партии с истекающим сроком (§7 блок 5). Источник — stock_batches: в режиме
 * avg партия несёт ШТУКИ и СРОК, поэтому «что протухает» видно только по ней,
 * а не по пулу товара.
 *
 * Даты сравниваются по календарю МОСКВЫ (todayIsoDate): срок годности — вопрос
 * календарного дня, и у пользователя западнее UTC «сегодня» сервера сдвинуло бы
 * светофор на сутки.
 *
 * ДВА ЗАПРОСА, А НЕ ОДИН — ЭТО НЕ ИЗБЫТОЧНОСТЬ (регресс ревью Релиза 2).
 * Итоги считаются ОТДЕЛЬНЫМ агрегатом по тому же WHERE, БЕЗ limit, а limit
 * оставлен только витрине. Пока сумма считалась `reduce`'ом по уже усечённому
 * списку, «Деньги под риском» занижались тем сильнее, чем больше партий, и
 * молча: в WHERE нет нижней границы по expires_at, поэтому просрочка копится и
 * при `ORDER BY expires_at ASC` вытесняет всё остальное за лимит. Тот же приём,
 * что у listStockDocs с потерями и COGS.
 *
 * ОЦЕНКА — ПО ТЕКУЩЕЙ СЕБЕСТОИМОСТИ ТОВАРА (override, иначе скользящая
 * средняя), а не по `stock_batches.unit_cost_kopecks`: то поле схема прямо
 * помечает «витринное, для оценки не используется» (§2.6), а списание партии
 * забирает долю ОСТАТОЧНОЙ стоимости пула (§4.4). Побочный эффект правильный:
 * сумма блока сходится с «Деньги в товаре» в stock.balances, который считает
 * ровно так же.
 */
export async function getExpiringBatches(
  ctx: StockCtx,
  filter: ExpiryFilter = {},
  client: StockDb = db,
): Promise<ExpiryResult> {
  const today = todayIsoDate();
  const horizonDays = Math.min(730, Math.max(1, Math.trunc(filter.horizonDays ?? 90)));
  const criticalDays = Math.max(0, Math.trunc(filter.criticalDays ?? 14));
  const horizonDate = shiftIsoDate(today, horizonDays);
  // Граница красной зоны датой, а не арифметикой дней в SQL: `daysLeft <=
  // criticalDays` ⟺ `expires_at <= today + criticalDays`, и обе ветки (JS-строки
  // и SQL-агрегат) обязаны делить светофор ОДИНАКОВО.
  const criticalDate = shiftIsoDate(today, criticalDays);
  const limit = Math.min(1000, Math.max(1, filter.limit ?? 300));

  // Один набор условий на витрину и на агрегат: разъехавшийся WHERE — это
  // «итоги не про то, что показано», и заметить это по цифрам невозможно.
  const conds = and(
    eq(stockBatches.tenantId, ctx.tenantId),
    // tenant_id по обеим таблицам: join сам по себе скоуп не гарантирует.
    eq(stockItems.tenantId, ctx.tenantId),
    sql`${stockBatches.qtyLeft} > 0`,
    sql`${stockBatches.expiresAt} is not null`,
    lte(stockBatches.expiresAt, horizonDate),
  );

  /** Текущая себестоимость единицы: override важнее средней (как в balances). */
  const unitCostSql = sql<string>`coalesce(${stockItems.costOverrideKopecks}, ${stockItems.avgCostKopecks}, 0)`;

  const [rows, aggRows, settings] = await Promise.all([
    client
      .select({
        batchId: stockBatches.id,
        itemId: stockBatches.itemId,
        sku: stockItems.sku,
        name: stockItems.name,
        brand: stockItems.brand,
        lotNo: stockBatches.lotNo,
        batchNumber: stockBatches.batchNumber,
        supplier: stockBatches.supplier,
        receivedAt: stockBatches.receivedAt,
        expiresAt: stockBatches.expiresAt,
        qtyLeft: stockBatches.qtyLeft,
        batchUnitCostKopecks: stockBatches.unitCostKopecks,
        unitCostKopecks: unitCostSql,
        isEstimated: stockBatches.isEstimated,
      })
      .from(stockBatches)
      .innerJoin(stockItems, eq(stockItems.id, stockBatches.itemId))
      .where(conds)
      .orderBy(asc(stockBatches.expiresAt), asc(stockItems.name))
      .limit(limit),
    client
      .select({
        totalCount: sql<string>`count(*)`,
        qtyLeft: sql<string>`coalesce(sum(${stockBatches.qtyLeft}), 0)`,
        value: sql<string>`coalesce(sum(${stockBatches.qtyLeft} * ${unitCostSql}), 0)`,
        expiredValue: sql<string>`coalesce(sum(${stockBatches.qtyLeft} * ${unitCostSql}) FILTER (WHERE ${stockBatches.expiresAt} < ${today}), 0)`,
        expiredCount: sql<string>`count(*) FILTER (WHERE ${stockBatches.expiresAt} < ${today})`,
        criticalCount: sql<string>`count(*) FILTER (WHERE ${stockBatches.expiresAt} >= ${today} AND ${stockBatches.expiresAt} <= ${criticalDate})`,
        soonCount: sql<string>`count(*) FILTER (WHERE ${stockBatches.expiresAt} > ${criticalDate})`,
        noCostCount: sql<string>`count(*) FILTER (WHERE ${unitCostSql} <= 0)`,
      })
      .from(stockBatches)
      .innerJoin(stockItems, eq(stockItems.id, stockBatches.itemId))
      .where(conds),
    getStockSettings(ctx, client),
  ]);

  const out: ExpiringBatchRow[] = rows.map((r) => {
    const expiresAt = r.expiresAt as string;
    const daysLeft = diffIsoDays(today, expiresAt);
    const unitCost = num(r.unitCostKopecks);
    return {
      batchId: r.batchId,
      itemId: r.itemId,
      sku: r.sku,
      name: r.name,
      brand: r.brand,
      lotNo: r.lotNo,
      batchNumber: r.batchNumber,
      supplier: r.supplier,
      receivedAt: r.receivedAt,
      expiresAt,
      daysLeft,
      qtyLeft: r.qtyLeft,
      unitCostKopecks: unitCost,
      batchUnitCostKopecks: num(r.batchUnitCostKopecks),
      valueKopecks: unitCost * r.qtyLeft,
      isEstimated: r.isEstimated,
      status:
        daysLeft < 0
          ? 'expired'
          : daysLeft <= criticalDays
            ? 'critical'
            : 'soon',
    };
  });

  const agg = aggRows[0];
  const totalCount = num(agg?.totalCount);

  return {
    today,
    rows: out,
    totalCount,
    truncated: totalCount > out.length,
    lotPolicy: settings.lotPolicy,
    totals: {
      valueKopecks: num(agg?.value),
      expiredValueKopecks: num(agg?.expiredValue),
      expiredCount: num(agg?.expiredCount),
      criticalCount: num(agg?.criticalCount),
      soonCount: num(agg?.soonCount),
      qtyLeft: num(agg?.qtyLeft),
      noCostCount: num(agg?.noCostCount),
    },
  };
}

/** Разница в календарных днях между двумя 'YYYY-MM-DD' (b - a). */
function diffIsoDays(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const dbb = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(da) || !Number.isFinite(dbb)) return 0;
  return Math.round((dbb - da) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Карантин (§1.10 «молчаливого нуля не бывает»)
// ---------------------------------------------------------------------------

export interface QuarantineSaleRow {
  /** Позиция канала. */
  externalId: string;
  externalSku: string | null;
  name: string | null;
  qty: number;
  revenueKopecks: number;
  /** Есть ли сшивка с нашим товаром. */
  itemId: string | null;
  itemName: string | null;
}

export interface StockQuarantine {
  /** Продажи по позициям, у которых нет сшивки товар ↔ SKU канала (усечено). */
  unlinkedSales: QuarantineSaleRow[];
  /** Продажи сшитых товаров, у которых себестоимость неизвестна (0 и нет override). */
  salesWithoutCost: QuarantineSaleRow[];
  /** Отрицательные остатки (allow_negative=true — это не ошибка, но требует внимания). */
  negativePools: Array<{ itemId: string; sku: string; name: string; qtyPool: number }>;
  /** Движения, которые пул не смог покрыть (uncovered_qty > 0). */
  uncoveredMoves: Array<{
    itemId: string;
    sku: string;
    name: string;
    docId: string;
    docDate: string;
    uncoveredQty: number;
  }>;
  /**
   * Счётчики и суммы — ПОЛНЫЕ (агрегат по всему набору), даже когда списки выше
   * усечены лимитом. Раньше они считались `reduce`'ом по усечённым спискам, и
   * витринная «Выручка мимо себестоимости» занижалась молча.
   */
  totals: {
    unlinkedRevenueKopecks: number;
    withoutCostRevenueKopecks: number;
    unlinkedCount: number;
    withoutCostCount: number;
    negativeCount: number;
    uncoveredCount: number;
    uncoveredQty: number;
  };
  /** Какие списки короче реальности — блок обязан это показать человеку. */
  truncated: { sales: boolean; negative: boolean; uncovered: boolean };
}

/**
 * Единый карантин для блока stock.gaps (R2) и для бейджа на stock.balances (R1).
 * Считает продажи Ozon за период и делит их на три корзины: без сшивки,
 * без себестоимости, покрытые. Первые две — не «COGS = 0», а работа для человека.
 */
export async function getStockQuarantine(
  ctx: StockCtx,
  period: { from: string; to: string },
  client: StockDb = db,
): Promise<StockQuarantine> {
  const fromIso = `${period.from}T00:00:00.000Z`;
  const toIso = `${period.to}T23:59:59.999Z`;

  // Витрина (LIMIT) и ИТОГИ считаются одним проходом: `grouped` — общий CTE, из
  // него отдельно берётся топ-500 строк и отдельно агрегат по ВСЕМУ набору,
  // приклеенный к каждой строке через CROSS JOIN. Так «Выручка мимо
  // себестоимости» перестала зависеть от лимита витрины (регресс ревью Р2:
  // сумма считалась reduce'ом по усечённому списку и молча занижалась).
  // Пустой набор даёт ноль строк — и итоги там честно нулевые.
  const salesRows = await client.execute<{
    offer_id: string | null;
    sku: string | null;
    name: string | null;
    qty: string;
    revenue: string;
    item_id: string | null;
    item_name: string | null;
    unit_cost: string | null;
    unlinked_count: string;
    unlinked_revenue: string;
    without_cost_count: string;
    without_cost_revenue: string;
  }>(sql`
    WITH sold AS (
      SELECT
        (it->>'offerId')::text AS offer_id,
        (it->>'sku')::text AS sku,
        (it->>'name')::text AS name,
        COALESCE(NULLIF(it->>'quantity', '')::numeric, 0) AS qty,
        COALESCE(NULLIF(it->>'price', '')::numeric, 0) AS price_rub
      FROM ozon_orders o
      CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
      WHERE o.tenant_id = ${ctx.tenantId}
        AND o.order_created_at >= ${fromIso}::timestamp
        AND o.order_created_at <= ${toIso}::timestamp
        AND o.cancelled_at IS NULL
        AND o.returned_at IS NULL
        AND lower(o.status) NOT LIKE '%cancel%'
        AND lower(o.status) NOT LIKE '%return%'
    ),
    grouped AS (
      SELECT
        sold.offer_id,
        sold.sku,
        max(sold.name) AS name,
        SUM(sold.qty) AS qty,
        ROUND(SUM(sold.qty * sold.price_rub) * 100) AS revenue,
        max(si.id::text) AS item_id,
        max(si.name) AS item_name,
        max(COALESCE(si.cost_override_kopecks, si.avg_cost_kopecks)) AS unit_cost
      FROM sold
      LEFT JOIN LATERAL (
        SELECT sl.item_id
        FROM stock_item_links sl
        WHERE sl.tenant_id = ${ctx.tenantId}
          AND sl.channel = 'ozon'
          AND (sl.external_id = sold.offer_id OR sl.external_sku = sold.sku)
        ORDER BY (sl.external_id = sold.offer_id) DESC, sl.id
        LIMIT 1
      ) l ON TRUE
      LEFT JOIN stock_items si
        ON si.id = l.item_id AND si.tenant_id = ${ctx.tenantId}
      GROUP BY sold.offer_id, sold.sku
    ),
    tot AS (
      SELECT
        count(*) FILTER (WHERE item_id IS NULL) AS unlinked_count,
        COALESCE(sum(revenue) FILTER (WHERE item_id IS NULL), 0) AS unlinked_revenue,
        count(*) FILTER (WHERE item_id IS NOT NULL AND COALESCE(unit_cost, 0) <= 0)
          AS without_cost_count,
        COALESCE(
          sum(revenue) FILTER (WHERE item_id IS NOT NULL AND COALESCE(unit_cost, 0) <= 0),
          0
        ) AS without_cost_revenue
      FROM grouped
    )
    SELECT g.*, t.*
    FROM (SELECT * FROM grouped ORDER BY revenue DESC LIMIT 500) g
    CROSS JOIN tot t
  `);

  const unlinkedSales: QuarantineSaleRow[] = [];
  const salesWithoutCost: QuarantineSaleRow[] = [];
  const salesArray = Array.from(salesRows);
  for (const r of salesArray) {
    const row: QuarantineSaleRow = {
      externalId: r.offer_id ?? r.sku ?? '',
      externalSku: r.sku,
      name: r.name,
      qty: num(r.qty),
      revenueKopecks: num(r.revenue),
      itemId: r.item_id,
      itemName: r.item_name,
    };
    if (!r.item_id) unlinkedSales.push(row);
    else if (num(r.unit_cost) <= 0) salesWithoutCost.push(row);
  }
  // Итоги приклеены к каждой строке (CROSS JOIN) — берём с первой; пустой
  // набор строк означает пустой карантин, и нули здесь не «потерянные данные».
  const salesAgg = salesArray[0];
  const unlinkedCount = num(salesAgg?.unlinked_count);
  const withoutCostCount = num(salesAgg?.without_cost_count);

  // Счётчики отдельным агрегатом по тому же WHERE: length усечённого списка —
  // это «сколько влезло на витрину», а не «сколько есть».
  const [negativeRows, negativeAgg, uncoveredRows, uncoveredAgg] = await Promise.all([
    client
      .select({
        itemId: stockItems.id,
        sku: stockItems.sku,
        name: stockItems.name,
        qtyPool: stockItems.qtyPool,
      })
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, ctx.tenantId), sql`${stockItems.qtyPool} < 0`))
      .orderBy(asc(stockItems.qtyPool))
      .limit(200),
    client
      .select({ count: sql<string>`count(*)` })
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, ctx.tenantId), sql`${stockItems.qtyPool} < 0`)),
    client
      .select({
        itemId: stockMoves.itemId,
        sku: stockItems.sku,
        name: stockItems.name,
        docId: stockMoves.docId,
        docDate: stockMoves.docDate,
        uncoveredQty: stockMoves.uncoveredQty,
      })
      .from(stockMoves)
      .innerJoin(stockItems, eq(stockItems.id, stockMoves.itemId))
      .where(
        and(
          eq(stockMoves.tenantId, ctx.tenantId),
          sql`${stockMoves.uncoveredQty} > 0`,
          gte(stockMoves.docDate, period.from),
          lte(stockMoves.docDate, period.to),
        ),
      )
      .orderBy(desc(stockMoves.docDate))
      .limit(200),
    client
      .select({
        count: sql<string>`count(*)`,
        qty: sql<string>`coalesce(sum(${stockMoves.uncoveredQty}), 0)`,
      })
      .from(stockMoves)
      .where(
        and(
          eq(stockMoves.tenantId, ctx.tenantId),
          sql`${stockMoves.uncoveredQty} > 0`,
          gte(stockMoves.docDate, period.from),
          lte(stockMoves.docDate, period.to),
        ),
      ),
  ]);

  const negativeCount = num(negativeAgg[0]?.count);
  const uncoveredCount = num(uncoveredAgg[0]?.count);

  return {
    unlinkedSales,
    salesWithoutCost,
    negativePools: negativeRows,
    uncoveredMoves: uncoveredRows,
    totals: {
      unlinkedRevenueKopecks: num(salesAgg?.unlinked_revenue),
      withoutCostRevenueKopecks: num(salesAgg?.without_cost_revenue),
      unlinkedCount,
      withoutCostCount,
      negativeCount,
      uncoveredCount,
      uncoveredQty: num(uncoveredAgg[0]?.qty),
    },
    truncated: {
      sales:
        unlinkedSales.length < unlinkedCount ||
        salesWithoutCost.length < withoutCostCount,
      negative: negativeRows.length < negativeCount,
      uncovered: uncoveredRows.length < uncoveredCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Пробелы (§7 блок 6) — единый список того, что молча портит цифры
// ---------------------------------------------------------------------------

export interface StockGapItemRow {
  itemId: string;
  sku: string;
  name: string;
  qtyPool: number;
  totalQty: number;
}

export interface StockGapsResult {
  period: { from: string; to: string };
  /** Продажи по позициям канала без сшивки — с суммой выручки (§1.10). */
  unlinkedSales: QuarantineSaleRow[];
  /** Продажи сшитых товаров, у которых себестоимость неизвестна. */
  salesWithoutCost: QuarantineSaleRow[];
  /** Позиции Ozon без сшивки (есть остаток, но нет нашего товара). */
  unmatched: UnmatchedChannelRow[];
  /** Товары с остатком, но без себестоимости — рабочий to-do список (§8 шаг 4). */
  itemsWithoutCost: StockGapItemRow[];
  /** Отрицательные остатки — не ошибка (allow_negative), но требуют внимания. */
  negativePools: StockQuarantine['negativePools'];
  /** Движения, которые пул не смог покрыть. */
  uncoveredMoves: StockQuarantine['uncoveredMoves'];
  /** Открытые расхождения сверки с маркетплейсом (наполняется отдельным роутом). */
  reconOpenCount: number;
  /**
   * Счётчики и суммы — ПОЛНЫЕ (агрегаты по всему набору), списки выше — усечённые
   * витрины. Раньше счётчики брались из `.length` усечённых списков и молча
   * занижали и работу, и её цену.
   */
  totals: {
    /** Выручка, которая сейчас идёт мимо себестоимости, — цена бездействия. */
    quarantineRevenueKopecks: number;
    unlinkedRevenueKopecks: number;
    withoutCostRevenueKopecks: number;
    unlinkedCount: number;
    withoutCostCount: number;
    unmatchedCount: number;
    noCostItemsCount: number;
    negativeCount: number;
    uncoveredCount: number;
    uncoveredQty: number;
    /** Сколько всего строк требует действия — бейдж на блоке. */
    gapsCount: number;
  };
  /**
   * Какие витрины короче реальности. Показывается человеку словами: молчаливое
   * усечение списка работы — то же «молчаливого нуля не бывает» (§1.10).
   */
  truncated: {
    sales: boolean;
    unmatched: boolean;
    noCostItems: boolean;
    negative: boolean;
    uncovered: boolean;
  };
}

/**
 * Единый экран «Пробелы» (блок stock.gaps): всё, что сейчас тихо искажает
 * себестоимость и прибыль. Ни одна из этих строк не является технической
 * ошибкой — это список работы для человека, и у каждой строки есть цена
 * (выручка мимо COGS, штуки без покрытия, деньги в непосчитанном остатке).
 */
export async function getStockGaps(
  ctx: StockCtx,
  period: { from: string; to: string },
  client: StockDb = db,
): Promise<StockGapsResult> {
  // Условие «товар с остатком, но без себестоимости» — ОДНО на витрину и на
  // счётчик: разъехавшись, они дали бы «в списке 200, в бейдже 173».
  const noCostConds = and(
    eq(stockItems.tenantId, ctx.tenantId),
    eq(stockItems.isActive, true),
    sql`${stockItems.costOverrideKopecks} is null`,
    sql`${stockItems.avgCostKopecks} <= 0`,
    sql`${stockItems.qtyPool} <> 0`,
  );

  const [quarantine, unmatched, noCostRows, noCostAgg, reconRows] = await Promise.all([
    getStockQuarantine(ctx, period, client),
    getUnmatchedOzonOffers(ctx, client),
    client
      .select({
        itemId: stockItems.id,
        sku: stockItems.sku,
        name: stockItems.name,
        qtyPool: stockItems.qtyPool,
      })
      .from(stockItems)
      .where(noCostConds)
      .orderBy(desc(stockItems.qtyPool))
      .limit(NO_COST_ITEMS_LIMIT),
    client.select({ count: sql<string>`count(*)` }).from(stockItems).where(noCostConds),
    client
      .select({ count: sql<string>`count(*)` })
      .from(stockRecon)
      .where(and(eq(stockRecon.tenantId, ctx.tenantId), eq(stockRecon.status, 'open'))),
  ]);

  const itemsWithoutCost: StockGapItemRow[] = noCostRows.map((r) => ({
    itemId: r.itemId,
    sku: r.sku,
    name: r.name,
    qtyPool: r.qtyPool,
    totalQty: r.qtyPool,
  }));

  const unlinkedRevenueKopecks = quarantine.totals.unlinkedRevenueKopecks;
  const withoutCostRevenueKopecks = quarantine.totals.withoutCostRevenueKopecks;
  const noCostItemsCount = num(noCostAgg[0]?.count);
  // Позиции канала без сшивки приходят одним списком с жёстким LIMIT внутри
  // getUnmatchedOzonOffers: отдельного счётчика у него нет, поэтому «упёрлись в
  // потолок» определяется по длине — честнее, чем молча показать ровный лимит.
  const unmatchedCount = unmatched.length;

  return {
    period,
    unlinkedSales: quarantine.unlinkedSales,
    salesWithoutCost: quarantine.salesWithoutCost,
    unmatched,
    itemsWithoutCost,
    negativePools: quarantine.negativePools,
    uncoveredMoves: quarantine.uncoveredMoves,
    reconOpenCount: num(reconRows[0]?.count),
    totals: {
      quarantineRevenueKopecks: unlinkedRevenueKopecks + withoutCostRevenueKopecks,
      unlinkedRevenueKopecks,
      withoutCostRevenueKopecks,
      unlinkedCount: quarantine.totals.unlinkedCount,
      withoutCostCount: quarantine.totals.withoutCostCount,
      unmatchedCount,
      noCostItemsCount,
      negativeCount: quarantine.totals.negativeCount,
      uncoveredCount: quarantine.totals.uncoveredCount,
      uncoveredQty: quarantine.totals.uncoveredQty,
      gapsCount:
        quarantine.totals.unlinkedCount +
        quarantine.totals.withoutCostCount +
        unmatchedCount +
        noCostItemsCount +
        quarantine.totals.negativeCount +
        quarantine.totals.uncoveredCount,
    },
    truncated: {
      sales: quarantine.truncated.sales,
      unmatched: unmatched.length >= UNMATCHED_OFFERS_LIMIT,
      noCostItems: itemsWithoutCost.length < noCostItemsCount,
      negative: quarantine.truncated.negative,
      uncovered: quarantine.truncated.uncovered,
    },
  };
}
