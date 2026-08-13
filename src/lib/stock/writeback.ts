// PURPOSE: Writeback себестоимости склада в unit_products.cost_kopecks — главный
// рычаг модуля (docs/STOCK_MODULE_DESIGN.md §6.1). Оживляет ~9 существующих
// файлов-потребителей (аналитика Ozon, «Мой магазин», ABC, оба калькулятора,
// ozon-product-picker, ozon-sync-diff) БЕЗ единой правки в них: они уже читают
// cost_kopecks, просто до сих пор там лежала ручная цифра.
//
// ГРАНИЦА С СИНКОМ OZON — САМОЕ ВАЖНОЕ В ЭТОМ ФАЙЛЕ:
//   src/lib/marketplaces/ozon/upsert.ts:104-110 обновляет stock_marketplace и
//   stock_own (это остатки FBO/FBS Ozon — имя колонки stock_own врёт, к нашему
//   складу оно отношения не имеет) и НЕ трогает cost_kopecks.
//   Значит граница владения такая:
//     • КОЛИЧЕСТВА (stock_marketplace / stock_own / price_kopecks) — территория
//       синка. Отсюда в них не пишется НИЧЕГО и никогда.
//     • СЕБЕСТОИМОСТЬ (cost_kopecks + cost_source + cost_updated_at) — наша,
//       и то лишь у строк с cost_source='inventory'.
//   Третий предохранитель: дефолт колонки cost_source — 'manual', поэтому сразу
//   после миграции 0014 writeback не меняет НИ ОДНОЙ строки, пока пользователь
//   явно не переключит товары диалогом «Перевести себестоимость на склад».
//
// Следствие для метрики totalStockValueKopecks (unit-ozon-analytics-queries.ts:340,
// api/marketplaces/analytics/ozon/route.ts:522) = cost_kopecks × (stock_marketplace
// + stock_own): после writeback она становится КОРРЕКТНОЙ метрикой «деньги в
// товаре на складах Ozon» (свежая цена × количества Ozon), но НЕполной —
// полная капитализация склада публикуется блоком stock.balances (§6.1).

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { unitProducts } from '@/lib/db/schema/unit-economics';
import type { StockCtx, StockDb } from './queries';

/** Максимум для колонки unit_products.cost_kopecks (она integer, не bigint). */
const COST_KOPECKS_MAX = 2_147_483_647;

export type CostSource = 'manual' | 'inventory';

/**
 * Кандидат на writeback: связка unit_product ← stock_item_links → stock_items.
 * DISTINCT ON гарантирует РОВНО одну ссылку на unit_product: если их случайно
 * несколько (данные повреждены), выбирается детерминированно — сначала ручная
 * сшивка, затем меньший qty_per_unit, затем меньший id. Иначе цена карточки
 * прыгала бы между запусками.
 */
interface WritebackCandidate {
  unitProductId: string;
  article: string | null;
  productName: string;
  marketplace: string;
  currentCostKopecks: number;
  costSource: CostSource;
  itemId: string;
  itemSku: string;
  itemName: string;
  qtyPerUnit: number;
  /** cost_override_kopecks ?? avg_cost_kopecks — себестоимость БАЗОВОЙ единицы. */
  baseCostKopecks: number;
  /** Себестоимость карточки канала = базовая × qty_per_unit (§6.1). */
  nextCostKopecks: number;
  /** Пул смешал партии разных базисов НДС — отчёты обязаны это пометить (§12.2). */
  costBasisMixed: boolean;
}

interface CandidateFilter {
  /** Ограничить товарами склада (используется после проводки документа). */
  itemIds?: string[];
  /** Ограничить конкретными карточками (диалог массового переключения). */
  unitProductIds?: string[];
  /** Только те, у кого cost_source уже 'inventory' (режим записи). */
  onlyInventory?: boolean;
}

