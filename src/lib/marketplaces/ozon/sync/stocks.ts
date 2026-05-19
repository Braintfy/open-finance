// PURPOSE: Стейдж синхронизации остатков Ozon.
// /v4/product/info/stocks — пагинация по cursor.

import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { unitProducts } from '@/lib/db/schema/unit-economics';
import { productInfoStocks } from '../endpoints';
import { upsertUnitProductFromOzon } from '../upsert';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import type { ProductInfo } from '../types';

export async function syncStocksStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    const existing = await db
      .select({
        article: unitProducts.article,
        sku: unitProducts.sku,
        name: unitProducts.name,
      })
      .from(unitProducts)
      .where(
        and(
          eq(unitProducts.tenantId, ctx.tenantId),
          eq(unitProducts.marketplace, 'ozon'),
          eq(unitProducts.marketplaceAccountId, ctx.accountId),
        ),
      );
    const byArticle = new Map(existing.map((r) => [r.article ?? '', r]));

    let cursor = '';
    let processed = 0;
    while (true) {
      const res = await productInfoStocks(ctx.client, { cursor, limit: 1000 });
      const items = res.items ?? [];
      for (const item of items) {
        const existingRow = byArticle.get(item.offer_id ?? '');
        if (!existingRow || !item.offer_id) continue;
        const info: ProductInfo = {
          id: item.product_id ?? Number(existingRow.sku ?? 0),
          name: existingRow.name,
          offer_id: item.offer_id,
          sources: item.sku ? [{ sku: item.sku, source: 'stocks' }] : undefined,
        };
        await upsertUnitProductFromOzon(ctx, { info, stocks: item });
        processed += 1;
      }
      ctx.onProgress?.(processed);
      if (!res.cursor || items.length === 0) break;
      cursor = res.cursor;
    }
    return { itemsProcessed: processed };
  });
}
