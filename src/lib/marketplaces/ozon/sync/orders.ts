// PURPOSE: Стейдж синхронизации заказов Ozon (FBO + FBS) за окно.
// Окно настраивается в OzonSyncSettings.ordersWindowDays (default 30).

import { postingFbsList, postingFboList } from '../endpoints';
import { upsertFbsPosting, upsertFboPosting } from '../upsert';
import { runStageWithTiming, type StageContext, type StageResult } from './types';

const PAGE = 1000;

export async function syncOrdersStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    const days = ctx.settings.ordersWindowDays ?? 30;
    const to = new Date();
    const since = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    let processed = 0;

    // FBS
    let offset = 0;
    while (true) {
      const res = await postingFbsList(ctx.client, { since, to, offset, limit: PAGE });
      const postings = res.result.postings ?? [];
      for (const p of postings) {
        await upsertFbsPosting(ctx, p);
        processed += 1;
      }
      ctx.onProgress?.(processed);
      if (!res.result.has_next || postings.length === 0) break;
      offset += PAGE;
    }

    // FBO
    offset = 0;
    while (true) {
      const res = await postingFboList(ctx.client, { since, to, offset, limit: PAGE });
      const postings = res.result ?? [];
      for (const p of postings) {
        await upsertFboPosting(ctx, p);
        processed += 1;
      }
      ctx.onProgress?.(processed);
      if (postings.length < PAGE) break;
      offset += PAGE;
    }

    return { itemsProcessed: processed };
  });
}
