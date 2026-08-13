// PURPOSE: Перенос пользователя с бумаги, шаги 1-4 (docs/STOCK_MODULE_DESIGN.md §8):
// импорт номенклатуры из Ozon одной кнопкой, экран сопоставления «товар ↔ SKU канала»
// и шаблон стартового документа `opening`.
//
// ГЛАВНОЕ ОГРАНИЧЕНИЕ (§10 риск 6): stock_items НИКОГДА не создаётся из канала
// автоматически. Ошибка в qty_per_unit портит остатки и себестоимость КРАТНО,
// поэтому каждая создаваемая позиция и каждая сшивка проходят через явный
// список id, пришедший с экрана подтверждения. Фоновой ветки «синк увидел новый
// offer_id → завёл товар» в модуле нет и быть не должно.
//
// Автоподбор кандидатов — чистый src/lib/stock/links.ts (64 теста в
// scripts/test-stock-matching.ts). Здесь только доступ к БД и запись.

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { stockItemLinks, stockItems } from '@/lib/db/schema/stock';
import { marketplaceAccounts } from '@/lib/db/schema/marketplaces';
import { unitProducts } from '@/lib/db/schema/unit-economics';
import {
  extractPackQty,
  suggestLinks,
  type MatchCandidate,
  type MatchItem,
  type MatchRow,
} from './links';
import type { StockCtx, StockDb } from './queries';
import { StockError } from './posting';

// ---------------------------------------------------------------------------
// Шаг 1 — номенклатура из Ozon
// ---------------------------------------------------------------------------

export interface OzonImportCandidate {
  unitProductId: string;
  /** Артикул продавца (offer_id) — станет sku нашего товара. */
  article: string | null;
  /** Числовой sku Ozon — второй ключ сшивки. */
  sku: string | null;
  name: string;
  barcode: string | null;
  accountId: string | null;
  /** Себестоимость, которая уже стоит в карточке (ручная) — подсказка для opening. */
  costKopecks: number;
  /** Остаток на складах Ozon по данным синка (для стартового документа). */
  stockMarketplace: number;
  stockOwn: number;
  /** Сшивка уже есть — импорт такую позицию пропустит. */
  linkedItemId: string | null;
  linkedItemSku: string | null;
  /** Наш товар с таким же sku уже существует — будет только сшивка, без создания. */
  existingItemId: string | null;
  /** Сколько базовых единиц в карточке: «3 банки» → 3 (§2.3). */
  suggestedQtyPerUnit: number;
}

/**
 * Что даст кнопка «Импортировать номенклатуру из Ozon». Ничего не пишет —
 * это превью для диалога подтверждения (§8 шаг 1: 1 клик, 5 секунд, но клик
 * осознанный).
 */
export async function previewOzonImport(
  ctx: StockCtx,
  client: StockDb = db,
): Promise<{
  candidates: OzonImportCandidate[];
  totals: { total: number; willCreate: number; willLinkOnly: number; alreadyLinked: number };
}> {
  const rows = await client.execute<{
    id: string;
    article: string | null;
    sku: string | null;
    name: string;
    barcode: string | null;
    account_id: string | null;
    cost_kopecks: number | string;
    stock_marketplace: number | string;
    stock_own: number | string;
    linked_item_id: string | null;
    linked_item_sku: string | null;
    existing_item_id: string | null;
  }>(sql`
    SELECT
      up.id,
      up.article,
      up.sku,
      up.name,
      up.barcode,
      up.marketplace_account_id::text AS account_id,
      up.cost_kopecks,
      up.stock_marketplace,
      up.stock_own,
      l.item_id::text  AS linked_item_id,
      li.sku           AS linked_item_sku,
      ei.id::text      AS existing_item_id
    FROM unit_products up
    LEFT JOIN stock_item_links l
      ON l.tenant_id = ${ctx.tenantId} AND l.unit_product_id = up.id
    LEFT JOIN stock_items li
      ON li.id = l.item_id AND li.tenant_id = ${ctx.tenantId}
    LEFT JOIN stock_items ei
      ON ei.tenant_id = ${ctx.tenantId}
     AND ei.sku = COALESCE(NULLIF(up.article, ''), NULLIF(up.sku, ''))
    WHERE up.tenant_id = ${ctx.tenantId}
      AND up.marketplace = 'ozon'
    ORDER BY up.name
    LIMIT 2000
  `);

  const candidates = Array.from(rows).map<OzonImportCandidate>((r) => ({
    unitProductId: r.id,
    article: r.article,
    sku: r.sku,
    name: r.name,
    barcode: r.barcode,
    accountId: r.account_id,
    costKopecks: Number(r.cost_kopecks) || 0,
    stockMarketplace: Number(r.stock_marketplace) || 0,
    stockOwn: Number(r.stock_own) || 0,
    linkedItemId: r.linked_item_id,
    linkedItemSku: r.linked_item_sku,
    existingItemId: r.existing_item_id,
    suggestedQtyPerUnit: extractPackQty(r.name),
  }));

  return {
    candidates,
    totals: {
      total: candidates.length,
      alreadyLinked: candidates.filter((c) => c.linkedItemId).length,
      willLinkOnly: candidates.filter((c) => !c.linkedItemId && c.existingItemId).length,
      willCreate: candidates.filter((c) => !c.linkedItemId && !c.existingItemId).length,
    },
  };
}

