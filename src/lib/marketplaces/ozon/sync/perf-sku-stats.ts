// PURPOSE: Стейдж синхронизации per-SKU статистики Ozon Performance API.
//
// Архитектура (v0.18.14, root-cause fix):
//   1. Берём активные Search Promo кампании (CPC/CPM × SKU) из ozon_perf_campaigns.
//   2. Для каждого батча (по 50 ID) генерируем асинхронный отчёт
//      POST /api/client/statistic/products/generate с обязательным `campaigns[]`
//      (без него Ozon отдаёт default-отчёт «Оплата за заказ» с другой CSV-схемой).
//   3. Поллим статус до OK → скачиваем CSV → парсим.
//   4. Upsert в ozon_perf_sku_stats по (account, date, sku, campaign_id).
//
// Окно: ctx.settings.perfWindowDays (default 30).

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonPerfCampaigns, ozonPerfSkuStats } from '@/lib/db/schema/marketplaces';
import {
  generateSkuStatsReport,
  waitForReport,
  downloadReport,
  parseCsv,
  parseSkuStatsRow,
  isSkuStatsHeader,
} from '../performance/endpoints';
import { OzonPerfApiError } from '../performance/client';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import { buildPerfPeriod, describePeriod, type PerfPeriod } from './perf-period';

/** Сколько ID кампаний отправляем за один generate-запрос. Безопасный batch size. */
const CAMPAIGNS_PER_REPORT = 50;

/** Какие кампании берём в отчёт (CPC/CPM × SKU). */
const SUPPORTED_PAYMENT_TYPES = ['CPC', 'CPM'] as const;
const SUPPORTED_STATES = [
  'CAMPAIGN_STATE_RUNNING',
  'CAMPAIGN_STATE_PAUSED',
  'CAMPAIGN_STATE_FINISHED',
] as const;

/** Окна для auto-retry при 400 от Performance API (desc порядок). */
const RETRY_WINDOWS = [30, 14, 7] as const;
const RETRY_END_LAGS = [1, 2, 3, 4, 7] as const;

