// PURPOSE: Стейдж синхронизации помесячного отчёта о реализации.
// /v2/finance/realization берёт date='YYYY-MM' и возвращает агрегированный
// отчёт по SKU за указанный месяц. Тянем последние 2 закрытых месяца.

import { financeRealization } from '../endpoints';
import { insertRealizationBatch } from '../upsert';
import { runStageWithTiming, type StageContext, type StageResult } from './types';

function lastClosedMonths(count: number): Array<{ key: string; from: Date; to: Date }> {
  const out: Array<{ key: string; from: Date; to: Date }> = [];
  const now = new Date();
  // первый день текущего месяца
  let cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  for (let i = 0; i < count; i++) {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    const from = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const to = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    const key = `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, from, to });
  }
  return out;
}

export async function syncRealizationStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    const months = lastClosedMonths(2);
    let processed = 0;
    for (const m of months) {
      try {
        const res = await financeRealization(ctx.client, { date: m.key });
        const rows = res.result?.rows ?? [];
        if (rows.length === 0) continue;
        const inserted = await insertRealizationBatch(ctx, {
          periodFrom: m.from,
          periodTo: m.to,
          rows,
        });
        processed += inserted;
        ctx.onProgress?.(processed);
      } catch (e) {
        // не валим весь стейдж, если за один месяц отчёт ещё не готов
        console.warn(`[ozon] realization ${m.key} failed:`, (e as Error).message);
      }
    }
    return { itemsProcessed: processed };
  });
}