export interface OzonImportResult {
  itemsCreated: number;
  linksCreated: number;
  skipped: number;
  /** Позиции, которые нельзя импортировать (нет ни article, ни sku). */
  problems: Array<{ unitProductId: string; name: string; reason: string }>;
}

/**
 * Создаёт номенклатуру и сшивку по ЯВНО выбранным карточкам Ozon (§8 шаг 1).
 * Одна транзакция: полуимпорт (товары есть, сшивки нет) означал бы, что остатки
 * Ozon повиснут в группе «Не сопоставлено», а пользователь будет уверен, что
 * всё связано.
 *
 * qty_per_unit по умолчанию 1 и берётся из явного поля вызова: автоподстановка
 * «3 банки» здесь запрещена (§10 риск 6) — её предлагает экран сопоставления,
 * где человек это подтверждает.
 */
export async function runOzonImport(
  ctx: StockCtx,
  args: {
    /** Явный список карточек. Пустой список = ничего не делаем (не «всё»). */
    unitProductIds: string[];
    /** qty_per_unit, подтверждённый человеком: unitProductId → множитель. */
    qtyPerUnit?: Record<string, number>;
  },
): Promise<OzonImportResult> {
  const ids = Array.from(new Set(args.unitProductIds)).filter(Boolean);
  if (ids.length === 0) {
    return { itemsCreated: 0, linksCreated: 0, skipped: 0, problems: [] };
  }

  return db.transaction(async (tx) => {
    const products = await tx
      .select({
        id: unitProducts.id,
        article: unitProducts.article,
        sku: unitProducts.sku,
        name: unitProducts.name,
        barcode: unitProducts.barcode,
        accountId: unitProducts.marketplaceAccountId,
      })
      .from(unitProducts)
      .where(
        and(
          eq(unitProducts.tenantId, ctx.tenantId),
          eq(unitProducts.marketplace, 'ozon'),
          inArray(unitProducts.id, ids),
        ),
      );

    const problems: OzonImportResult['problems'] = [];
    let itemsCreated = 0;
    let linksCreated = 0;
    let skipped = 0;

    // Существующая номенклатура по sku — чтобы не плодить дубли и не падать
    // на уник-индексе stock_items_tenant_sku_idx.
    const existing = await tx
      .select({ id: stockItems.id, sku: stockItems.sku })
      .from(stockItems)
      .where(eq(stockItems.tenantId, ctx.tenantId));
    const itemIdBySku = new Map(existing.map((e) => [e.sku, e.id]));

    for (const p of products) {
      const sku = (p.article?.trim() || p.sku?.trim() || '').slice(0, 80);
      if (!sku) {
        problems.push({
          unitProductId: p.id,
          name: p.name,
          reason: 'у карточки нет ни артикула, ни sku — нечего сделать внутренним артикулом',
        });
        continue;
      }

      let itemId = itemIdBySku.get(sku);
      if (!itemId) {
        const [created] = await tx
          .insert(stockItems)
          .values({
            tenantId: ctx.tenantId,
            userId: ctx.userId,
            sku,
            name: p.name.slice(0, 500),
            barcode: p.barcode?.slice(0, 200) ?? null,
          })
          .returning({ id: stockItems.id });
        itemId = created.id;
        itemIdBySku.set(sku, itemId);
        itemsCreated += 1;
      }

      const qtyPerUnit = Math.max(1, Math.trunc(args.qtyPerUnit?.[p.id] ?? 1));
      const inserted = await tx
        .insert(stockItemLinks)
        .values({
          tenantId: ctx.tenantId,
          itemId,
          channel: 'ozon',
          // scope_key NOT NULL сознательно (§2.3): nullable-колонка в уникальном
          // индексе Postgres пропускает дубли.
          scopeKey: p.accountId ?? '-',
          externalId: (p.article?.trim() || p.sku?.trim() || sku).slice(0, 200),
          externalSku: p.sku?.slice(0, 200) ?? null,
          qtyPerUnit,
          unitProductId: p.id,
          accountId: p.accountId,
          matchSource: 'sku',
          matchConfidence: 100,
        })
        .onConflictDoNothing({
          target: [
            stockItemLinks.tenantId,
            stockItemLinks.channel,
            stockItemLinks.scopeKey,
            stockItemLinks.externalId,
          ],
        })
        .returning({ id: stockItemLinks.id });
      if (inserted.length > 0) linksCreated += 1;
      else skipped += 1;
    }

    return { itemsCreated, linksCreated, skipped, problems };
  });
}