export async function syncPerfSkuStatsStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    if (!ctx.perfClient) {
      return {
        itemsProcessed: 0,
        ok: false,
        error: 'Performance API не подключён для этого аккаунта',
      };
    }

    const requestedWindow = ctx.settings.perfWindowDays ?? 30;

    // 1) Берём активные SKU-кампании (CPC/CPM) из базы. Стейдж perfCampaigns
    //    запускается раньше (см. ORDER в OZON_FULL_STAGES).
    const campaignRows = await db
      .select({
        campaignId: ozonPerfCampaigns.campaignId,
        paymentType: ozonPerfCampaigns.paymentType,
        state: ozonPerfCampaigns.state,
        advObjectType: ozonPerfCampaigns.advObjectType,
      })
      .from(ozonPerfCampaigns)
      .where(
        and(
          eq(ozonPerfCampaigns.tenantId, ctx.tenantId),
          eq(ozonPerfCampaigns.accountId, ctx.accountId),
        ),
      );

    const campaignIds = campaignRows
      .filter((c) =>
        c.paymentType && SUPPORTED_PAYMENT_TYPES.includes(c.paymentType as 'CPC' | 'CPM'),
      )
      // advObjectType может быть null у старых записей — пропускаем только BANNER/VIDEO
      .filter((c) => !c.advObjectType || c.advObjectType === 'SKU')
      .filter((c) => !c.state || (SUPPORTED_STATES as readonly string[]).includes(c.state))
      .map((c) => c.campaignId)
      .filter((id): id is string => Boolean(id));

    if (campaignIds.length === 0) {
      return {
        itemsProcessed: 0,
        ok: true,
        warnings: [
          'Нет активных Search Promo кампаний (CPC/CPM × SKU). Аналитика per-SKU показы/клики недоступна. Синхронизируйте «Рекламные кампании» раньше или создайте кампании в Ozon.',
        ],
      };
    }

    // 2) Строим окно period с retry-логикой (windowDays + lagDays).
    const windows: number[] = RETRY_WINDOWS.filter((w) => w <= requestedWindow);
    if (!windows.includes(requestedWindow)) windows.unshift(requestedWindow);
    const attempts = windows.flatMap((windowDays) =>
      RETRY_END_LAGS.map((lagDays) => ({ windowDays, lagDays })),
    );

    let period: PerfPeriod = buildPerfPeriod(requestedWindow);
    const warnings: string[] = [];
    let processed = 0;
    let totalRows = 0;

    // 3) Батчим кампании по CAMPAIGNS_PER_REPORT и для каждого батча
    //    запускаем generate → wait → download → parse → upsert.
    const batches: string[][] = [];
    for (let i = 0; i < campaignIds.length; i += CAMPAIGNS_PER_REPORT) {
      batches.push(campaignIds.slice(i, i + CAMPAIGNS_PER_REPORT));
    }

    // Очищаем всё окно перед записью (и campaign_id NOT NULL и NULL — legacy).
    // Делаем это один раз после выбора финального period первого батча.
    let cleaned = false;

    for (const [batchIdx, batch] of batches.entries()) {
      // 3.1) Генерируем отчёт с retry уменьшенного окна при 400.
      let uuid: string | null = null;
      for (const [index, attempt] of attempts.entries()) {
        period = buildPerfPeriod(attempt.windowDays, new Date(), attempt.lagDays);
        try {
          uuid = await generateSkuStatsReport(ctx.perfClient, {
            dateFrom: period.dateFrom,
            dateTo: period.dateTo,
            campaigns: batch,
            groupBy: 'DATE',
          });
          if (batchIdx === 0 && (attempt.windowDays < requestedWindow || attempt.lagDays > 1)) {
            warnings.push(
              `Ozon отклонил часть периодов, успешно с ${attempt.windowDays}d / лаг ${attempt.lagDays}d (${describePeriod(period)})`,
            );
          }
          break;
        } catch (e) {
          const is400 = e instanceof OzonPerfApiError && e.status === 400;
          if (!is400 || index === attempts.length - 1) {
            const msg = e instanceof Error ? e.message : String(e);
            warnings.push(
              `Batch ${batchIdx + 1}/${batches.length} (${batch.length} кампаний): ${msg}`,
            );
            uuid = null;
            break;
          }
        }
      }
      if (!uuid) continue;

      // 3.2) Очистка окна при первом успешном батче.
      if (!cleaned) {
        await db.execute(sql`
          DELETE FROM ${ozonPerfSkuStats}
          WHERE tenant_id = ${ctx.tenantId}
            AND account_id = ${ctx.accountId}
            AND date >= ${period.dateFrom}::date
            AND date <= ${period.dateTo}::date
        `);
        cleaned = true;
      }

      // 3.3) Ждём и скачиваем.
      try {
        const link = await waitForReport(ctx.perfClient, uuid, {
          maxAttempts: 60,
          intervalMs: 10_000,
        });
        const csv = await downloadReport(ctx.perfClient, link);
        const rows = parseCsv(csv);
        totalRows += rows.length;

        // Защита: если в заголовке CSV нет колонки SKU — это не SKU-stats отчёт.
        if (rows.length > 0 && !isSkuStatsHeader(rows[0])) {
          warnings.push(
            `Batch ${batchIdx + 1}/${batches.length}: Ozon вернул CSV неожиданного формата (нет колонки SKU). Пропуск.`,
          );
          continue;
        }

        // 3.4) Upsert всех валидных строк.
        for (const raw of rows) {
          const parsed = parseSkuStatsRow(raw);
          if (!parsed.sku) continue; // невалидный или отсутствующий SKU
          const day =
            parsed.date && parsed.date.length >= 10
              ? parsed.date.slice(0, 10)
              : period.dateTo;
          const campaignId = parsed.campaignId ?? batch[0] ?? null;

          await db
            .insert(ozonPerfSkuStats)
            .values({
              tenantId: ctx.tenantId,
              accountId: ctx.accountId,
              date: day,
              sku: parsed.sku,
              campaignId,
              views: parsed.views,
              clicks: parsed.clicks,
              cartAdds: parsed.cartAdds,
              orders: parsed.orders,
              ordersKopecks: rublesToKopecks(parsed.ordersRub),
              expenseKopecks: rublesToKopecks(parsed.expenseRub),
              raw,
            })
            .onConflictDoUpdate({
              target: [
                ozonPerfSkuStats.accountId,
                ozonPerfSkuStats.date,
                ozonPerfSkuStats.sku,
                ozonPerfSkuStats.campaignId,
              ],
              set: {
                views: sql`${ozonPerfSkuStats.views} + ${parsed.views}`,
                clicks: sql`${ozonPerfSkuStats.clicks} + ${parsed.clicks}`,
                cartAdds: sql`${ozonPerfSkuStats.cartAdds} + ${parsed.cartAdds}`,
                orders: sql`${ozonPerfSkuStats.orders} + ${parsed.orders}`,
                ordersKopecks: sql`${ozonPerfSkuStats.ordersKopecks} + ${rublesToKopecks(parsed.ordersRub)}`,
                expenseKopecks: sql`${ozonPerfSkuStats.expenseKopecks} + ${rublesToKopecks(parsed.expenseRub)}`,
                raw,
              },
            });
          processed += 1;
          ctx.onProgress?.(processed, totalRows);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        warnings.push(`Batch ${batchIdx + 1}/${batches.length}: ${msg}`);
      }
    }

    return { itemsProcessed: processed, itemsTotal: totalRows, warnings };
  });
}
