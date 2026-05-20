// PURPOSE: Стейдж синхронизации per-SKU статистики Ozon Performance API
// для CPC/CPM (Search Promo) кампаний.
//
// Архитектура (v0.18.15, root-cause fix):
//   1. Берём активные SKU/SEARCH_PROMO кампании из ozon_perf_campaigns
//      (фильтр по adv_object_type — payment_type обычно null).
//   2. Для КАЖДОЙ кампании (по одной — чтобы получать CSV, не ZIP) запускаем
//      POST /api/client/statistics (SubmitRequest) с groupBy: 'DATE'.
//      Это правильный endpoint для дневной разбивки per-SKU.
//   3. Поллим статус до OK → скачиваем CSV → парсим.
//   4. Upsert в ozon_perf_sku_stats по (account, date, sku, campaign_id).
//
// Окно: ctx.settings.perfWindowDays (default 30, max 62 — лимит Ozon API).
// Для CPO кампаний (ALL_SKU_PROMO) есть отдельный стейдж perfCpoDaily.

import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonPerfCampaigns, ozonPerfSkuStats } from '@/lib/db/schema/marketplaces';
import {
  submitStatisticsReport,
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
import { invalidateOzonAnalyticsCache } from '../analytics-cache';

/**
 * Какие adv_object_type обрабатываются стейджем per-SKU CPC.
 *
 * ВНИМАНИЕ: в v0.18.20 убрали `SEARCH_PROMO` из этого фильтра —
 * это «Оплата за заказ» (CPO), отчёт `POST /api/client/statistics` для них
 * возвращает CSV без колонки SKU (на чём наш парсер падал и тихо съедал
 * расход). CPO-кампании покрываются стейджем `perfCpoDaily` (store-aggregate),
 * а total adsRub теперь идёт через эталонный `perfExpenseDaily`.
 */
const SEARCH_PROMO_ADV_OBJECTS = ['SKU'] as const;

/**
 * Какие state кампаний берём для отчёта.
 * Согласно дампу Ozon Performance API (раздел CampaignState), фактически
 * встречаются: RUNNING, FINISHED, PAUSED (как «приостановлена селлером»),
 * INACTIVE/STOPPED — попадаются в некоторых ответах. Мы оставляем три
 * основных state'а: запущенные сейчас, приостановленные и завершённые
 * (всё ещё дают расход за прошедший период).
 */
const SUPPORTED_STATES = [
  'CAMPAIGN_STATE_RUNNING',
  'CAMPAIGN_STATE_PAUSED',
  'CAMPAIGN_STATE_FINISHED',
] as const;

/** Максимальное окно отчёта (лимит Ozon Performance API SubmitRequest). */
const MAX_WINDOW_DAYS = 62;

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

    let requestedWindow = ctx.settings.perfWindowDays ?? 30;
    const localWarnings: string[] = [];
    if (requestedWindow > MAX_WINDOW_DAYS) {
      localWarnings.push(
        `Окно ${requestedWindow}d > 62d (лимит Performance API). Clamp до 62d.`,
      );
      requestedWindow = MAX_WINDOW_DAYS;
    }

    // 1) Берём активные Search Promo кампании из БД. Фильтр по adv_object_type
    //    (а не payment_type — он null у всех кампаний).
    const campaignRows = await db
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
        ),
      );

    const campaignIds = campaignRows
      .filter((c) =>
        c.advObjectType &&
        (SEARCH_PROMO_ADV_OBJECTS as readonly string[]).includes(c.advObjectType),
      )
      .filter((c) => !c.state || (SUPPORTED_STATES as readonly string[]).includes(c.state))
      .map((c) => c.campaignId)
      .filter((id): id is string => Boolean(id));

    if (campaignIds.length === 0) {
      return {
        itemsProcessed: 0,
        ok: true,
        warnings: [
          ...localWarnings,
          'Нет активных CPC кампаний (adv_object_type=SKU, state RUNNING/PAUSED/FINISHED). Per-SKU CPC аналитика недоступна. CPO-кампании (SEARCH_PROMO/ALL_SKU_PROMO) синхронизируются отдельными стейджами perfCpoDaily / perfExpenseDaily.',
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
    const warnings: string[] = [...localWarnings];
    let processed = 0;
    let totalRows = 0;

    // Очищаем всё окно перед записью один раз.
    let cleaned = false;

    // 3) Каждой кампании — отдельный отчёт (CSV, не ZIP).
    for (const [campaignIdx, campaignId] of campaignIds.entries()) {
      // 3.1) Генерируем отчёт с retry уменьшенного окна при 400.
      let uuid: string | null = null;
      for (const [index, attempt] of attempts.entries()) {
        period = buildPerfPeriod(attempt.windowDays, new Date(), attempt.lagDays);
        try {
          uuid = await submitStatisticsReport(ctx.perfClient, {
            dateFrom: period.dateFrom,
            dateTo: period.dateTo,
            campaigns: [campaignId],
            groupBy: 'DATE',
          });
          if (campaignIdx === 0 && (attempt.windowDays < requestedWindow || attempt.lagDays > 1)) {
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
              `Кампания ${campaignId} (${campaignIdx + 1}/${campaignIds.length}): ${msg}`,
            );
            uuid = null;
            break;
          }
        }
      }
      if (!uuid) continue;

      // 3.2) Очистка окна при первом успешном отчёте.
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

        // Защита: если в заголовке нет колонки SKU — это не CPC отчёт.
        if (rows.length > 0 && !isSkuStatsHeader(rows[0])) {
          // Diagnostic: первые 5 ключей + первые 200 символов raw CSV,
          // чтобы понять что Ozon вернул вместо ожидаемого формата.
          const firstKeys = Object.keys(rows[0]).slice(0, 5).join(' | ');
          const csvPreview = csv.slice(0, 200).replace(/\n/g, '\\n');
          warnings.push(
            `Кампания ${campaignId}: CSV без колонки SKU (возможно, баннерная или CPO).
Первые ключи: ${firstKeys}. Превью CSV: ${csvPreview}`,
          );
          continue;
        }

        // 3.4) Upsert всех валидных строк.
        const processedBeforeCampaign = processed;
        for (const raw of rows) {
          const parsed = parseSkuStatsRow(raw);
          if (!parsed.sku) continue;
          const day =
            parsed.date && parsed.date.length >= 10
              ? parsed.date.slice(0, 10)
              : period.dateTo;
          // Если CSV не вернул campaign_id (иногда отсутствует), используем
          // тот, который мы передавали в запрос — это корректно для одной кампании.
          const finalCampaignId = parsed.campaignId ?? campaignId;

          await db
            .insert(ozonPerfSkuStats)
            .values({
              tenantId: ctx.tenantId,
              accountId: ctx.accountId,
              date: day,
              sku: parsed.sku,
              campaignId: finalCampaignId,
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
                views: parsed.views,
                clicks: parsed.clicks,
                cartAdds: parsed.cartAdds,
                orders: parsed.orders,
                ordersKopecks: rublesToKopecks(parsed.ordersRub),
                expenseKopecks: rublesToKopecks(parsed.expenseRub),
                raw,
              },
            });
          processed += 1;
          ctx.onProgress?.(processed, totalRows);
        }
        // Diagnostic: если CSV не пустой, но ни одной валидной row не получено
        // (всё в parsed.sku === '' или ключи не нашлись) — добавляем warning
        // с примером ключей и превью, иначе пользователь видит «sync ok с 0
        // записей» без объяснения.
        if (processed === processedBeforeCampaign && rows.length > 0) {
          const firstKeys = Object.keys(rows[0]).slice(0, 6).join(' | ');
          const csvPreview = csv.slice(0, 200).replace(/\n/g, '\\n');
          warnings.push(
            `Кампания ${campaignId}: ${rows.length} строк CSV, но ни одного валидного SKU. Ключи: ${firstKeys}. Превью: ${csvPreview}`,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        warnings.push(`Кампания ${campaignId}: ${msg}`);
      }
    }

    const cacheDeleted = await invalidateOzonAnalyticsCache(ctx.tenantId, ctx.accountId);
    if (cacheDeleted > 0) {
      warnings.push(`Analytics cache: удалено ${cacheDeleted} ключ(ей).`);
    }

    return { itemsProcessed: processed, itemsTotal: totalRows, warnings };
  });
}