// ---------------------------------------------------------------------------
// Шаг 3 — экран сопоставления
// ---------------------------------------------------------------------------

export interface MatchingScreenRow {
  /** Позиция канала. */
  externalId: string;
  externalSku: string | null;
  name: string | null;
  barcode: string | null;
  accountId: string | null;
  /** Остаток по данным канала (подсказка «это живой товар, не архив»). */
  channelQty: number;
  /** Уже сшито — строка показывается только при includeLinked. */
  linkedItemId: string | null;
  /** Однозначный автоподбор; null — решает человек (§8 шаг 3). */
  suggestion: (MatchCandidate & { ambiguous: boolean }) | null;
  /** Все правдоподобные кандидаты для выпадающего списка. */
  candidates: MatchCandidate[];
}

/**
 * Данные экрана сопоставления: строки канала × кандидаты нашей номенклатуры.
 * Источник строк — ozon_warehouse_stocks (то, что реально лежит на складах) плюс
 * карточки unit_products без сшивки: вместе они закрывают и «товар есть в
 * каталоге, но не на складе», и «лежит на складе, но карточки у нас нет».
 */
export async function getMatchingScreen(
  ctx: StockCtx,
  opts: { includeLinked?: boolean; limit?: number } = {},
  client: StockDb = db,
): Promise<{ rows: MatchingScreenRow[]; items: MatchItem[] }> {
  const limit = Math.min(1000, Math.max(1, opts.limit ?? 300));

  const itemRows = await client
    .select({
      id: stockItems.id,
      sku: stockItems.sku,
      name: stockItems.name,
      barcode: stockItems.barcode,
      brand: stockItems.brand,
    })
    .from(stockItems)
    .where(and(eq(stockItems.tenantId, ctx.tenantId), eq(stockItems.isActive, true)))
    .limit(2000);
  const items: MatchItem[] = itemRows;

  const channelRows = await client.execute<{
    external_id: string;
    external_sku: string | null;
    name: string | null;
    barcode: string | null;
    account_id: string | null;
    qty: string;
    linked_item_id: string | null;
  }>(sql`
    WITH channel AS (
      SELECT
        COALESCE(NULLIF(ws.offer_id, ''), ws.sku) AS external_id,
        ws.sku                                    AS external_sku,
        NULL::text                                AS name,
        NULL::text                                AS barcode,
        ws.account_id::text                       AS account_id,
        SUM(ws.free_to_sell_amount + ws.reserved_amount)::numeric AS qty
      FROM ozon_warehouse_stocks ws
      WHERE ws.tenant_id = ${ctx.tenantId}
      GROUP BY 1, 2, 5
      UNION
      SELECT
        COALESCE(NULLIF(up.article, ''), up.sku) AS external_id,
        up.sku                                   AS external_sku,
        up.name                                  AS name,
        up.barcode                               AS barcode,
        up.marketplace_account_id::text          AS account_id,
        0::numeric                               AS qty
      FROM unit_products up
      WHERE up.tenant_id = ${ctx.tenantId}
        AND up.marketplace = 'ozon'
        AND COALESCE(NULLIF(up.article, ''), up.sku) IS NOT NULL
    )
    SELECT
      c.external_id,
      max(c.external_sku)  AS external_sku,
      max(c.name)          AS name,
      max(c.barcode)       AS barcode,
      max(c.account_id)    AS account_id,
      SUM(c.qty)           AS qty,
      max(l.item_id::text) AS linked_item_id
    FROM channel c
    LEFT JOIN LATERAL (
      SELECT sl.item_id
      FROM stock_item_links sl
      WHERE sl.tenant_id = ${ctx.tenantId}
        AND sl.channel = 'ozon'
        AND (sl.external_id = c.external_id OR sl.external_sku = c.external_sku)
      ORDER BY (sl.external_id = c.external_id) DESC, sl.id
      LIMIT 1
    ) l ON TRUE
    WHERE c.external_id IS NOT NULL
    GROUP BY c.external_id
    ORDER BY SUM(c.qty) DESC, c.external_id
    LIMIT ${limit}
  `);

  const source = Array.from(channelRows).filter(
    (r) => opts.includeLinked || !r.linked_item_id,
  );
  const matchRows: MatchRow[] = source.map((r) => ({
    externalId: r.external_id,
    externalSku: r.external_sku,
    name: r.name,
    barcode: r.barcode,
    sku: r.external_id,
  }));
  const suggestions = suggestLinks(matchRows, items);

  const rows: MatchingScreenRow[] = source.map((r, i) => ({
    externalId: r.external_id,
    externalSku: r.external_sku,
    name: r.name,
    barcode: r.barcode,
    accountId: r.account_id,
    channelQty: Number(r.qty) || 0,
    linkedItemId: r.linked_item_id,
    suggestion: suggestions[i].suggestion,
    candidates: suggestions[i].candidates,
  }));

  return { rows, items };
}

