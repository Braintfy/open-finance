// PURPOSE: Sync эталонного расхода по кампаниям через
// Performance API `GET /api/client/statistics/expense`. Покрывает ВСЕ
// типы кампаний (SKU/SEARCH_PROMO/ALL_SKU_PROMO/BANNER/VIDEO_BANNER) +
// бонусы. Primary источник total adsRub в KPI/Аналитике.
//
// Архитектура:
//   1. Берём окно `perfWindowDays` (clamp до 62).
//   2. Запрос expense с retry по уменьшающимся окнам / lag'ам.
//   3. Удаляем старые строки этого окна, upsert per-day per-campaign.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonPerfExpenseDaily } from '@/lib/db/schema/marketplaces';
import { getExpenseDaily } from '../performance/endpoints';
import { OzonPerfApiError } from '../performance/client';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import { buildPerfPeriod, type PerfPeriod } from './perf-period';

const MAX_WINDOW_DAYS = 62;

const RETRY_WINDOWS = [30, 14, 7] as const;
const RETRY_END_LAGS = [1, 2, 3, 4, 7] as const;

export async function syncPerfExpenseDailyStage(
  ctx: StageContext,
): Promise<StageResult> {
  return runStageWithTiming(async () => {
    if (!ctx.perfClient) {
      return {
        itemsProcessed: 0,
        ok: false,
        error: 'Performance API не подключён для этого аккаунта',
      };
    }

    let requestedWindow = ctx.settings.perfWindowDays ?? 30;
    const warnings: string[] = [];
    if (requestedWindow > MAX_WINDOW_DAYS) {
      warnings.push(
        `Окно ${requestedWindow}d > 62d (лимит Performance API). Clamp до 62d.`,
      );
      requestedWindow = MAX_WINDOW_DAYS;
    }

    const windows: number[] = RETRY_WINDOWS.filter((w) => w <= requestedWindow);
    if (!windows.includes(requestedWindow)) windows.unshift(requestedWindow);
    const attempts = windows.flatMap((windowDays) =>
      RETRY_END_LAGS.map((lagDays) => ({ windowDays, lagDays })),
    );

    let period: PerfPeriod = buildPerfPeriod(requestedWindow);
    let rows: Awaited<ReturnType<typeof getExpenseDaily>> | null = null;
    for (const [index, attempt] of attempts.entries()) {
      period = buildPerfPeriod(attempt.windowDays, new Date(), attempt.lagDays);
      try {
        rows = await getExpenseDaily(ctx.perfClient, {
          dateFrom: period.dateFrom,
          dateTo: period.dateTo,
        });
        break;
      } catch (e) {
        const is400 = e instanceof OzonPerfApiError && e.status === 400;
        if (!is400 || index === attempts.length - 1) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            itemsProcessed: 0,
            ok: false,
            error: `Expense отчёт: ${msg}`,
            warnings,
          };
        }
      }
    }

    if (!rows) {
      return {
        itemsProcessed: 0,
        ok: false,
        error: 'Expense отчёт: не удалось получить данные',
        warnings,
      };
    }

    await db.execute(sql`
      DELETE FROM ${ozonPerfExpenseDaily}
      WHERE tenant_id = ${ctx.tenantId}
        AND account_id = ${ctx.accountId}
        AND date >= ${period.dateFrom}::date
        AND date <= ${period.dateTo}::date
    `);

    let processed = 0;
    for (const r of rows) {
      if (!r.campaignId) continue;
      await db
        .insert(ozonPerfExpenseDaily)
        .values({
          tenantId: ctx.tenantId,
          accountId: ctx.accountId,
          date: r.date,
          campaignId: r.campaignId,
          advObjectType: r.advObjectType,
          moneySpentKopecks: rublesToKopecks(r.moneySpentRub),
          bonusSpentKopecks: rublesToKopecks(r.bonusSpentRub),
          totalSpentKopecks: rublesToKopecks(r.totalSpentRub),
          raw: r as unknown as Record<string, unknown>,
        })
        .onConflictDoUpdate({
          target: [
            ozonPerfExpenseDaily.accountId,
            ozonPerfExpenseDaily.date,
            ozonPerfExpenseDaily.campaignId,
          ],
          set: {
            advObjectType: r.advObjectType,
            moneySpentKopecks: rublesToKopecks(r.moneySpentRub),
            bonusSpentKopecks: rublesToKopecks(r.bonusSpentRub),
            totalSpentKopecks: rublesToKopecks(r.totalSpentRub),
            raw: r as unknown as Record<string, unknown>,
            updatedAt: new Date(),
          },
        });
      processed += 1;
      ctx.onProgress?.(processed, rows.length);
    }

    if (processed === 0 && rows.length === 0) {
      warnings.push(
        'Performance API expense: за выбранный период нет расхода (или endpoint не вернул данные). ' +
          'Если в кабинете Ozon расход есть — проверьте период sync и наличие кампаний.',
      );
    }

    return { itemsProcessed: processed, itemsTotal: rows.length, warnings };
  });
}
