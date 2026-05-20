// PURPOSE: Стейдж синхронизации CPO (Оплата за заказ) кампаний.
// ALL_SKU_PROMO — async-отчёт all_sku_promo/products/generate.
// SEARCH_PROMO («выбранные товары») дополняется из expense_daily (эталон).

import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonPerfCampaigns, ozonPerfCpoDaily } from '@/lib/db/schema/marketplaces';
import {
  submitCpoDailyReport,
  waitForReport,
  downloadReport,
  parseCsv,
  parseCpoDailyRow,
  isCpoDailyHeader,
  getExpenseDaily,
} from '../performance/endpoints';
import { OzonPerfApiError } from '../performance/client';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import { buildPerfPeriod, type PerfPeriod } from './perf-period';
import { invalidateOzonAnalyticsCache } from '../analytics-cache';

const CPO_ADV_TYPES = ['ALL_SKU_PROMO', 'SEARCH_PROMO'] as const;

const SUPPORTED_STATES = [
  'CAMPAIGN_STATE_RUNNING',
  'CAMPAIGN_STATE_PAUSED',
  'CAMPAIGN_STATE_FINISHED',
] as const;

const MAX_WINDOW_DAYS = 62;
const RETRY_WINDOWS = [30, 14, 7] as const;
const RETRY_END_LAGS = [1, 2, 3, 4, 7] as const;

function aggregateCpoFromExpense(
  rows: Awaited<ReturnType<typeof getExpenseDaily>>,
): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const r of rows) {
    const type = (r.advObjectType ?? '').toUpperCase();
    if (!CPO_ADV_TYPES.includes(type as (typeof CPO_ADV_TYPES)[number])) continue;
    byDate.set(r.date, (byDate.get(r.date) ?? 0) + r.totalSpentRub);
  }
  return byDate;
}