export interface SaveLinkInput {
  itemId: string;
  channel?: 'ozon' | 'wb' | 'yandex' | 'site';
  scopeKey?: string | null;
  externalId: string;
  externalSku?: string | null;
  /** Подтверждённый человеком множитель «3 банки» → 3. */
  qtyPerUnit?: number;
  unitProductId?: string | null;
  accountId?: string | null;
  matchSource?: 'manual' | 'barcode' | 'name' | 'sku';
  matchConfidence?: number;
}

/** Транзакционный клиент внутри db.transaction — тип берём у самого Drizzle. */
type StockTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Все id из тела запроса, которые попадут в чужие FK-колонки, обязаны
 * принадлежать тенанту сессии. `itemId` проверяется отдельно (он обязателен),
 * здесь — `unit_product_id` и `account_id`: сами по себе они не дают чтения
 * чужих данных (writeback фильтрует unit_products по tenant_id), но записать
 * в свою строку ссылку на чужую карточку без этой проверки можно, а канон
 * security.mdc/TENANT_SCOPING.md требует не принимать id из body на веру.
 */
async function assertLinkRefsBelongToTenant(
  tx: StockTx,
  ctx: StockCtx,
  links: ReadonlyArray<Pick<SaveLinkInput, 'unitProductId' | 'accountId'>>,
): Promise<void> {
  const productIds = Array.from(
    new Set(links.map((l) => l.unitProductId).filter((v): v is string => Boolean(v))),
  );
  if (productIds.length > 0) {
    const known = await tx
      .select({ id: unitProducts.id })
      .from(unitProducts)
      .where(
        and(eq(unitProducts.tenantId, ctx.tenantId), inArray(unitProducts.id, productIds)),
      );
    if (known.length !== productIds.length) {
      throw new StockError(
        'bad_request',
        'В сшивке указана карточка товара из другого аккаунта',
      );
    }
  }

  const accountIds = Array.from(
    new Set(links.map((l) => l.accountId).filter((v): v is string => Boolean(v))),
  );
  if (accountIds.length > 0) {
    const known = await tx
      .select({ id: marketplaceAccounts.id })
      .from(marketplaceAccounts)
      .where(
        and(
          eq(marketplaceAccounts.tenantId, ctx.tenantId),
          inArray(marketplaceAccounts.id, accountIds),
        ),
      );
    if (known.length !== accountIds.length) {
      throw new StockError('bad_request', 'В сшивке указан магазин из другого аккаунта');
    }
  }
}

/**
 * Сохраняет подтверждённые сшивки. Идемпотентно по уникальному ключу
 * (tenant, channel, scope_key, external_id): повторное подтверждение той же
 * строки обновляет товар и qty_per_unit, а не плодит дубль.
 */
