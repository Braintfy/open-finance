// PURPOSE: Стейдж синхронизации цен и комиссий Ozon.
// /v5/product/info/prices — пагинация по cursor. Обновляет priceKopecks
// и metadata.commissions в unit_products через upsertUnitProductFromOzon
// (передаётся фейковый info с минимальным набором полей, чтобы только
// обновить price/commissions без затирания name/dimensions).

import { eq, and } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { unitProducts } from '@/lib/db/schema/unit-economics';
import { productInfoPrices } from '../endpoints';
import { upsertUnitProductFromOzon } from '../upsert';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import type { ProductInfo } from '../types';

export async function syncPricesStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    // Берём список уже синхронизированных товаров — чтобы знать name/info
    // и не затирать его пустым placeholder'ом.
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
      const res = await productInfoPrices(ctx.client, { cursor, limit: 1000 });
      const items = res.items ?? [];
      for (const item of items) {
        const existingRow = byArticle.get(item.offer_id ?? '');
        // Минимальный ProductInfo с id/offer_id/name, остальное дополним из ozon prices.
        const info: ProductInfo = {
          id: item.product_id,
          name: existingRow?.name ?? '',
          offer_id: item.offer_id ?? '',
        };
        await upsertUnitProductFromOzon(ctx, { info, prices: item });
        processed += 1;
      }
      ctx.onProgress?.(processed);
      if (!res.cursor || items.length === 0) break;
      cursor = res.cursor;
    }
    return { itemsProcessed: processed };
  });
}