export async function syncPerfCpoDailyStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    if (!ctx.perfClient) {
      return {
        itemsProcessed: 0,
        ok: false,
        error: 'Performance API не подключён для этого аккаунта',
      };
    }

    let requestedWindow = ctx.settings.perfWindowDays ?? 30;
    const localWarnings: string[] = [];
    if (requestedWindow > MAX_WINDOW_DAYS) {
      localWarnings.push(
        `Окно ${requestedWindow}d > 62d (лимит Performance API). Clamp до 62d.`,
      );
      requestedWindow = MAX_WINDOW_DAYS;
    }

    const cpoCampaigns = await db
      .select({
        campaignId: ozonPerfCampaigns.campaignId,
        state: ozonPerfCampaigns.state,
        advObjectType: ozonPerfCampaigns.advObjectType,
      })
      .from(ozonPerfCampaigns)
      .where(
        and(
          eq(ozonPerfCampaigns.tenantId, ctx.tenantId),
          eq(ozonPerfCampaigns.accountId, ctx.accountId),
          inArray(ozonPerfCampaigns.advObjectType, [...CPO_ADV_TYPES]),
        ),
      );

    const activeCpo = cpoCampaigns.filter(
      (c) => !c.state || (SUPPORTED_STATES as readonly string[]).includes(c.state),
    );
    const hasAllSkuPromo = activeCpo.some((c) => c.advObjectType === 'ALL_SKU_PROMO');
    const hasSearchPromo = activeCpo.some((c) => c.advObjectType === 'SEARCH_PROMO');

    const windows: number[] = RETRY_WINDOWS.filter((w) => w <= requestedWindow);
    if (!windows.includes(requestedWindow)) windows.unshift(requestedWindow);
    const attempts = windows.flatMap((windowDays) =>
      RETRY_END_LAGS.map((lagDays) => ({ windowDays, lagDays })),
    );

    let period: PerfPeriod = buildPerfPeriod(requestedWindow);
    const warnings: string[] = [...localWarnings];
    let processed = 0;
    let totalRows = 0;

    if (activeCpo.length === 0) {
      warnings.push(
        'Нет активных CPO кампаний (ALL_SKU_PROMO / SEARCH_PROMO). Пробуем только expense breakdown.',
      );
    }

    // Окно sync (retry).
    for (const [index, attempt] of attempts.entries()) {
      period = buildPerfPeriod(attempt.windowDays, new Date(), attempt.lagDays);
      try {
        await getExpenseDaily(ctx.perfClient, {
          dateFrom: period.dateFrom,
          dateTo: period.dateTo,
        });
        break;
      } catch (e) {
        const is400 = e instanceof OzonPerfApiError && e.status === 400;
        if (!is400 || index === attempts.length - 1) break;
      }
    }

    await db.execute(sql`
      DELETE FROM ${ozonPerfCpoDaily}
      WHERE tenant_id = ${ctx.tenantId}
        AND account_id = ${ctx.accountId}
        AND date >= ${period.dateFrom}::date
        AND date <= ${period.dateTo}::date
    `);

    const reportByDate = new Map<string, ReturnType<typeof parseCpoDailyRow>>();

    if (hasAllSkuPromo) {
      let uuid: string | null = null;
      for (const [index, attempt] of attempts.entries()) {
        period = buildPerfPeriod(attempt.windowDays, new Date(), attempt.lagDays);
        try {
          uuid = await submitCpoDailyReport(ctx.perfClient, {
            dateFrom: period.dateFrom,
            dateTo: period.dateTo,
          });
          break;
        } catch (e) {
          const is400 = e instanceof OzonPerfApiError && e.status === 400;
          if (!is400 || index === attempts.length - 1) {
            warnings.push(
              `ALL_SKU_PROMO отчёт: ${e instanceof Error ? e.message : String(e)}`,
            );
            uuid = null;
            break;
          }
        }
      }

      if (uuid) {
        try {
          const link = await waitForReport(ctx.perfClient, uuid, {
            maxAttempts: 60,
            intervalMs: 10_000,
          });
          const csv = await downloadReport(ctx.perfClient, link);
          const rows = parseCsv(csv);
          totalRows = rows.length;

          if (rows.length > 0 && !isCpoDailyHeader(rows[0])) {
            warnings.push(
              `CPO ALL_SKU отчёт: неожиданный CSV (нет колонки расход/дата).`,
            );
          } else {
            for (const raw of rows) {
              const parsed = parseCpoDailyRow(raw);
              if (!parsed) continue;
              reportByDate.set(parsed.date, parsed);
            }
          }
        } catch (e) {
          warnings.push(`CPO ALL_SKU отчёт: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // Expense — эталон для SEARCH_PROMO + дополнение ALL_SKU_PROMO.
    let expenseRows: Awaited<ReturnType<typeof getExpenseDaily>> = [];
    try {
      expenseRows = await getExpenseDaily(ctx.perfClient, {
        dateFrom: period.dateFrom,
        dateTo: period.dateTo,
      });
    } catch (e) {
      warnings.push(
        `CPO expense supplement: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const expenseCpoByDate = aggregateCpoFromExpense(expenseRows);

    if (hasSearchPromo && expenseCpoByDate.size === 0) {
      warnings.push(
        'SEARCH_PROMO кампании есть, но expense не вернул CPO-расход. Запустите perfExpenseDaily.',
      );
    }

    const allDates = new Set<string>([
      ...reportByDate.keys(),
      ...expenseCpoByDate.keys(),
    ]);

    for (const date of allDates) {
      const fromReport = reportByDate.get(date);
      const expenseRub = expenseCpoByDate.get(date) ?? 0;
      const reportRub = fromReport?.expenseRub ?? 0;
      const finalRub = Math.max(expenseRub, reportRub);

      if (finalRub <= 0 && !fromReport) continue;

      const raw: Record<string, unknown> = {
        source: expenseRub >= reportRub ? 'expense' : 'all_sku_report',
        expenseRub: finalRub,
        reportRub,
        expenseRubOnly: expenseRub,
      };

      await db
        .insert(ozonPerfCpoDaily)
        .values({
          tenantId: ctx.tenantId,
          accountId: ctx.accountId,
          date,
          expenseKopecks: rublesToKopecks(finalRub),
          salesSearchKopecks: rublesToKopecks(fromReport?.salesSearchRub ?? 0),
          salesRecoKopecks: rublesToKopecks(fromReport?.salesRecoRub ?? 0),
          ordersSearch: fromReport?.ordersSearch ?? 0,
          ordersReco: fromReport?.ordersReco ?? 0,
          promotionStatus: fromReport?.status || null,
          raw,
        })
        .onConflictDoUpdate({
          target: [ozonPerfCpoDaily.accountId, ozonPerfCpoDaily.date],
          set: {
            expenseKopecks: rublesToKopecks(finalRub),
            salesSearchKopecks: rublesToKopecks(fromReport?.salesSearchRub ?? 0),
            salesRecoKopecks: rublesToKopecks(fromReport?.salesRecoRub ?? 0),
            ordersSearch: fromReport?.ordersSearch ?? 0,
            ordersReco: fromReport?.ordersReco ?? 0,
            promotionStatus: fromReport?.status || null,
            raw,
            updatedAt: new Date(),
          },
        });

      processed += 1;
      ctx.onProgress?.(processed, allDates.size);
    }

    if (expenseCpoByDate.size > 0) {
      const expenseSum = [...expenseCpoByDate.values()].reduce((a, b) => a + b, 0);
      warnings.push(
        `CPO expense (SEARCH_PROMO+ALL_SKU): ${Math.round(expenseSum).toLocaleString('ru-RU')} ₽ / ${expenseCpoByDate.size} дн.`,
      );
    }

    const cacheDeleted = await invalidateOzonAnalyticsCache(ctx.tenantId, ctx.accountId);
    if (cacheDeleted > 0) {
      warnings.push(`Analytics cache: удалено ${cacheDeleted} ключ(ей).`);
    }

    return { itemsProcessed: processed, itemsTotal: Math.max(totalRows, allDates.size), warnings };
  });
}
