// PURPOSE: Ozon-аналитика per-product. Для каждого товара —
// выручка, заказы, возвраты, расходы на рекламу, ДРР, остаток за выбранный
// период. tenant-scoped, joins из ozon_orders + ozon_transactions через
// unit_products как «спин».

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { unitProducts } from '@/lib/db/schema/unit-economics';
import {
  ozonOrders,
  ozonTransactions,
  ozonPerfSkuStats,
  ozonAnalyticsDaily,
} from '@/lib/db/schema/marketplaces';
import type { OzonAnalyticsRow } from '@/lib/blocks/catalog/unit-ozon-analytics-types';
import { getRedis } from '@/lib/redis';
import { getOzonAdsTotals, type OzonAdsSource } from '@/lib/marketplaces/ozon/ads-totals';
import { OZON_ANALYTICS_CACHE_VERSION } from '@/lib/marketplaces/ozon/analytics-cache';
import {
  parseOzonPeriodFromRequest,
  resolveOzonQueryPeriod,
  type OzonQueryPeriod,
} from '@/lib/marketplaces/ozon/query-period';

// Re-export для существующих импортов API-роуты.
export type { OzonAnalyticsRow };

export type OzonAnalyticsResponse = {
  ok: true;
  rows: OzonAnalyticsRow[];
  totals: {
    revenueRub: number;
    /** Суммарный расход на рекламу (CPC per-SKU + CPO агрегат по магазину). */
    adsRub: number;
    /** CPC/CPM per-SKU расход (из ozon_perf_sku_stats). */
    adsCpcRub: number;
    /** CPO расход (из ozon_perf_cpo_daily). Агрегат по магазину, не разносится по SKU. */
    adsCpoRub: number;
    delivered: number;
    /** Доставленные FBO-заказы. */
    deliveredFbo: number;
    /** Доставленные FBS-заказы. */
    deliveredFbs: number;
    cancelled: number;
    returned: number;
    drrPct: number | null;
    productsWithSales: number;
  };
  period: OzonQueryPeriod;
  adsSource: OzonAdsSource;
  /** Источник данных продаж: 'analytics-api' = ozon_analytics_daily, 'orders-fallback' = ozon_orders. */
  ordersSource: 'analytics-api' | 'orders-fallback';
  /** Есть CPO расход в периоде (влияет на UI бейдж ≅). */
  hasCpoExpense: boolean;
  reconciliationGapPct: number | null;
  expenseByAdvType: Array<{ advObjectType: string | null; adsRub: number }>;
};

/** TTL Redis-кэша для аналитики, секунды. Sync переписывает данные не чаще раза в час. */
const ANALYTICS_CACHE_TTL_SEC = 3600;

/**
 * Эвристика для классификации транзакций Ozon как «рекламные».
 * operation_type у Ozon такие: OperationMarketplaceServicePremiumPromotion,
 * MarketingServicesItemTopPromotion, ServiceMarketplaceServiceMarketing*.
 * Простой подход: lower(type) содержит promot/advertis/marketing.
 */
