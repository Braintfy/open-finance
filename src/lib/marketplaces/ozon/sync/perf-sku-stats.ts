// PURPOSE: Стейдж синхронизации per-SKU статистики Ozon Performance API.
// 1. Генерирует async-отчёт `all_sku_promo/products/generate` за окно.
// 2. Поллит статус до OK.
// 3. Скачивает CSV.
// 4. Парсит и upsert'ит в ozon_perf_sku_stats.
//
// Окно: ctx.settings.perfWindowDays (default 30).

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonPerfSkuStats } from '@/lib/db/schema/marketplaces';
import {
  generateSkuStatsReport,
  waitForReport,
  downloadReport,
  parseCsv,
  parseSkuStatsRow,
} from '../performance/endpoints';
import { OzonPerfApiError } from '../performance/client';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import { buildPerfPeriod, describePeriod, type PerfPeriod } from './perf-period';

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
    // Строим список окон для попытки: запрошенное + fallback'и меньше.
    const windows: number[] = RETRY_WINDOWS.filter((w) => w <= requestedWindow);
    if (!windows.includes(requestedWindow)) {
      windows.unshift(requestedWindow);
    }

    // 1) Запрос на генерацию с auto-retry уменьшенного окна при 400.
    let uuid: string | null = null;
    let period: PerfPeriod = buildPerfPeriod(requestedWindow);
    const warnings: string[] = [];

    const attempts = windows.flatMap((windowDays) =>
      RETRY_END_LAGS.map((lagDays) => ({ windowDays, lagDays })),
    );

    for (const [index, attempt] of attempts.entries()) {
      period = buildPerfPeriod(attempt.windowDays, new Date(), attempt.lagDays);
      try {
        uuid = await generateSkuStatsReport(ctx.perfClient, {
          dateFrom: period.dateFrom,
          dateTo: period.dateTo,
        });
        if (attempt.windowDays < requestedWindow || attempt.lagDays > 1) {
          warnings.push(
            `Ozon отклонил часть периодов, успешно с ${attempt.windowDays}d / лаг ${attempt.lagDays}d (${describePeriod(period)})`,
          );
        }
        break;
      } catch (e) {
        // Retry только на 400 (некорректный период); другие ошибки — сразу выход.
        const is400 = e instanceof OzonPerfApiError && e.status === 400;
        if (!is400 || index === attempts.length - 1) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            itemsProcessed: 0,
            ok: false,
            error: `${msg} — период ${describePeriod(period)}`,
          };
        }
        // Продолжаем с меньшим окном.
      }
    }

    if (!uuid) {
      return {
        itemsProcessed: 0,
        ok: false,
        error: `Performance API: не удалось получить отчёт ни с одним окном`,
      };
    }

    // 2) Ждём готовности (до ~10 мин).
    const link = await waitForReport(ctx.perfClient, uuid, {
      maxAttempts: 60,
      intervalMs: 10_000,
    });

    // 3) Скачиваем CSV.
    const csv = await downloadReport(ctx.perfClient, link);
    const rows = parseCsv(csv);

    await db.execute(sql`
      DELETE FROM ${ozonPerfSkuStats}
      WHERE tenant_id = ${ctx.tenantId}
        AND account_id = ${ctx.accountId}
        AND date >= ${period.dateFrom}::date
        AND date <= ${period.dateTo}::date
        AND campaign_id IS NULL
    `);

    // 4) Upsert по (account, date, sku, campaign_id=null).
    // Группируем по (sku, date) — для перф-данных по дням пишем агрегат
    // (campaignId=null), детальная разбивка кампаний доступна через
    // отдельный отчёт по кампаниям (опционально, TODO).
    let processed = 0;
    for (const raw of rows) {
      const parsed = parseSkuStatsRow(raw);
      if (!parsed.sku) continue;
      // Если date отсутствует — упаковываем под "today" (на крайний случай).
      const day = parsed.date && parsed.date.length >= 10 ? parsed.date.slice(0, 10) : period.dateTo;

      await db
        .insert(ozonPerfSkuStats)
        .values({
          tenantId: ctx.tenantId,
          accountId: ctx.accountId,
          date: day,
          sku: parsed.sku,
          campaignId: null,
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
      ctx.onProgress?.(processed, rows.length);
    }

    // 5) Прибиваем sql `updateAccountPerfStatus` через прямой запрос — финал
    // ставит full.ts (общий статус). Но добавим лёгкий маркер успешного
    // perf-sync через side-effect перфокеннадо здесь нет — оркестратор сам
    // позовёт updateAccountLastSync.

    return { itemsProcessed: processed, itemsTotal: rows.length, warnings };
  });
}
