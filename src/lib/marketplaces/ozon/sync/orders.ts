// PURPOSE: Стейдж синхронизации заказов Ozon (FBO + FBS) за окно.
// Окно настраивается в OzonSyncSettings.ordersWindowDays (default 30).

import { postingFbsList, postingFboList } from '../endpoints';
import { upsertMappedOrder } from '../upsert';
import {
  forEachPostingPage,
  mapFboPosting,
  mapFbsPosting,
  splitDateWindow,
} from '../orders-map';
import { runStageWithTiming, type StageContext, type StageResult } from './types';

/** Сколько причин пропуска кладём в warnings (остальные — счётчиком). */
const MAX_SKIP_WARNINGS = 5;

export async function syncOrdersStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    // v0.22.1: override [fromDate..toDate] для incremental backfill. iso → Date
    // с UTC-midnight (Ozon принимает ISO instant); to делаем end-of-day +1d.
    let since: Date;
    let to: Date;
    if (ctx.overrideFromDate && ctx.overrideToDate) {
      since = new Date(ctx.overrideFromDate + 'T00:00:00Z');
      // Включительный toDate → конец дня + 1ms (Ozon API использует [since, to))
      to = new Date(ctx.overrideToDate + 'T23:59:59.999Z');
    } else {
      const days = ctx.settings.ordersWindowDays ?? 30;
      to = new Date();
      since = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    }

    let processed = 0;
    const warnings: string[] = [];
    const errors: string[] = [];
    let skipped = 0;
    const skip = (scheme: string, postingNumber: string, reason: string) => {
      skipped += 1;
      if (warnings.length < MAX_SKIP_WARNINGS) {
        warnings.push(`${scheme} ${postingNumber} пропущено: ${reason}`);
      }
    };

    // Методы принимают период не длиннее года — длинное окно режем на куски.
    const windows = splitDateWindow(since, to);
    const label = (w: { since: Date; to: Date }) =>
      windows.length > 1 ? ` [${w.since.toISOString().slice(0, 10)}..${w.to.toISOString().slice(0, 10)}]` : '';

    // Схемы независимы: падение FBS (напр. смена контракта) не должно
    // прятать FBO и наоборот; сбой одного куска окна не отменяет остальные —
    // ошибка уходит в StageResult.error.
    for (const w of windows) {
      try {
        await forEachPostingPage(
          (cursor) => postingFbsList(ctx.client, { since: w.since, to: w.to, cursor }),
          async (postings) => {
            for (const p of postings) {
              const m = mapFbsPosting(p);
              if (!m.ok) {
                skip('fbs', m.postingNumber, m.reason);
                continue;
              }
              await upsertMappedOrder(ctx, m.order, p);
              processed += 1;
            }
            ctx.onProgress?.(processed);
          },
        );
      } catch (e) {
        errors.push(`FBS${label(w)} ${(e as Error).message}`);
      }
    }

    for (const w of windows) {
      try {
        await forEachPostingPage(
          (cursor) => postingFboList(ctx.client, { since: w.since, to: w.to, cursor }),
          async (postings) => {
            for (const p of postings) {
              const m = mapFboPosting(p);
              if (!m.ok) {
                skip('fbo', m.postingNumber, m.reason);
                continue;
              }
              await upsertMappedOrder(ctx, m.order, p);
              processed += 1;
            }
            ctx.onProgress?.(processed);
          },
        );
      } catch (e) {
        errors.push(`FBO${label(w)} ${(e as Error).message}`);
      }
    }

    if (skipped > MAX_SKIP_WARNINGS) {
      warnings.push(`... и ещё ${skipped - MAX_SKIP_WARNINGS} отправлений пропущено`);
    }
    // Любой пропуск или обрыв — не «тихий успех»: ok=false, чтобы синк не рапортовал зелёным.
    const failed = errors.length > 0 || skipped > 0;
    return {
      ok: !failed,
      itemsProcessed: processed,
      error: errors.length > 0 ? errors.join('; ') : skipped > 0 ? `пропущено отправлений: ${skipped}` : undefined,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  });
}
