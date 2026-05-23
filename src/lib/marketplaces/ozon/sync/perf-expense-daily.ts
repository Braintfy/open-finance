// PURPOSE: Sync эталонного расхода по кампаниям через
// Performance API `GET /api/client/statistics/expense`. Покрывает ВСЕ
// типы кампаний (SKU/SEARCH_PROMO/ALL_SKU_PROMO/BANNER/VIDEO_BANNER) +
// бонусы. Primary источник total adsRub в KPI/Аналитике.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonPerfExpenseDaily } from '@/lib/db/schema/marketplaces';
import { getExpenseDaily, sumExpenseRows } from '../performance/endpoints';
import { OzonPerfApiError } from '../performance/client';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import {
  buildPerfPeriod,
  buildPerfPeriodFromOverride,
  type PerfPeriod,
} from './perf-period';
import { invalidateOzonAnalyticsCache } from '../analytics-cache';

const MAX_WINDOW_DAYS = 62;

const RETRY_WINDOWS = [30, 14, 7] as const;
const RETRY_END_LAGS = [1, 2, 3, 4, 7] as const;

/** Синтетический campaignId для строк без id (store-level / CSV без id). */
function resolveCampaignId(row: {
  date: string;
  campaignId: string | null;
  advObjectType: string | null;
}): string {
  if (row.campaignId && String(row.campaignId).trim()) return String(row.campaignId).trim();
  const type = row.advObjectType ?? 'unknown';
  return `__store__:${type}:${row.date}`;
}

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

    const warnings: string[] = [];

    // v0.22.1: override-режим — один attempt без retry, с явными датами.
    const hasOverride = !!(ctx.overrideFromDate && ctx.overrideToDate);

    let period: PerfPeriod;
    let attempts: Array<{ windowDays: number; lagDays: number }>;
    if (hasOverride) {
      period = buildPerfPeriodFromOverride(ctx.overrideFromDate!, ctx.overrideToDate!);
      if (period.windowDays > MAX_WINDOW_DAYS) {
        warnings.push(
          `Окно ${period.windowDays}d > 62d (лимит Performance API). Используется clamp ${period.dateFrom}…${period.dateTo}.`,
        );
      }
      attempts = [{ windowDays: period.windowDays, lagDays: 0 }];
    } else {
      let requestedWindow = ctx.settings.perfWindowDays ?? 30;
      if (requestedWindow > MAX_WINDOW_DAYS) {
        warnings.push(
          `Окно ${requestedWindow}d > 62d (лимит Performance API). Clamp до 62d.`,
        );
        requestedWindow = MAX_WINDOW_DAYS;
      }
      const windows: number[] = RETRY_WINDOWS.filter((w) => w <= requestedWindow);
      if (!windows.includes(requestedWindow)) windows.unshift(requestedWindow);
      attempts = windows.flatMap((windowDays) =>
        RETRY_END_LAGS.map((lagDays) => ({ windowDays, lagDays })),
      );
      period = buildPerfPeriod(requestedWindow);
    }

    let rows: Awaited<ReturnType<typeof getExpenseDaily>> | null = null;
    for (const [index, attempt] of attempts.entries()) {
      if (!hasOverride) {
        period = buildPerfPeriod(attempt.windowDays, new Date(), attempt.lagDays);
      }
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

    const expenseSum = sumExpenseRows(rows);
    if (rows.length === 0) {
      warnings.push(
        'Performance API expense: за выбранный период нет расхода (или endpoint не вернул данные). ' +
          'Если в кабинете Ozon расход есть — проверьте период sync и наличие кампаний.',
      );
    }

    await db.execute(sql`
      DELETE FROM ${ozonPerfExpenseDaily}
      WHERE tenant_id = ${ctx.tenantId}
        AND account_id = ${ctx.accountId}
        AND date >= ${period.dateFrom}::date
        AND date <= ${period.dateTo}::date
    `);

    let processed = 0;
    let skippedNoId = 0;
    for (const r of rows) {
      const campaignId = resolveCampaignId(r);
      if (!r.campaignId) skippedNoId += 1;
      await db
        .insert(ozonPerfExpenseDaily)
        .values({
          tenantId: ctx.tenantId,
          accountId: ctx.accountId,
          date: r.date,
          campaignId,
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

    if (skippedNoId > 0) {
      warnings.push(
        `${skippedNoId} строк expense без campaignId — сохранены с синтетическим id (__store__:type:date).`,
      );
    }

    if (processed > 0) {
      warnings.push(
        `Expense sync: ${processed} строк, сумма ${Math.round(expenseSum).toLocaleString('ru-RU')} ₽ за ${period.dateFrom}…${period.dateTo}.`,
      );
    }

    const cacheDeleted = await invalidateOzonAnalyticsCache(ctx.tenantId, ctx.accountId);
    if (cacheDeleted > 0) {
      warnings.push(`Analytics cache: удалено ${cacheDeleted} ключ(ей).`);
    }

    return { itemsProcessed: processed, itemsTotal: rows.length, warnings };
  });
}