export async function saveLinks(
  ctx: StockCtx,
  links: SaveLinkInput[],
): Promise<{ saved: number }> {
  if (!Array.isArray(links) || links.length === 0) return { saved: 0 };

  return db.transaction(async (tx) => {
    const itemIds = Array.from(new Set(links.map((l) => l.itemId)));
    const known = await tx
      .select({ id: stockItems.id })
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, ctx.tenantId), inArray(stockItems.id, itemIds)));
    if (known.length !== itemIds.length) {
      throw new StockError('bad_request', 'В сшивке указан товар из другого аккаунта');
    }
    await assertLinkRefsBelongToTenant(tx, ctx, links);

    let saved = 0;
    for (const link of links) {
      const externalId = link.externalId?.trim();
      if (!externalId) continue;
      const qtyPerUnit = Math.max(1, Math.trunc(link.qtyPerUnit ?? 1));
      await tx
        .insert(stockItemLinks)
        .values({
          tenantId: ctx.tenantId,
          itemId: link.itemId,
          channel: link.channel ?? 'ozon',
          scopeKey: link.scopeKey?.trim() || link.accountId || '-',
          externalId: externalId.slice(0, 200),
          externalSku: link.externalSku?.slice(0, 200) ?? null,
          qtyPerUnit,
          unitProductId: link.unitProductId ?? null,
          accountId: link.accountId ?? null,
          matchSource: link.matchSource ?? 'manual',
          matchConfidence: Math.min(100, Math.max(0, link.matchConfidence ?? 100)),
        })
        .onConflictDoUpdate({
          target: [
            stockItemLinks.tenantId,
            stockItemLinks.channel,
            stockItemLinks.scopeKey,
            stockItemLinks.externalId,
          ],
          // COALESCE-семантика (drizzle.mdc → «onConflictDoUpdate — conditional
          // updates»): поля, которых во входе НЕТ, не перечисляются в set и
          // потому сохраняют прежнее значение. Безусловное `?? null` затирало
          // привязку к карточке товара и магазину при любой повторной сшивке
          // (экран сопоставления шлёт их не всегда) — а `unit_product_id` это
          // единственная нить, по которой себестоимость доезжает до аналитики.
          set: {
            itemId: link.itemId,
            qtyPerUnit,
            ...(link.externalSku != null
              ? { externalSku: link.externalSku.slice(0, 200) }
              : {}),
            ...(link.unitProductId != null
              ? { unitProductId: link.unitProductId }
              : {}),
            ...(link.accountId != null ? { accountId: link.accountId } : {}),
            matchSource: link.matchSource ?? 'manual',
            matchConfidence: Math.min(100, Math.max(0, link.matchConfidence ?? 100)),
            updatedAt: new Date(),
          },
        });
      saved += 1;
    }
    return { saved };
  });
}

export async function deleteLink(ctx: StockCtx, linkId: string): Promise<void> {
  await db
    .delete(stockItemLinks)
    .where(and(eq(stockItemLinks.tenantId, ctx.tenantId), eq(stockItemLinks.id, linkId)));
}

/**
 * Создание товара с экрана сопоставления — единственный разрешённый путь
 * «из канала в номенклатуру», и только по явному нажатию (§10 риск 6).
 */
export async function createItemFromOffer(
  ctx: StockCtx,
  args: {
    sku: string;
    name: string;
    barcode?: string | null;
    brand?: string | null;
    category?: string | null;
    minQty?: number;
    /** Сразу сшить с позицией канала. */
    link?: Omit<SaveLinkInput, 'itemId'>;
  },
): Promise<{ itemId: string }> {
  const sku = args.sku?.trim();
  if (!sku) throw new StockError('bad_request', 'Не задан внутренний артикул товара');

  return db.transaction(async (tx) => {
    // Те же id из body, что и в saveLinks, — та же проверка принадлежности.
    if (args.link) await assertLinkRefsBelongToTenant(tx, ctx, [args.link]);

    const [existing] = await tx
      .select({ id: stockItems.id })
      .from(stockItems)
      .where(and(eq(stockItems.tenantId, ctx.tenantId), eq(stockItems.sku, sku)))
      .limit(1);

    let itemId = existing?.id;
    if (!itemId) {
      const [created] = await tx
        .insert(stockItems)
        .values({
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          sku: sku.slice(0, 80),
          name: (args.name ?? '').slice(0, 500),
          barcode: args.barcode?.slice(0, 200) ?? null,
          brand: args.brand?.slice(0, 120) ?? null,
          category: args.category?.slice(0, 160) ?? null,
          minQty: Math.max(0, Math.trunc(args.minQty ?? 0)),
        })
        .returning({ id: stockItems.id });
      itemId = created.id;
    }

    if (args.link?.externalId) {
      const qtyPerUnit = Math.max(1, Math.trunc(args.link.qtyPerUnit ?? 1));
      await tx
        .insert(stockItemLinks)
        .values({
          tenantId: ctx.tenantId,
          itemId,
          channel: args.link.channel ?? 'ozon',
          scopeKey: args.link.scopeKey?.trim() || args.link.accountId || '-',
          externalId: args.link.externalId.slice(0, 200),
          externalSku: args.link.externalSku?.slice(0, 200) ?? null,
          qtyPerUnit,
          unitProductId: args.link.unitProductId ?? null,
          accountId: args.link.accountId ?? null,
          matchSource: args.link.matchSource ?? 'manual',
          matchConfidence: Math.min(100, Math.max(0, args.link.matchConfidence ?? 100)),
        })
        .onConflictDoNothing({
          target: [
            stockItemLinks.tenantId,
            stockItemLinks.channel,
            stockItemLinks.scopeKey,
            stockItemLinks.externalId,
          ],
        });
    }

    return { itemId };
  });
}

