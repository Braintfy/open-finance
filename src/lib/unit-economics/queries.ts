// PURPOSE: Tenant-scoped запросы к таблицам юнит-экономики (продукты,
// расчёты, импорты). Все запросы обязательно с tenant_id фильтром.

import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  unitProducts,
  unitCalculations,
  unitImports,
  type UnitMarketplace,
  type UnitProduct,
  type NewUnitProduct,
  type UnitCalculation,
  type NewUnitCalculation,
  type NewUnitImport,
} from '@/lib/db/schema/unit-economics';

export type ListProductsArgs = {
  tenantId: string;
  marketplace?: UnitMarketplace;
  limit?: number;
  offset?: number;
};

export async function listUnitProducts(args: ListProductsArgs): Promise<UnitProduct[]> {
  const conds = [eq(unitProducts.tenantId, args.tenantId)];
  if (args.marketplace) conds.push(eq(unitProducts.marketplace, args.marketplace));
  return db
    .select()
    .from(unitProducts)
    .where(and(...conds))
    .orderBy(desc(unitProducts.updatedAt))
    .limit(args.limit ?? 200)
    .offset(args.offset ?? 0);
}

/**
 * Upsert по уникальному ключу (tenant_id + marketplace + article).
 * Если article отсутствует — вставляем как новую запись.
 */
export async function upsertUnitProduct(input: NewUnitProduct): Promise<UnitProduct> {
  if (!input.article) {
    const [row] = await db.insert(unitProducts).values(input).returning();
    return row;
  }
  const [row] = await db
    .insert(unitProducts)
    .values(input)
    .onConflictDoUpdate({
      target: [unitProducts.tenantId, unitProducts.marketplace, unitProducts.article],
      set: {
        sku: input.sku ?? sql`unit_products.sku`,
        barcode: input.barcode ?? sql`unit_products.barcode`,
        name: input.name ?? sql`unit_products.name`,
        status: input.status ?? sql`unit_products.status`,
        visibility: input.visibility ?? sql`unit_products.visibility`,
        stockMarketplace: input.stockMarketplace ?? sql`unit_products.stock_marketplace`,
        stockOwn: input.stockOwn ?? sql`unit_products.stock_own`,
        priceKopecks: input.priceKopecks ?? sql`unit_products.price_kopecks`,
        costKopecks: input.costKopecks ?? sql`unit_products.cost_kopecks`,
        volumeL: input.volumeL ?? sql`unit_products.volume_l_x100`,
        metadata: input.metadata ?? sql`unit_products.metadata`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function bulkUpsertUnitProducts(
  rows: NewUnitProduct[],
): Promise<{ inserted: number }> {
  if (rows.length === 0) return { inserted: 0 };
  let inserted = 0;
  for (const row of rows) {
    await upsertUnitProduct(row);
    inserted += 1;
  }
  return { inserted };
}

export async function deleteUnitProduct(args: {
  tenantId: string;
  id: string;
}): Promise<void> {
  await db
    .delete(unitProducts)
    .where(and(eq(unitProducts.tenantId, args.tenantId), eq(unitProducts.id, args.id)));
}

export type ListCalculationsArgs = {
  tenantId: string;
  marketplace?: UnitMarketplace;
  limit?: number;
};

export async function listUnitCalculations(
  args: ListCalculationsArgs,
): Promise<UnitCalculation[]> {
  const conds = [eq(unitCalculations.tenantId, args.tenantId)];
  if (args.marketplace) conds.push(eq(unitCalculations.marketplace, args.marketplace));
  return db
    .select()
    .from(unitCalculations)
    .where(and(...conds))
    .orderBy(desc(unitCalculations.updatedAt))
    .limit(args.limit ?? 100);
}

export async function saveUnitCalculation(
  input: NewUnitCalculation,
): Promise<UnitCalculation> {
  const [row] = await db.insert(unitCalculations).values(input).returning();
  return row;
}

export async function deleteUnitCalculation(args: {
  tenantId: string;
  id: string;
}): Promise<void> {
  await db
    .delete(unitCalculations)
    .where(and(eq(unitCalculations.tenantId, args.tenantId), eq(unitCalculations.id, args.id)));
}

export async function recordUnitImport(input: NewUnitImport) {
  const [row] = await db.insert(unitImports).values(input).returning();
  return row;
}

export async function listUnitImports(tenantId: string, limit = 20) {
  return db
    .select()
    .from(unitImports)
    .where(eq(unitImports.tenantId, tenantId))
    .orderBy(desc(unitImports.createdAt))
    .limit(limit);
}
