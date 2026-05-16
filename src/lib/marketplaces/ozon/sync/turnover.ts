// PURPOSE: Стейдж синхронизации оборачиваемости.
// /v1/analytics/turnover/stocks — пагинация по cursor.

import { analyticsTurnoverStocks } from '../endpoints';
import { updateTurnoverForProduct } from '../upsert';
import { runStageWithTiming, type StageContext, type StageResult } from './types';

export async function syncTurnoverStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    let cursor = '';
    let processed = 0;
    while (true) {
      const res = await analyticsTurnoverStocks(ctx.client, { cursor, limit: 1000 });
      const items = res.items ?? [];
      for (const row of items) {
        await updateTurnoverForProduct(ctx, row);
        processed += 1;
      }
      ctx.onProgress?.(processed);
      if (!res.cursor || items.length === 0) break;
      cursor = res.cursor;
    }
    return { itemsProcessed: processed };
  });
}
