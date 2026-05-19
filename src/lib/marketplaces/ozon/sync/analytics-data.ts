// PURPOSE: Стейдж синхронизации дневной аналитики продаж Ozon.
// Source: Seller API `POST /v1/analytics/data` (родной аналитический endpoint).
// Sink: таблица `ozon_analytics_daily` (один ряд на (account, sku, day)).
//
// Это primary source для блока Ozon Аналитика — числа совпадают с тем, что
// показывает сам Ozon в Seller-кабинете (Аналитика → Графики). До v0.18.13
// блок собирал данные из FBO/FBS postings + JOIN unit_products, что давало
// 60× потери (например, 2 заказа вместо 124).
//
// Грабли:
// 1. Лимит: 1 запрос/минуту на аккаунт. При пагинации спим 60 секунд.
// 2. Premium Plus: revenue + ordered_units доступны всем; delivered_units,
//    cancellations, returns — только Premium Plus / Pro. См. helper
//    `analyticsDataWithFallback()` — он сам деградирует до базовых метрик.
// 3. Для не-Premium даты ограничены последними 3 месяцами.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonAnalyticsDaily } from '@/lib/db/schema/marketplaces';
import {
  analyticsDataWithFallback,
  type AnalyticsDataTier,
  type AnalyticsMetric,
} from '../endpoints';
import { runStageWithTiming, type StageContext, type StageResult } from './types';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { setAccountAnalyticsTier } from '@/lib/marketplaces/queries';

/** Лимит /v1/analytics/data: 1 req/min. */
const RATE_LIMIT_PAUSE_MS = 60_000;
/** Размер страницы (max 1000 по доке). */
const PAGE_SIZE = 1000;
/** Не больше 5 страниц на одно окно — иначе скрипт зависнет на 5 минут. */
const MAX_PAGES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shiftIsoDate(iso: string, deltaDays: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD сегодня в Europe/Moscow. */
function moscowToday(): string {
  const now = new Date();
  const msc = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return msc.toISOString().slice(0, 10);
}

export async function syncAnalyticsDataStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    const windowDays = ctx.settings.analyticsWindowDays ?? 90;
    // dateTo = вчера, чтобы не цеплять незавершённый день (как в perf-period).
    const dateTo = shiftIsoDate(moscowToday(), -1);
    const dateFrom = shiftIsoDate(dateTo, -(windowDays - 1));

    let processed = 0;
    let tier: AnalyticsDataTier = 'premium-plus';
    let metrics: ReadonlyArray<AnalyticsMetric> = [];
    const warnings: string[] = [];

    // Удаляем существующие агрегаты для окна — заменяем «свежим» снимком.
    // Это ОК, потому что period обычно покрывает всю историю аккаунта (90 дней).
    await db.execute(sql`
      DELETE FROM ${ozonAnalyticsDaily}
      WHERE tenant_id = ${ctx.tenantId}
        AND account_id = ${ctx.accountId}
        AND date >= ${dateFrom}::date
        AND date <= ${dateTo}::date
    `);

    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      // Rate-limit: между страницами спим 60s. Перед первой страницей не спим.
      if (page > 0) {
        await sleep(RATE_LIMIT_PAUSE_MS);
      }

      const result = await analyticsDataWithFallback(ctx.client, {
        dateFrom,
        dateTo,
        dimension: ['sku', 'day'],
        limit: PAGE_SIZE,
        offset,
      });
      tier = result.tier;
      metrics = result.metrics;

      const data = result.response.result?.data ?? [];
      if (data.length === 0) break;

      // dimensions = [{id: sku, name: '...'}, {id: 'YYYY-MM-DD', name: '...'}]
      // metrics = массив чисел в том же порядке, что и result.metrics.
      const metricIndex = new Map<AnalyticsMetric, number>();
      metrics.forEach((m, i) => metricIndex.set(m, i));

      for (const row of data) {
        const skuDim = row.dimensions?.[0];
        const dayDim = row.dimensions?.[1];
        const sku = skuDim?.id?.trim();
        const day = dayDim?.id?.trim();
        if (!sku || !day || day.length < 10) continue;

        const m = row.metrics ?? [];
        const get = (name: AnalyticsMetric): number => {
          const idx = metricIndex.get(name);
          if (idx === undefined) return 0;
          const value = m[idx];
          return typeof value === 'number' && Number.isFinite(value) ? value : 0;
        };

        await db
          .insert(ozonAnalyticsDaily)
          .values({
            tenantId: ctx.tenantId,
            accountId: ctx.accountId,
            date: day.slice(0, 10),
            sku,
            revenueKopecks: rublesToKopecks(get('revenue')),
            orderedUnits: Math.round(get('ordered_units')),
            deliveredUnits: Math.round(get('delivered_units')),
            cancellations: Math.round(get('cancellations')),
            returns: Math.round(get('returns')),
            raw: row as unknown as Record<string, unknown>,
          })
          .onConflictDoUpdate({
            target: [
              ozonAnalyticsDaily.accountId,
              ozonAnalyticsDaily.date,
              ozonAnalyticsDaily.sku,
            ],
            set: {
              revenueKopecks: rublesToKopecks(get('revenue')),
              orderedUnits: Math.round(get('ordered_units')),
              deliveredUnits: Math.round(get('delivered_units')),
              cancellations: Math.round(get('cancellations')),
              returns: Math.round(get('returns')),
              raw: row as unknown as Record<string, unknown>,
              updatedAt: new Date(),
            },
          });
        processed += 1;
        ctx.onProgress?.(processed);
      }

      // Если страница не полная — больше данных нет.
      if (data.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }

    // Запоминаем tier на аккаунте — UI покажет бейдж + API аналитики
    // понимает, нужен ли fallback на ozon_orders для cancellations/returns.
    await setAccountAnalyticsTier({
      tenantId: ctx.tenantId,
      id: ctx.accountId,
      tier,
    });

    if (tier === 'basic') {
      warnings.push(
        'Аналитика в базовом режиме: revenue + ordered_units из Ozon, ' +
          'отмены/возвраты дополняем из postings. Подключите Premium Plus ' +
          'для полной агрегатной аналитики.',
      );
    }

    return { itemsProcessed: processed, itemsTotal: processed, warnings };
  });
}