// ---------------------------------------------------------------------------
// Шаг 4 — стартовый документ `opening`
// ---------------------------------------------------------------------------

export interface OpeningTemplateRow {
  itemId: string;
  sku: string;
  name: string;
  brand: string | null;
  /** Что уже лежит на своём складе по журналу (обычно 0 — журнал только начался). */
  ledgerQty: number;
  /** Факт по данным Ozon — справочно, в ledger-остаток НЕ попадает (§3). */
  ozonQty: number;
  /** Подсказка цены: ручная себестоимость из карточки Ozon, если она была. */
  suggestedUnitPriceKopecks: number;
  /** Цена неизвестна — строку придётся пометить «оценочно» (§8 шаг 4). */
  priceUnknown: boolean;
}

/**
 * Шаблон стартового документа: список товаров с подсказками цен и фактическими
 * остатками Ozon. Количества по СВОЕМУ складу пользователь вводит руками —
 * их не знает никто, кроме него (в этом и был смысл бумаги).
 *
 * Строки с qty=0 сохранять не нужно (§8 шаг 4) — это делает вызывающий UI.
 */
export async function getOpeningTemplate(
  ctx: StockCtx,
  client: StockDb = db,
): Promise<{ rows: OpeningTemplateRow[] }> {
  const rows = await client.execute<{
    item_id: string;
    sku: string;
    name: string;
    brand: string | null;
    ledger_qty: string;
    ozon_qty: string;
    suggested_price: string;
  }>(sql`
    SELECT
      si.id::text AS item_id,
      si.sku,
      si.name,
      si.brand,
      si.qty_pool::text AS ledger_qty,
      COALESCE((
        SELECT SUM((ws.free_to_sell_amount + ws.reserved_amount) * l.qty_per_unit)
        FROM stock_item_links l
        JOIN ozon_warehouse_stocks ws
          ON ws.tenant_id = ${ctx.tenantId}
         AND (l.external_id = ws.offer_id OR l.external_sku = ws.sku)
        WHERE l.tenant_id = ${ctx.tenantId}
          AND l.channel = 'ozon'
          AND l.item_id = si.id
      ), 0) AS ozon_qty,
      -- cost_kopecks и qty_per_unit — integer, и деление БЕЗ ::numeric в
      -- Postgres целочисленное: «3 банки по 119,90» дали бы подсказку 39,96 ₽
      -- вместо 39,97 ₽, а из неё вырастает вся себестоимость стартовых остатков.
      COALESCE((
        SELECT MAX(ROUND(up.cost_kopecks::numeric / GREATEST(l2.qty_per_unit, 1)))
        FROM stock_item_links l2
        JOIN unit_products up
          ON up.id = l2.unit_product_id AND up.tenant_id = ${ctx.tenantId}
        WHERE l2.tenant_id = ${ctx.tenantId}
          AND l2.item_id = si.id
          AND up.cost_kopecks > 0
      ), 0) AS suggested_price
    FROM stock_items si
    WHERE si.tenant_id = ${ctx.tenantId}
      AND si.is_active = true
    ORDER BY si.name
    LIMIT 2000
  `);

  return {
    rows: Array.from(rows).map((r) => {
      const suggested = Number(r.suggested_price) || 0;
      return {
        itemId: r.item_id,
        sku: r.sku,
        name: r.name,
        brand: r.brand,
        ledgerQty: Number(r.ledger_qty) || 0,
        ozonQty: Number(r.ozon_qty) || 0,
        suggestedUnitPriceKopecks: suggested,
        priceUnknown: suggested <= 0,
      };
    }),
  };
}