const ADS_FILTER_SQL = sql`(
  lower(operation_type) LIKE '%promot%'
  OR lower(operation_type) LIKE '%advertis%'
  OR lower(operation_type) LIKE '%marketing%'
)`;

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const accountId = url.searchParams.get('accountId');
    const resolvedPeriod =
      parseOzonPeriodFromRequest(
        url.searchParams.get('fromDate'),
        url.searchParams.get('toDateExclusive'),
        url.searchParams.get('from'),
        url.searchParams.get('to'),
      ) ?? resolveOzonQueryPeriod('30d');

    const { fromDate, toDateExclusive } = resolvedPeriod;

    const fromMs = new Date(fromDate + 'T00:00:00Z').getTime();
    const toExMs = new Date(toDateExclusive + 'T00:00:00Z').getTime();
    const periodDays = Math.max(1, Math.round((toExMs - fromMs) / (24 * 3600 * 1000)));

    const now = new Date();
    // текущем `period` qty_delivered = 0 — типично для коротких окон 7d
    // на товарах с медленным оборотом. См. поле daysOfStockFallback30d.
    const fallbackWindowDays = 30;
    const fallbackFromIso = new Date(now.getTime() - fallbackWindowDays * 24 * 3600 * 1000).toISOString();
    const fallbackToIso = now.toISOString();

    // Redis-кэш: блок аналитики переоткрывается часто, sync переписывает данные
    // максимум раз в час. Ключ зависит от tenant + accountId + период.
    const cacheKey = `analytics:ozon:${OZON_ANALYTICS_CACHE_VERSION}:${session.tenantId}:${accountId ?? 'all'}:${fromDate}:${toDateExclusive}`;
    try {
      const cached = await getRedis().get(cacheKey);
      if (cached) {
        return NextResponse.json(JSON.parse(cached) as OzonAnalyticsResponse);
      }
    } catch {
      // Cache не критичен — продолжаем без него.
    }

    const accountCondOrders = accountId ? sql`AND o.account_id = ${accountId}` : sql``;
    const accountCondTx = accountId ? sql`AND tx.account_id = ${accountId}` : sql``;
    const accountCondPerf = accountId ? sql`AND ps.account_id = ${accountId}` : sql``;
    const accountCondAnalytics = accountId ? sql`AND ad.account_id = ${accountId}` : sql``;
    const accountCondScheme = accountId ? sql`AND o2.account_id = ${accountId}` : sql``;
    const accountCondUp = accountId
      ? sql`AND ${unitProducts.marketplaceAccountId} = ${accountId}`
      : sql``;

    // Единый источник total ads (expense → CPC+CPO → transactions).
    const adsTotals = await getOzonAdsTotals({
      tenantId: session.tenantId,
      accountId,
      fromDate,
      toDateExclusive,
    });
    const cpoTotalRub = adsTotals.breakdown.cpoRub;
    const adsSource = adsTotals.adsSource;

    // Определяем источник рекламных данных per-SKU: perf_sku_stats → transactions.
    type AdsCheckRow = { cnt: number };
    const perfCheck = await db.execute<AdsCheckRow>(sql`
      SELECT COUNT(*)::int AS cnt FROM ${ozonPerfSkuStats} ps
      WHERE ps.tenant_id = ${session.tenantId}
        ${accountCondPerf}
        AND ps.date >= ${fromDate}::date
        AND ps.date < ${toDateExclusive}::date
      LIMIT 1
    `);
    const perfCheckRows: AdsCheckRow[] = Array.isArray(perfCheck)
      ? (perfCheck as AdsCheckRow[])
      : (((perfCheck as unknown) as { rows: AdsCheckRow[] }).rows ?? []);
    const hasPerfData = (perfCheckRows[0]?.cnt ?? 0) > 0;

    // Определяем источник продаж: ozon_analytics_daily (primary, после v0.18.13) →
    // ozon_orders (legacy fallback). Если новой таблицы пока нет/пустая — используем старый CTE.
    const analyticsCheck = await db.execute<AdsCheckRow>(sql`
      SELECT COUNT(*)::int AS cnt FROM ${ozonAnalyticsDaily} ad
      WHERE ad.tenant_id = ${session.tenantId}
        ${accountCondAnalytics}
        AND ad.date >= ${fromDate}::date
        AND ad.date < ${toDateExclusive}::date
      LIMIT 1
    `);
    const analyticsCheckRows: AdsCheckRow[] = Array.isArray(analyticsCheck)
      ? (analyticsCheck as AdsCheckRow[])
      : (((analyticsCheck as unknown) as { rows: AdsCheckRow[] }).rows ?? []);
    const hasAnalyticsData = (analyticsCheckRows[0]?.cnt ?? 0) > 0;
    const ordersSource: 'analytics-api' | 'orders-fallback' = hasAnalyticsData
      ? 'analytics-api'
      : 'orders-fallback';

    // CTE для рекламных данных зависит от источника.
    const adsCte = hasPerfData
      ? sql`
      agg_ads AS (
        SELECT
          ps.sku,
          MIN(ps.raw->>'offer_id') FILTER (WHERE COALESCE(ps.raw->>'offer_id', '') <> '') AS offer_id,
          MIN(ps.raw->>'Артикул') FILTER (WHERE COALESCE(ps.raw->>'Артикул', '') <> '') AS article_raw,
          SUM(ps.expense_kopecks) AS ads_kopecks,
          SUM(ps.views) AS perf_views,
          SUM(ps.clicks) AS perf_clicks,
          SUM(ps.cart_adds) AS perf_cart_adds
        FROM ${ozonPerfSkuStats} ps
        WHERE ps.tenant_id = ${session.tenantId}
          ${accountCondPerf}
          AND ps.date >= ${fromDate}::date
          AND ps.date < ${toDateExclusive}::date
        GROUP BY ps.sku
      )`
      : sql`
      agg_ads AS (
        SELECT
          tx.sku,
          NULL::text AS offer_id,
          NULL::text AS article_raw,
          SUM(ABS(tx.amount_kopecks)) AS ads_kopecks,
          0::bigint AS perf_views,
          0::bigint AS perf_clicks,
          0::bigint AS perf_cart_adds
        FROM ${ozonTransactions} tx
        WHERE tx.tenant_id = ${session.tenantId}
          ${accountCondTx}
          AND tx.operation_date >= ${fromDate}::timestamp
          AND tx.operation_date < ${toDateExclusive}::timestamp
          AND tx.sku IS NOT NULL
          AND ${ADS_FILTER_SQL}
        GROUP BY tx.sku
      )`;

    // CTE для per-SKU рекламы (views/clicks/CPC) — отдельно от store-total.

    type Raw = {
      productId: string;
      article: string | null;
      sku: string | null;
      name: string;
      primary_image: string | null;
      stock_marketplace: number;
      stock_own: number;
      price_kopecks: number;
      cost_kopecks: number;
      marketing_price_rub: number | string | null;
      turnover_days_meta: number | string | null;
      delivered: number;
      delivered_fbo: number | string;
      delivered_fbs: number | string;
      cancelled: number;
      returned: number;
      qty_delivered: number | string;
      qty_30d: number | string;
      revenue_kopecks: number | string;
      ads_kopecks: number | string;
      perf_views: number | string;
      perf_clicks: number | string;
      perf_cart_adds: number | string;
    };

    // Velocity-fallback за 30-дневное окно: считаем qty_delivered по
    // offer_id за последние 30 дней (независимо от текущего period). Если
    // в текущем period qty_delivered = 0, фронт использует эту velocity
    // для расчёта daysOfStockFallback30d.
    const velocity30Cte = sql`
      velocity_30d AS (
        SELECT
          (it->>'offerId')::text AS offer_id,
          SUM(NULLIF(it->>'quantity', '')::numeric) FILTER (
            WHERE o.cancelled_at IS NULL
              AND o.returned_at IS NULL
              AND lower(o.status) NOT LIKE '%cancel%'
              AND lower(o.status) NOT LIKE '%return%'
          ) AS qty_30d
        FROM ${ozonOrders} o
        CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
        WHERE o.tenant_id = ${session.tenantId}
          ${accountCondOrders}
          AND o.order_created_at >= ${fallbackFromIso}::timestamp
          AND o.order_created_at < ${fallbackToIso}::timestamp
          AND COALESCE(it->>'offerId', '') <> ''
        GROUP BY (it->>'offerId')::text
      )`;

    // FBO/FBS разделение всегда из ozon_orders (независимо от primary source).
    // Объединяем по offer_id — это поле есть во всех схемах.
    const schemeCte = sql`
      agg_scheme AS (
        SELECT
          (it->>'offerId')::text AS offer_id,
          COUNT(DISTINCT o2.id) FILTER (
            WHERE o2.scheme = 'fbo'
              AND o2.cancelled_at IS NULL
              AND o2.returned_at IS NULL
              AND lower(o2.status) NOT LIKE '%cancel%'
              AND lower(o2.status) NOT LIKE '%return%'
          ) AS delivered_fbo,
          COUNT(DISTINCT o2.id) FILTER (
            WHERE o2.scheme = 'fbs'
              AND o2.cancelled_at IS NULL
              AND o2.returned_at IS NULL
              AND lower(o2.status) NOT LIKE '%cancel%'
              AND lower(o2.status) NOT LIKE '%return%'
          ) AS delivered_fbs
        FROM ${ozonOrders} o2
        CROSS JOIN LATERAL jsonb_array_elements(o2.items) AS it
        WHERE o2.tenant_id = ${session.tenantId}
          ${accountCondScheme}
          AND o2.order_created_at >= ${fromDate}::timestamp
          AND o2.order_created_at < ${toDateExclusive}::timestamp
          AND COALESCE(it->>'offerId', '') <> ''
        GROUP BY (it->>'offerId')::text
      )`;

    // CTE для продаж зависит от источника:
    //  - analytics-api (после v0.18.13): ozon_analytics_daily, JOIN по SKU.
    //    Это даёт цифры идентичные Seller-кабинету Ozon.
    //  - orders-fallback (legacy): ozon_orders.items.offer_id, JOIN по article.
    //    Используется когда ozon_analytics_daily ещё пустая.
    //
    // Колонки в обоих случаях одинаковы: match_key, delivered, cancelled,
    // returned, qty_delivered, revenue_rub. Это позволяет иметь общий хвост
    // запроса с LEFT JOIN agg_orders ao ON ao.match_key = ...
    const ordersCte = hasAnalyticsData
      ? sql`
      agg_orders AS (
        SELECT
          ad.sku AS match_key,
          SUM(ad.ordered_units)::int AS delivered,
          SUM(ad.cancellations)::int AS cancelled,
          SUM(ad.returns)::int AS returned,
          SUM(ad.delivered_units)::numeric AS qty_delivered,
          SUM(ad.revenue_kopecks)::numeric / 100 AS revenue_rub
        FROM ${ozonAnalyticsDaily} ad
        WHERE ad.tenant_id = ${session.tenantId}
          ${accountCondAnalytics}
          AND ad.date >= ${fromDate}::date
          AND ad.date < ${toDateExclusive}::date
        GROUP BY ad.sku
      ),
      -- Fallback для basic-tier (cancellations/returns в analytics_daily = 0):
      -- доагрегируем cancelled/returned из ozon_orders по offer_id → article.
      agg_orders_fb AS (
        SELECT
          (it->>'offerId')::text AS match_key,
          COUNT(DISTINCT o.id) FILTER (
            WHERE o.cancelled_at IS NOT NULL OR lower(o.status) LIKE '%cancel%'
          ) AS cancelled,
          COUNT(DISTINCT o.id) FILTER (
            WHERE o.returned_at IS NOT NULL OR lower(o.status) LIKE '%return%'
          ) AS returned
        FROM ${ozonOrders} o
        CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
        WHERE o.tenant_id = ${session.tenantId}
          ${accountCondOrders}
          AND o.order_created_at >= ${fromDate}::timestamp
          AND o.order_created_at < ${toDateExclusive}::timestamp
          AND COALESCE(it->>'offerId', '') <> ''
        GROUP BY (it->>'offerId')::text
      )`
      : sql`
      order_items AS (
        SELECT
          o.id,
          o.status,
          o.order_created_at,
          o.delivered_at,
          o.cancelled_at,
          o.returned_at,
          (it->>'sku')::text AS item_sku,
          (it->>'offerId')::text AS offer_id,
          COALESCE(NULLIF(it->>'price', '')::numeric, 0) AS item_price_rub,
          COALESCE(NULLIF(it->>'quantity', '')::numeric, 0) AS item_qty
        FROM ${ozonOrders} o
        CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
        WHERE o.tenant_id = ${session.tenantId}
          ${accountCondOrders}
          AND o.order_created_at >= ${fromDate}::timestamp
          AND o.order_created_at < ${toDateExclusive}::timestamp
      ),
      agg_orders AS (
        SELECT
          offer_id AS match_key,
          -- delivered = все заказы кроме явных отмен/возвратов
          -- (включая awaiting_deliver, delivering). Иначе на коротком окне
          -- 7d большинство заказов ещё в пути и блок показывает 0 продаж.
          COUNT(DISTINCT id) FILTER (
            WHERE cancelled_at IS NULL
              AND returned_at IS NULL
              AND lower(status) NOT LIKE '%cancel%'
              AND lower(status) NOT LIKE '%return%'
          ) AS delivered,
          COUNT(DISTINCT id) FILTER (
            WHERE cancelled_at IS NOT NULL OR lower(status) LIKE '%cancel%'
          ) AS cancelled,
          COUNT(DISTINCT id) FILTER (
            WHERE returned_at IS NOT NULL OR lower(status) LIKE '%return%'
          ) AS returned,
          SUM(item_qty) FILTER (
            WHERE cancelled_at IS NULL
              AND returned_at IS NULL
              AND lower(status) NOT LIKE '%cancel%'
              AND lower(status) NOT LIKE '%return%'
          ) AS qty_delivered,
          SUM(item_qty * item_price_rub) FILTER (
            WHERE cancelled_at IS NULL
              AND returned_at IS NULL
              AND lower(status) NOT LIKE '%cancel%'
              AND lower(status) NOT LIKE '%return%'
          ) AS revenue_rub
        FROM order_items
        WHERE offer_id IS NOT NULL AND offer_id <> ''
        GROUP BY offer_id
      )`;

    // Условия JOIN для match_key:
    //  - analytics-api: match_key = ozon SKU → JOIN по unit_products.sku
    //  - orders-fallback: match_key = offer_id → JOIN по unit_products.article
    const ordersJoin = hasAnalyticsData
      ? sql`LEFT JOIN agg_orders ao ON ao.match_key = ${unitProducts.sku}
            LEFT JOIN agg_orders_fb fb ON fb.match_key = ${unitProducts.article}`
      : sql`LEFT JOIN agg_orders ao ON ao.match_key = ${unitProducts.article}`;

    // В analytics-api режиме для basic-tier берём cancellations/returns из fallback;
    // для premium-plus tier в analytics уже актуальные значения (fb берётся через
    // COALESCE как «ноль или больше из ozon_orders»). GREATEST не используем —
    // у premium-plus данных может быть меньше из-за лага sync ozon_orders.
    const cancelledExpr = hasAnalyticsData
      ? sql`COALESCE(NULLIF(ao.cancelled, 0), fb.cancelled, 0)::int`
      : sql`COALESCE(ao.cancelled, 0)::int`;
    const returnedExpr = hasAnalyticsData
      ? sql`COALESCE(NULLIF(ao.returned, 0), fb.returned, 0)::int`
      : sql`COALESCE(ao.returned, 0)::int`;

    const rawResult = await db.execute<Raw>(sql`
      WITH ${ordersCte},
      ${adsCte},
      ${schemeCte},
      ${velocity30Cte}
      SELECT
        ${unitProducts.id}::text AS "productId",
        ${unitProducts.article} AS article,
        ${unitProducts.sku} AS sku,
        ${unitProducts.name} AS name,
        (${unitProducts.metadata}->>'primaryImage') AS primary_image,
        ${unitProducts.stockMarketplace} AS stock_marketplace,
        ${unitProducts.stockOwn} AS stock_own,
        ${unitProducts.priceKopecks} AS price_kopecks,
        ${unitProducts.costKopecks} AS cost_kopecks,
        (${unitProducts.metadata}->>'priceWithSpp')::numeric AS marketing_price_rub,
        (${unitProducts.metadata}->>'turnoverDays')::numeric AS turnover_days_meta,
        COALESCE(ao.delivered, 0)::int AS delivered,
        COALESCE(sch.delivered_fbo, 0)::int AS delivered_fbo,
        COALESCE(sch.delivered_fbs, 0)::int AS delivered_fbs,
        ${cancelledExpr} AS cancelled,
        ${returnedExpr} AS returned,
        COALESCE(ao.qty_delivered, 0) AS qty_delivered,
        COALESCE(v30.qty_30d, 0) AS qty_30d,
        COALESCE(ao.revenue_rub * 100, 0) AS revenue_kopecks,
        COALESCE(ad.ads_kopecks, 0) AS ads_kopecks,
        COALESCE(ad.perf_views, 0) AS perf_views,
        COALESCE(ad.perf_clicks, 0) AS perf_clicks,
        COALESCE(ad.perf_cart_adds, 0) AS perf_cart_adds
      FROM ${unitProducts}
      ${ordersJoin}
      LEFT JOIN agg_scheme sch ON sch.offer_id = ${unitProducts.article}
      LEFT JOIN velocity_30d v30 ON v30.offer_id = ${unitProducts.article}
      LEFT JOIN LATERAL (
        SELECT
          SUM(ad.ads_kopecks) AS ads_kopecks,
          SUM(ad.perf_views) AS perf_views,
          SUM(ad.perf_clicks) AS perf_clicks,
          SUM(ad.perf_cart_adds) AS perf_cart_adds
        FROM agg_ads ad
        WHERE
          -- 5 match-ключей покрывают: новые записи (sku = реальный Ozon SKU),
          -- legacy (sku = product_id), backfilled (metadata.ozonSku), CPC-стейдж
          -- (offer_id и article_raw в raw).
          ad.sku = ${unitProducts.sku}
          OR ad.sku = (${unitProducts.metadata}->>'productId')
          OR ad.sku = (${unitProducts.metadata}->>'ozonSku')
          OR ad.offer_id = ${unitProducts.article}
          OR ad.article_raw = ${unitProducts.article}
      ) ad ON TRUE
      WHERE ${unitProducts.tenantId} = ${session.tenantId}
        AND ${unitProducts.marketplace} = 'ozon'
        ${accountCondUp}
      ORDER BY revenue_kopecks DESC NULLS LAST, name ASC
    `);

    // Drizzle's db.execute может возвращать массив или { rows: [] }.
    const aggregateRows: Raw[] = Array.isArray(rawResult)
      ? (rawResult as Raw[])
      : (((rawResult as unknown) as { rows: Raw[] }).rows ?? []);

    // Сначала собираем CPC per-SKU rows и totalRevenue — это нужно для распределения CPO.
    type Intermediate = {
      productId: string;
      article: string | null;
      sku: string | null;
      name: string;
      primaryImage: string | null;
      stockMarketplace: number;
      stockOwn: number;
      priceRub: number;
      costRub: number;
      delivered: number;
      deliveredFbo: number;
      deliveredFbs: number;
      cancelled: number;
      returned: number;
      qtyDelivered: number;
      revenueRub: number;
      adsCpcRub: number;
      buyoutPct: number | null;
      daysOfStock: number | null;
      daysOfStockOzon: number | null;
      daysOfStockFallback30d: number | null;
      views: number;
      clicks: number;
      cartAdds: number;
    };

    const intermediate: Intermediate[] = aggregateRows.map((r) => {
      const revenueRub = Number(r.revenue_kopecks ?? 0) / 100;
      const adsCpcRub = Number(r.ads_kopecks ?? 0) / 100;
      const delivered = Number(r.delivered ?? 0);
      const cancelled = Number(r.cancelled ?? 0);
      const returned = Number(r.returned ?? 0);
      const totalOrders = delivered + cancelled + returned;
      const buyoutPct = totalOrders >= 5 ? (delivered / totalOrders) * 100 : null;
      const stockTotal = Number(r.stock_marketplace ?? 0) + Number(r.stock_own ?? 0);
      const qtyDelivered = Number(r.qty_delivered ?? 0);
      const velocity = qtyDelivered > 0 ? qtyDelivered / periodDays : 0;
      const daysOfStock =
        velocity > 0 ? Math.round((stockTotal / velocity) * 10) / 10 : null;
      // Ozon Turnover: дни, как считает сам Ozon в Seller-кабинете
      // (`/v1/analytics/turnover/stocks`). Может быть null если sync turnover
      // не запускался или товар не покрыт.
      const daysOfStockOzonRaw = r.turnover_days_meta;
      const daysOfStockOzon =
        daysOfStockOzonRaw !== null && daysOfStockOzonRaw !== undefined
          ? Number(daysOfStockOzonRaw)
          : null;
      // 30-day velocity fallback: на узких окнах (7d) обычно нет продаж →
      // velocity = 0 → daysOfStock = null. Считаем по средней за 30 дней.
      const qty30d = Number(r.qty_30d ?? 0);
      const velocity30d = qty30d > 0 ? qty30d / fallbackWindowDays : 0;
      const daysOfStockFallback30d =
        velocity30d > 0 && stockTotal > 0
          ? Math.round((stockTotal / velocity30d) * 10) / 10
          : null;

      const marketingPrice = Number(r.marketing_price_rub ?? 0);
      const basePrice = Number(r.price_kopecks ?? 0) / 100;
      const priceRub = marketingPrice > 0 ? marketingPrice : basePrice;

      return {
        productId: r.productId,
        article: r.article,
        sku: r.sku,
        name: r.name,
        primaryImage: r.primary_image ?? null,
        stockMarketplace: Number(r.stock_marketplace ?? 0),
        stockOwn: Number(r.stock_own ?? 0),
        priceRub,
        costRub: Number(r.cost_kopecks ?? 0) / 100,
        delivered,
        deliveredFbo: Number(r.delivered_fbo ?? 0),
        deliveredFbs: Number(r.delivered_fbs ?? 0),
        cancelled,
        returned,
        qtyDelivered,
        revenueRub,
        adsCpcRub,
        buyoutPct,
        daysOfStock,
        daysOfStockOzon: Number.isFinite(daysOfStockOzon as number) ? daysOfStockOzon : null,
        daysOfStockFallback30d,
        views: Number(r.perf_views ?? 0),
        clicks: Number(r.perf_clicks ?? 0),
        cartAdds: Number(r.perf_cart_adds ?? 0),
      };
    });

    // Debug-warn: если perf-данные есть, но 0 совпадений по всем 5 ключам —
    // это сигнал, что SKU в unit_products рассинхронизированы с perf_sku_stats.
    // Лечится backfill'ом через drizzle/init/11-marketplaces-sku-backfill.sql.
    if (hasPerfData) {
      const matchedRows = intermediate.filter((r) => r.adsCpcRub > 0).length;
      if (matchedRows === 0 && intermediate.length > 0) {
        try {
          // Сэмпл из 3 perf-sku и 3 unit-products для диагностики.
          type SampleAdsRow = { sku: string };
          const adsSampleResult = await db.execute<SampleAdsRow>(sql`
            SELECT DISTINCT ps.sku FROM ${ozonPerfSkuStats} ps
            WHERE ps.tenant_id = ${session.tenantId}
              ${accountCondPerf}
              AND ps.date >= ${fromDate}::date
              AND ps.date < ${toDateExclusive}::date
            LIMIT 3
          `);
          const adsSample: SampleAdsRow[] = Array.isArray(adsSampleResult)
            ? (adsSampleResult as SampleAdsRow[])
            : (((adsSampleResult as unknown) as { rows: SampleAdsRow[] }).rows ?? []);
          const upSample = intermediate.slice(0, 3).map((r) => ({
            article: r.article,
            sku: r.sku,
            productId: r.productId,
          }));
          console.warn(
            '[ozon-analytics] perf-data present but 0 matches via all 5 keys.',
            'Sample ads.sku:',
            adsSample.map((r) => r.sku),
            'Sample unit_products:',
            upSample,
            '→ Apply drizzle/init/11-marketplaces-sku-backfill.sql to fix.',
          );
        } catch {
          // Diagnostics — best-effort.
        }
      }
    }

    // Распределяем CPO по SKU пропорционально выручке.
    // Если выручки нет (productsWithSales=0) — CPO не разносится (остаётся в totals).
    const totalRevenueForAlloc = intermediate.reduce((s, r) => s + r.revenueRub, 0);
    const hasCpoExpense = cpoTotalRub > 0;

    const rows: OzonAnalyticsRow[] = intermediate.map((r) => {
      const adsCpoAllocRub =
        hasCpoExpense && totalRevenueForAlloc > 0 && r.revenueRub > 0
          ? cpoTotalRub * (r.revenueRub / totalRevenueForAlloc)
          : 0;
      const adsRub = r.adsCpcRub + adsCpoAllocRub;
      const drrPct = r.revenueRub > 0 && adsRub > 0 ? (adsRub / r.revenueRub) * 100 : null;
      return {
        productId: r.productId,
        article: r.article,
        sku: r.sku,
        name: r.name,
        primaryImage: r.primaryImage,
        stockMarketplace: r.stockMarketplace,
        stockOwn: r.stockOwn,
        priceRub: r.priceRub,
        costRub: r.costRub,
        delivered: r.delivered,
        deliveredFbo: r.deliveredFbo,
        deliveredFbs: r.deliveredFbs,
        cancelled: r.cancelled,
        returned: r.returned,
        qtyDelivered: r.qtyDelivered,
        revenueRub: r.revenueRub,
        adsRub,
        adsCpcRub: r.adsCpcRub,
        adsCpoAllocRub,
        adsHasCpo: adsCpoAllocRub > 0,
        drrPct,
        buyoutPct: r.buyoutPct,
        daysOfStock: r.daysOfStock,
        daysOfStockOzon: r.daysOfStockOzon,
        daysOfStockFallback30d: r.daysOfStockFallback30d,
        views: r.views,
        clicks: r.clicks,
        cartAdds: r.cartAdds,
      };
    });

    const totals = rows.reduce(
      (acc, r) => {
        acc.revenueRub += r.revenueRub;
        acc.adsCpcRub += r.adsCpcRub;
        acc.delivered += r.delivered;
        acc.deliveredFbo += r.deliveredFbo;
        acc.deliveredFbs += r.deliveredFbs;
        acc.cancelled += r.cancelled;
        acc.returned += r.returned;
        if (r.revenueRub > 0) acc.productsWithSales += 1;
        return acc;
      },
      {
        revenueRub: 0,
        adsRub: 0,
        adsCpcRub: 0,
        adsCpoRub: 0,
        delivered: 0,
        deliveredFbo: 0,
        deliveredFbs: 0,
        cancelled: 0,
        returned: 0,
        drrPct: null as number | null,
        productsWithSales: 0,
      },
    );
    totals.adsCpoRub = cpoTotalRub;
    totals.adsRub = adsTotals.adsRub;
    totals.drrPct =
      totals.revenueRub > 0 && totals.adsRub > 0
        ? (totals.adsRub / totals.revenueRub) * 100
        : null;

    const payload: OzonAnalyticsResponse = {
      ok: true,
      rows,
      totals,
      period: resolvedPeriod,
      adsSource,
      ordersSource,
      hasCpoExpense,
      reconciliationGapPct: adsTotals.reconciliationGapPct,
      expenseByAdvType: adsTotals.expenseByAdvType,
    };

    // Запись в кэш — best-effort.
    try {
      await getRedis().set(cacheKey, JSON.stringify(payload), 'EX', ANALYTICS_CACHE_TTL_SEC);
    } catch {
      /* ignore */
    }

    return NextResponse.json(payload);
  } catch (e) {
    console.error('[ozon-analytics] GET failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
