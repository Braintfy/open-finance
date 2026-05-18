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
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { runStageWithTiming, type StageContext, type StageResult } from './types';

function formatDateIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function syncPerfSkuStatsStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    if (!ctx.perfClient) {
      return {
        itemsProcessed: 0,
        ok: false,
        error: 'Performance API не подключён для этого аккаунта',
      };
    }
    const days = ctx.settings.perfWindowDays ?? 30;
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);

    // 1) Запрос на генерацию.
    const uuid = await generateSkuStatsReport(ctx.perfClient, {
      dateFrom: formatDateIso(from),
      dateTo: formatDateIso(to),
    });

    // 2) Ждём готовности (до ~10 мин).
    const link = await waitForReport(ctx.perfClient, uuid, {
      maxAttempts: 60,
      intervalMs: 10_000,
    });

    // 3) Скачиваем CSV.
    const csv = await downloadReport(ctx.perfClient, link);
    const rows = parseCsv(csv);

    // 4) Upsert по (account, date, sku, campaign_id=null).
    // Группируем по (sku, date) — для перф-данных по дням пишем агрегат
    // (campaignId=null), детальная разбивка кампаний доступна через
    // отдельный отчёт по кампаниям (опционально, TODO).
    let processed = 0;
    for (const raw of rows) {
      const parsed = parseSkuStatsRow(raw);
      if (!parsed.sku) continue;
      // Если date отсутствует — упаковываем под "today" (на крайний случай).
      const day = parsed.date && parsed.date.length >= 10 ? parsed.date.slice(0, 10) : formatDateIso(to);

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

    return { itemsProcessed: processed, itemsTotal: rows.length };
  });
}

// Suppress unused warning if sql is removed; keep import for future use.
void sql;
