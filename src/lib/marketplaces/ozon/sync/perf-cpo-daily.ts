// PURPOSE: Стейдж синхронизации CPO (Оплата за заказ / all_sku_promo) кампаний
// из Ozon Performance API. Per-day агрегат по магазину, БЕЗ SKU.
//
// Архитектура (v0.18.15):
//   1. Проверяем что у аккаунта есть хотя бы одна активная ALL_SKU_PROMO
//      кампания в ozon_perf_campaigns (иначе sync пропускаем).
//   2. Запускаем GET /api/client/statistics/all_sku_promo/products/generate
//      с timeBounds.from/to.
//   3. Поллим статус → скачиваем CSV → парсим (per-day).
//   4. Upsert в ozon_perf_cpo_daily по (account, date).
//
// Используется в KPI/timeseries: суммируется с perf_sku_stats для общего
// расхода на рекламу (CPC + CPO).

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonPerfCampaigns, ozonPerfCpoDaily } from '@/lib/db/schema/marketplaces';
import {
  submitCpoDailyReport,
  waitForReport,
  downloadReport,
  parseCsv,
  parseCpoDailyRow,
  isCpoDailyHeader,
} from '../performance/endpoints';
import { OzonPerfApiError } from '../performance/client';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import { buildPerfPeriod, type PerfPeriod } from './perf-period';

const SUPPORTED_STATES = [
  'CAMPAIGN_STATE_RUNNING',
  'CAMPAIGN_STATE_PAUSED',
  'CAMPAIGN_STATE_FINISHED',
] as const;

const MAX_WINDOW_DAYS = 62;

const RETRY_WINDOWS = [30, 14, 7] as const;
const RETRY_END_LAGS = [1, 2, 3, 4, 7] as const;

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

    // 1) Проверяем наличие активных CPO кампаний.
    const cpoCampaigns = await db
      .select({
        campaignId: ozonPerfCampaigns.campaignId,
        state: ozonPerfCampaigns.state,
      })
      .from(ozonPerfCampaigns)
      .where(
        and(
          eq(ozonPerfCampaigns.tenantId, ctx.tenantId),
          eq(ozonPerfCampaigns.accountId, ctx.accountId),
          eq(ozonPerfCampaigns.advObjectType, 'ALL_SKU_PROMO'),
        ),
      );

    const activeCpo = cpoCampaigns.filter(
      (c) => !c.state || (SUPPORTED_STATES as readonly string[]).includes(c.state),
    );

    if (activeCpo.length === 0) {
      return {
        itemsProcessed: 0,
        ok: true,
        warnings: [
          ...localWarnings,
          'Нет активных CPO (Оплата за заказ) кампаний. Этот стейдж нужен только если у магазина включено продвижение «all_sku_promo».',
        ],
      };
    }

    // 2) Окно с retry.
    const windows: number[] = RETRY_WINDOWS.filter((w) => w <= requestedWindow);
    if (!windows.includes(requestedWindow)) windows.unshift(requestedWindow);
    const attempts = windows.flatMap((windowDays) =>
      RETRY_END_LAGS.map((lagDays) => ({ windowDays, lagDays })),
    );

    let period: PerfPeriod = buildPerfPeriod(requestedWindow);
    const warnings: string[] = [...localWarnings];
    let processed = 0;
    let totalRows = 0;

    // 3) Запрос отчёта.
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
          const msg = e instanceof Error ? e.message : String(e);
          return {
            itemsProcessed: 0,
            ok: false,
            error: `CPO отчёт: ${msg}`,
            warnings,
          };
        }
      }
    }
    if (!uuid) {
      return {
        itemsProcessed: 0,
        ok: false,
        error: 'CPO отчёт: не удалось получить UUID',
        warnings,
      };
    }

    // 4) Очистка окна перед записью.
    await db.execute(sql`
      DELETE FROM ${ozonPerfCpoDaily}
      WHERE tenant_id = ${ctx.tenantId}
        AND account_id = ${ctx.accountId}
        AND date >= ${period.dateFrom}::date
        AND date <= ${period.dateTo}::date
    `);

    // 5) Ожидание + скачивание.
    try {
      const link = await waitForReport(ctx.perfClient, uuid, {
        maxAttempts: 60,
        intervalMs: 10_000,
      });
      const csv = await downloadReport(ctx.perfClient, link);
      const rows = parseCsv(csv);
      totalRows = rows.length;

      if (rows.length > 0 && !isCpoDailyHeader(rows[0])) {
        const firstKeys = Object.keys(rows[0]).slice(0, 6).join(' | ');
        const csvPreview = csv.slice(0, 200).replace(/\n/g, '\\n');
        warnings.push(
          `CPO отчёт: CSV неожиданного формата (нет колонки расход/дата). Ключи: ${firstKeys}. Превью CSV: ${csvPreview}`,
        );
        return { itemsProcessed: 0, itemsTotal: totalRows, ok: true, warnings };
      }

      // 6) Upsert per-day.
      for (const raw of rows) {
        const parsed = parseCpoDailyRow(raw);
        if (!parsed) continue;

        await db
          .insert(ozonPerfCpoDaily)
          .values({
            tenantId: ctx.tenantId,
            accountId: ctx.accountId,
            date: parsed.date,
            expenseKopecks: rublesToKopecks(parsed.expenseRub),
            salesSearchKopecks: rublesToKopecks(parsed.salesSearchRub),
            salesRecoKopecks: rublesToKopecks(parsed.salesRecoRub),
            ordersSearch: parsed.ordersSearch,
            ordersReco: parsed.ordersReco,
            promotionStatus: parsed.status || null,
            raw,
          })
          .onConflictDoUpdate({
            target: [ozonPerfCpoDaily.accountId, ozonPerfCpoDaily.date],
            set: {
              expenseKopecks: rublesToKopecks(parsed.expenseRub),
              salesSearchKopecks: rublesToKopecks(parsed.salesSearchRub),
              salesRecoKopecks: rublesToKopecks(parsed.salesRecoRub),
              ordersSearch: parsed.ordersSearch,
              ordersReco: parsed.ordersReco,
              promotionStatus: parsed.status || null,
              raw,
              updatedAt: new Date(),
            },
          });

        processed += 1;
        ctx.onProgress?.(processed, totalRows);
      }
      // Diagnostic: CSV есть, но parser ничего не извлёк → значит формат
      // изменился или daty не парсятся.
      if (processed === 0 && rows.length > 0) {
        const firstKeys = Object.keys(rows[0]).slice(0, 6).join(' | ');
        const csvPreview = csv.slice(0, 200).replace(/\n/g, '\\n');
        warnings.push(
          `CPO отчёт: ${rows.length} строк CSV, но ни одной валидной даты. Ключи: ${firstKeys}. Превью: ${csvPreview}`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      warnings.push(`CPO отчёт: ${msg}`);
    }

    return { itemsProcessed: processed, itemsTotal: totalRows, warnings };
  });
}
