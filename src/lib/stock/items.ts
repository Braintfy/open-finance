// PURPOSE: CRUD канонической номенклатуры (stock_items) — то, что человек
// заводит руками. Импорт из каналов живёт в import-ozon.ts, журнал — в posting.ts,
// чтение остатков — в queries.ts.
//
// Инвариант удаления: товар, по которому ЕСТЬ движения, физически не удаляется
// (FK stock_moves.item_id ON DELETE RESTRICT — намеренно, §2.7). Вместо удаления
// — is_active=false: история себестоимости обязана пережить чистку справочника.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { stockItems, type StockItem } from '@/lib/db/schema/stock';
import { stockMoves } from '@/lib/db/schema/stock-ledger';
import { StockError } from './posting';
import type { StockCtx } from './queries';

export interface StockItemInput {
  sku: string;
  name?: string;
  brand?: string | null;
  category?: string | null;
  unit?: string;
  barcode?: string | null;
  expiryControl?: boolean;
  shelfLifeDays?: number | null;
  minQty?: number;
  /** Ручной override себестоимости; null — снять override (§2.2). */
  costOverrideKopecks?: number | null;
  isActive?: boolean;
  note?: string | null;
}

function normalize(input: StockItemInput) {
  const sku = input.sku?.trim();
  if (!sku) throw new StockError('bad_request', 'Внутренний артикул обязателен');
  return {
    sku: sku.slice(0, 80),
    name: (input.name ?? '').slice(0, 500),
    brand: input.brand?.trim().slice(0, 120) || null,
    category: input.category?.trim().slice(0, 160) || null,
    unit: (input.unit?.trim() || 'шт').slice(0, 16),
    barcode: input.barcode?.trim().slice(0, 200) || null,
    expiryControl: input.expiryControl ?? true,
    shelfLifeDays:
      input.shelfLifeDays === null || input.shelfLifeDays === undefined
        ? null
        : Math.max(0, Math.trunc(input.shelfLifeDays)),
    minQty: Math.max(0, Math.trunc(input.minQty ?? 0)),
    costOverrideKopecks:
      input.costOverrideKopecks === null || input.costOverrideKopecks === undefined
        ? null
        : Math.max(0, Math.trunc(input.costOverrideKopecks)),
    isActive: input.isActive ?? true,
    note: input.note?.trim() || null,
  };
}

export async function createStockItem(
  ctx: StockCtx,
  input: StockItemInput,
): Promise<StockItem> {
  const values = normalize(input);
  const [existing] = await db
    .select({ id: stockItems.id })
    .from(stockItems)
    .where(and(eq(stockItems.tenantId, ctx.tenantId), eq(stockItems.sku, values.sku)))
    .limit(1);
  if (existing) {
    throw new StockError('bad_request', `Товар с артикулом «${values.sku}» уже есть`);
  }
  const [row] = await db
    .insert(stockItems)
    .values({ tenantId: ctx.tenantId, userId: ctx.userId, ...values })
    .returning();
  return row;
}

export async function updateStockItem(
  ctx: StockCtx,
  itemId: string,
  input: StockItemInput,
): Promise<StockItem> {
  const values = normalize(input);
  const [row] = await db
    .update(stockItems)
    .set({ ...values, updatedAt: new Date() })
    .where(and(eq(stockItems.tenantId, ctx.tenantId), eq(stockItems.id, itemId)))
    .returning();
  if (!row) throw new StockError('not_found', 'Товар не найден');
  return row;
}

/**
 * Удаление разрешено только для товара БЕЗ движений. С движениями — 409 с
 * подсказкой про деактивацию: снести историю себестоимости нельзя (§1.4).
 */
export async function deleteStockItem(ctx: StockCtx, itemId: string): Promise<void> {
  const [used] = await db
    .select({ n: sql<string>`count(*)` })
    .from(stockMoves)
    .where(and(eq(stockMoves.tenantId, ctx.tenantId), eq(stockMoves.itemId, itemId)));
  if (Number(used?.n ?? 0) > 0) {
    throw new StockError(
      'wrong_status',
      'По товару есть движения — удалить нельзя. Снимите галочку «активен»: ' +
        'история себестоимости должна пережить чистку справочника.',
    );
  }
  const deleted = await db
    .delete(stockItems)
    .where(and(eq(stockItems.tenantId, ctx.tenantId), eq(stockItems.id, itemId)))
    .returning({ id: stockItems.id });
  if (deleted.length === 0) throw new StockError('not_found', 'Товар не найден');
}
