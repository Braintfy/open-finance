// PURPOSE: Стейдж синхронизации детальных финансовых транзакций.
// /v3/finance/transaction/list — пагинация по page.

import { financeTransactionList } from '../endpoints';
import { upsertTransaction } from '../upsert';
import { runStageWithTiming, type StageContext, type StageResult } from './types';

const PAGE_SIZE = 1000;

export async function syncTransactionsStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    // v0.22.1: override [fromDate..toDate] для incremental backfill.
    let from: Date;
    let to: Date;
    if (ctx.overrideFromDate && ctx.overrideToDate) {
      from = new Date(ctx.overrideFromDate + 'T00:00:00Z');
      to = new Date(ctx.overrideToDate + 'T23:59:59.999Z');
    } else {
      const days = ctx.settings.transactionsWindowDays ?? 30;
      to = new Date();
      from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    }

    let processed = 0;
    let page = 1;
    while (true) {
      const res = await financeTransactionList(ctx.client, {
        from,
        to,
        page,
        pageSize: PAGE_SIZE,
      });
      const ops = res.result?.operations ?? [];
      if (ops.length === 0) break;
      for (const op of ops) {
        await upsertTransaction(ctx, op);
        processed += 1;
      }
      ctx.onProgress?.(processed);
      if (ops.length < PAGE_SIZE) break;
      page += 1;
      const totalPages = res.result?.page_count ?? page;
      if (page > totalPages) break;
    }
    return { itemsProcessed: processed };
  });
}