async function loadCandidates(
  ctx: StockCtx,
  client: StockDb,
  filter: CandidateFilter,
): Promise<WritebackCandidate[]> {
  const itemFilter =
    filter.itemIds && filter.itemIds.length > 0
      ? sql`AND l.item_id IN (${sql.join(
          filter.itemIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
  const productFilter =
    filter.unitProductIds && filter.unitProductIds.length > 0
      ? sql`AND up.id IN (${sql.join(
          filter.unitProductIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`
      : sql``;
  const sourceFilter = filter.onlyInventory ? sql`AND up.cost_source = 'inventory'` : sql``;

  const rows = await client.execute<{
    unit_product_id: string;
    article: string | null;
    product_name: string;
    marketplace: string;
    current_cost: string;
    cost_source: string;
    item_id: string;
    item_sku: string;
    item_name: string;
    qty_per_unit: string;
    base_cost: string;
    basis_mixed: boolean;
  }>(sql`
    SELECT DISTINCT ON (up.id)
      up.id            AS unit_product_id,
      up.article,
      up.name          AS product_name,
      up.marketplace,
      up.cost_kopecks  AS current_cost,
      up.cost_source,
      si.id            AS item_id,
      si.sku           AS item_sku,
      si.name          AS item_name,
      l.qty_per_unit,
      COALESCE(si.cost_override_kopecks, si.avg_cost_kopecks) AS base_cost,
      si.cost_basis_mixed AS basis_mixed
    FROM stock_item_links l
    JOIN unit_products up
      ON up.id = l.unit_product_id AND up.tenant_id = ${ctx.tenantId}
    JOIN stock_items si
      ON si.id = l.item_id AND si.tenant_id = ${ctx.tenantId}
    WHERE l.tenant_id = ${ctx.tenantId}
      AND l.unit_product_id IS NOT NULL
      ${itemFilter}
      ${productFilter}
      ${sourceFilter}
    ORDER BY up.id, (l.match_source = 'manual') DESC, l.qty_per_unit ASC, l.id ASC
  `);

  return Array.from(rows).map((r) => {
    const baseCost = Number(r.base_cost) || 0;
    const qtyPerUnit = Math.max(1, Number(r.qty_per_unit) || 1);
    const next = Math.min(COST_KOPECKS_MAX, Math.max(0, Math.round(baseCost * qtyPerUnit)));
    return {
      unitProductId: r.unit_product_id,
      article: r.article,
      productName: r.product_name,
      marketplace: r.marketplace,
      currentCostKopecks: Number(r.current_cost) || 0,
      costSource: (r.cost_source === 'inventory' ? 'inventory' : 'manual') as CostSource,
      itemId: r.item_id,
      itemSku: r.item_sku,
      itemName: r.item_name,
      qtyPerUnit,
      baseCostKopecks: baseCost,
      nextCostKopecks: next,
      costBasisMixed: Boolean(r.basis_mixed),
    };
  });
}

export interface WritebackResult {
  /** Сколько строк unit_products реально обновлено. */
  updated: number;
  /** Сколько кандидатов пропущено, потому что цена не изменилась. */
  unchanged: number;
  /** Сколько связок пропущено из-за нулевой себестоимости (карантин, §1.10). */
  skippedNoCost: number;
}

/**
 * Пишет себестоимость склада в unit_products. Обновляет ТОЛЬКО строки с
 * cost_source='inventory' — переключение делает пользователь диалогом
 * (§6.1 «Массовое переключение — обязательная часть Релиза 1»).
 *
 * Нулевую себестоимость НЕ пишем: «0» в карточке выглядит как настоящая цена и
 * даёт 100 % маржи в аналитике. Такие позиции остаются со старым значением и
 * попадают в карантин (getStockQuarantine → salesWithoutCost).
 *
 * Вызывается внутри транзакции postDoc/voidDoc — поэтому принимает client.
 */
export async function applyCostWriteback(
  ctx: StockCtx,
  client: StockDb = db,
  itemIds?: string[],
): Promise<WritebackResult> {
  const candidates = await loadCandidates(ctx, client, {
    itemIds,
    onlyInventory: true,
  });
  if (candidates.length === 0) {
    return { updated: 0, unchanged: 0, skippedNoCost: 0 };
  }

  const toWrite = candidates.filter((c) => c.nextCostKopecks > 0);
  const skippedNoCost = candidates.length - toWrite.length;
  const changed = toWrite.filter((c) => c.nextCostKopecks !== c.currentCostKopecks);
  if (changed.length === 0) {
    return { updated: 0, unchanged: toWrite.length, skippedNoCost };
  }

  // Один UPDATE ... FROM (VALUES …) вместо N запросов: проводка поставки на
  // 50 позиций иначе давала бы 50 round-trip'ов внутри транзакции.
  const values = sql.join(
    changed.map((c) => sql`(${c.unitProductId}::uuid, ${c.nextCostKopecks}::integer)`),
    sql`, `,
  );
  await client.execute(sql`
    UPDATE unit_products AS up
    SET cost_kopecks = v.cost,
        cost_updated_at = now(),
        updated_at = now()
    FROM (VALUES ${values}) AS v(id, cost)
    WHERE up.id = v.id
      AND up.tenant_id = ${ctx.tenantId}
      -- Страховка от гонки с диалогом переключения: если между SELECT и UPDATE
      -- карточку вернули на ручную цену, писать в неё мы права не имеем.
      AND up.cost_source = 'inventory'
  `);

  return {
    updated: changed.length,
    unchanged: toWrite.length - changed.length,
    skippedNoCost,
  };
}

export interface WritebackPreviewRow {
  unitProductId: string;
  article: string | null;
  productName: string;
  marketplace: string;
  itemId: string;
  itemSku: string;
  itemName: string;
  qtyPerUnit: number;
  costSource: CostSource;
  /** Было, копейки. */
  currentCostKopecks: number;
  /** Станет, копейки. */
  nextCostKopecks: number;
  /** Δ%, null если «было» = 0 (процент от нуля не считается). */
  deltaPct: number | null;
  /** Себестоимость неизвестна — переключать такую карточку нельзя. */
  noCost: boolean;
  costBasisMixed: boolean;
}

/**
 * Превью для диалога «Перевести себестоимость на склад»: таблица
 * «товар / было ₽ / станет ₽ / Δ%» (§6.1). Без него дефолт 'manual' означает,
 * что после всей работы аналитика продолжит показывать старые ручные цифры.
 */
export async function previewCostWriteback(
  ctx: StockCtx,
  filter: { itemIds?: string[]; unitProductIds?: string[] } = {},
  client: StockDb = db,
): Promise<{ rows: WritebackPreviewRow[]; totals: { count: number; noCostCount: number; alreadyInventory: number } }> {
  const candidates = await loadCandidates(ctx, client, {
    itemIds: filter.itemIds,
    unitProductIds: filter.unitProductIds,
    onlyInventory: false,
  });

  const rows: WritebackPreviewRow[] = candidates.map((c) => ({
    unitProductId: c.unitProductId,
    article: c.article,
    productName: c.productName,
    marketplace: c.marketplace,
    itemId: c.itemId,
    itemSku: c.itemSku,
    itemName: c.itemName,
    qtyPerUnit: c.qtyPerUnit,
    costSource: c.costSource,
    currentCostKopecks: c.currentCostKopecks,
    nextCostKopecks: c.nextCostKopecks,
    deltaPct:
      c.currentCostKopecks > 0
        ? Math.round(
            ((c.nextCostKopecks - c.currentCostKopecks) / c.currentCostKopecks) * 1000,
          ) / 10
        : null,
    noCost: c.nextCostKopecks <= 0,
    costBasisMixed: c.costBasisMixed,
  }));

  return {
    rows,
    totals: {
      count: rows.length,
      noCostCount: rows.filter((r) => r.noCost).length,
      alreadyInventory: rows.filter((r) => r.costSource === 'inventory').length,
    },
  };
}

/**
 * Переключение источника себестоимости карточек (§2.10). При переводе на
 * 'inventory' СРАЗУ применяет writeback — иначе пользователь нажал «Применить»,
 * а цифры в аналитике не изменились до следующей поставки.
 */
export async function setCostSource(
  ctx: StockCtx,
  args: { unitProductIds: string[]; source: CostSource },
): Promise<{ switched: number; writeback: WritebackResult }> {
  const ids = Array.from(new Set(args.unitProductIds)).filter(Boolean);
  if (ids.length === 0) {
    return {
      switched: 0,
      writeback: { updated: 0, unchanged: 0, skippedNoCost: 0 },
    };
  }

  return db.transaction(async (tx) => {
    const updated = await tx
      .update(unitProducts)
      .set({ costSource: args.source, updatedAt: new Date() })
      .where(and(eq(unitProducts.tenantId, ctx.tenantId), inArray(unitProducts.id, ids)))
      .returning({ id: unitProducts.id });

    const writeback =
      args.source === 'inventory'
        ? await applyCostWritebackForProducts(ctx, tx, ids)
        : { updated: 0, unchanged: 0, skippedNoCost: 0 };

    return { switched: updated.length, writeback };
  });
}

/** Тот же writeback, но с фильтром по карточкам (используется переключателем). */
async function applyCostWritebackForProducts(
  ctx: StockCtx,
  client: StockDb,
  unitProductIds: string[],
): Promise<WritebackResult> {
  const candidates = await loadCandidates(ctx, client, {
    unitProductIds,
    onlyInventory: true,
  });
  const toWrite = candidates.filter((c) => c.nextCostKopecks > 0);
  const skippedNoCost = candidates.length - toWrite.length;
  const changed = toWrite.filter((c) => c.nextCostKopecks !== c.currentCostKopecks);
  if (changed.length === 0) {
    return { updated: 0, unchanged: toWrite.length, skippedNoCost };
  }
  const values = sql.join(
    changed.map((c) => sql`(${c.unitProductId}::uuid, ${c.nextCostKopecks}::integer)`),
    sql`, `,
  );
  await client.execute(sql`
    UPDATE unit_products AS up
    SET cost_kopecks = v.cost,
        cost_updated_at = now(),
        updated_at = now()
    FROM (VALUES ${values}) AS v(id, cost)
    WHERE up.id = v.id
      AND up.tenant_id = ${ctx.tenantId}
      AND up.cost_source = 'inventory'
  `);
  return {
    updated: changed.length,
    unchanged: toWrite.length - changed.length,
    skippedNoCost,
  };
}
