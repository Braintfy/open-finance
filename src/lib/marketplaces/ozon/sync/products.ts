// PURPOSE: Стейдж синхронизации каталога товаров Ozon.
// /v3/product/list → /v3/product/info/list → upsert в unit_products.
// Этот стейдж заполняет ТОЛЬКО базовые поля (name, barcode, габариты);
// цены/комиссии/остатки заполняют стейджи prices/stocks (они тоже
// дополняют ту же запись через upsertUnitProductFromOzon).

import { productList, productInfoList } from '../endpoints';
import { upsertUnitProductFromOzon } from '../upsert';
import { runStageWithTiming, type StageContext, type StageResult } from './types';

const BATCH = 500; // Ozon допускает до 1000, берём с запасом
const INFO_CHUNK = 100; // /v3/product/info/list ограничен ~100 элементами

export async function syncProductsStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    const allProductIds: number[] = [];
    let lastId = '';
    while (true) {
      const res = await productList(ctx.client, { last_id: lastId, limit: BATCH });
      const items = res.result.items;
      for (const it of items) allProductIds.push(it.product_id);
      if (!items.length || !res.result.last_id) break;
      if (items.length < BATCH) {
        lastId = res.result.last_id;
        // если страница неполная — это конец
        break;
      }
      lastId = res.result.last_id;
    }

    let processed = 0;
    for (let i = 0; i < allProductIds.length; i += INFO_CHUNK) {
      const chunk = allProductIds.slice(i, i + INFO_CHUNK);
      const info = await productInfoList(ctx.client, { product_id: chunk });
      const items = info.result?.items ?? info.items ?? [];
      for (const product of items) {
        await upsertUnitProductFromOzon(ctx, { info: product });
        processed += 1;
      }
      ctx.onProgress?.(processed, allProductIds.length);
    }

    return {
      itemsProcessed: processed,
      itemsTotal: allProductIds.length,
    };
  });
}
