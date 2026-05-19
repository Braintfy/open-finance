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

// Re-export для существующих импортов API-роуты.
export type { OzonAnalyticsRow };

export type OzonAnalyticsResponse = {
  ok: true;
  rows: OzonAnalyticsRow[];
  totals: {
    revenueRub: number;
    adsRub: number;
    delivered: number;
    cancelled: number;
    returned: number;
    drrPct: number | null;
    productsWithSales: number;
  };
  period: { from: string; to: string };
  adsSource: 'performance' | 'transactions-heuristic' | 'none';
  /** Источник данных продаж: 'analytics-api' = ozon_analytics_daily, 'orders-fallback' = ozon_orders. */
  ordersSource: 'analytics-api' | 'orders-fallback';
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

function parseDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : fallback;
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const accountId = url.searchParams.get('accountId');
    const now = new Date();
    const defaultFrom = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    const from = parseDate(url.searchParams.get('from'), defaultFrom);
    const to = parseDate(url.searchParams.get('to'), now);

    if (from >= to) {
      return NextResponse.json(
        { ok: false, error: 'Invalid period: from >= to' },
        { status: 400 },
      );
    }
    // postgres.js не сериализует Date в raw sql-template'ах — передаём ISO-строки.
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const periodDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000)));

    // Redis-кэш: блок аналитики переоткрывается часто, sync переписывает данные
    // максимум раз в час. Ключ зависит от tenant + accountId + период.
    const cacheKey = `analytics:ozon:${session.tenantId}:${accountId ?? 'all'}:${fromIso}:${toIso}`;
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
    const accountCondUp = accountId
      ? sql`AND ${unitProducts.marketplaceAccountId} = ${accountId}`
      : sql``;

    // Определяем источник рекламных данных: perf_sku_stats (primary) → transactions (fallback).
    type AdsCheckRow = { cnt: number };
    const perfCheck = await db.execute<AdsCheckRow>(sql`
      SELECT COUNT(*)::int AS cnt FROM ${ozonPerfSkuStats} ps
      WHERE ps.tenant_id = ${session.tenantId}
        ${accountCondPerf}
        AND ps.date >= ${fromIso}::date
        AND ps.date < ${toIso}::date
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
        AND ad.date >= ${fromIso}::date
        AND ad.date < ${toIso}::date
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
          AND ps.date >= ${fromIso}::date
          AND ps.date < ${toIso}::date
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
          AND tx.operation_date >= ${fromIso}::timestamp
          AND tx.operation_date < ${toIso}::timestamp
          AND tx.sku IS NOT NULL
          AND ${ADS_FILTER_SQL}
        GROUP BY tx.sku
      )`;

    let adsSource: 'performance' | 'transactions-heuristic' | 'none' = hasPerfData
      ? 'performance'
      : 'none';

    type Raw = {
      productId: string;
      article: string | null;
      sku: string | null;
      name: string;
      stock_marketplace: number;
      stock_own: number;
      price_kopecks: number;
      cost_kopecks: number;
      marketing_price_rub: number | string | null;
      delivered: number;
      cancelled: number;
      returned: number;
      qty_delivered: number | string;
      revenue_kopecks: number | string;
      ads_kopecks: number | string;
      perf_views: number | string;
      perf_clicks: number | string;
      perf_cart_adds: number | string;
    };

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
          AND ad.date >= ${fromIso}::date
          AND ad.date < ${toIso}::date
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
          AND o.order_created_at >= ${fromIso}::timestamp
          AND o.order_created_at < ${toIso}::timestamp
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
          AND o.order_created_at >= ${fromIso}::timestamp
          AND o.order_created_at < ${toIso}::timestamp
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
      ${adsCte}
      SELECT
        ${unitProducts.id}::text AS "productId",
        ${unitProducts.article} AS article,
        ${unitProducts.sku} AS sku,
        ${unitProducts.name} AS name,
        ${unitProducts.stockMarketplace} AS stock_marketplace,
        ${unitProducts.stockOwn} AS stock_own,
        ${unitProducts.priceKopecks} AS price_kopecks,
        ${unitProducts.costKopecks} AS cost_kopecks,
        (${unitProducts.metadata}->>'priceWithSpp')::numeric AS marketing_price_rub,
        COALESCE(ao.delivered, 0)::int AS delivered,
        ${cancelledExpr} AS cancelled,
        ${returnedExpr} AS returned,
        COALESCE(ao.qty_delivered, 0) AS qty_delivered,
        COALESCE(ao.revenue_rub * 100, 0) AS revenue_kopecks,
        COALESCE(ad.ads_kopecks, 0) AS ads_kopecks,
        COALESCE(ad.perf_views, 0) AS perf_views,
        COALESCE(ad.perf_clicks, 0) AS perf_clicks,
        COALESCE(ad.perf_cart_adds, 0) AS perf_cart_adds
      FROM ${unitProducts}
      ${ordersJoin}
      LEFT JOIN LATERAL (
        SELECT
          SUM(ad.ads_kopecks) AS ads_kopecks,
          SUM(ad.perf_views) AS perf_views,
          SUM(ad.perf_clicks) AS perf_clicks,
          SUM(ad.perf_cart_adds) AS perf_cart_adds
        FROM agg_ads ad
        WHERE
          ad.sku = ${unitProducts.sku}
          OR ad.sku = (${unitProducts.metadata}->>'productId')
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

    const rows: OzonAnalyticsRow[] = aggregateRows.map((r) => {
      const revenueRub = Number(r.revenue_kopecks ?? 0) / 100;
      const adsRub = Number(r.ads_kopecks ?? 0) / 100;
      const drrPct =
        revenueRub > 0 && adsRub > 0 ? (adsRub / revenueRub) * 100 : null;
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

      const marketingPrice = Number(r.marketing_price_rub ?? 0);
      const basePrice = Number(r.price_kopecks ?? 0) / 100;
      const priceRub = marketingPrice > 0 ? marketingPrice : basePrice;

      return {
        productId: r.productId,
        article: r.article,
        sku: r.sku,
        name: r.name,
        stockMarketplace: Number(r.stock_marketplace ?? 0),
        stockOwn: Number(r.stock_own ?? 0),
        priceRub,
        costRub: Number(r.cost_kopecks ?? 0) / 100,
        delivered,
        cancelled,
        returned,
        qtyDelivered,
        revenueRub,
        adsRub,
        drrPct,
        buyoutPct,
        daysOfStock,
        views: Number(r.perf_views ?? 0),
        clicks: Number(r.perf_clicks ?? 0),
        cartAdds: Number(r.perf_cart_adds ?? 0),
      };
    });

    const totals = rows.reduce(
      (acc, r) => {
        acc.revenueRub += r.revenueRub;
        acc.adsRub += r.adsRub;
        acc.delivered += r.delivered;
        acc.cancelled += r.cancelled;
        acc.returned += r.returned;
        if (r.revenueRub > 0) acc.productsWithSales += 1;
        return acc;
      },
      {
        revenueRub: 0,
        adsRub: 0,
        delivered: 0,
        cancelled: 0,
        returned: 0,
        drrPct: null as number | null,
        productsWithSales: 0,
      },
    );
    totals.drrPct =
      totals.revenueRub > 0 && totals.adsRub > 0
        ? (totals.adsRub / totals.revenueRub) * 100
        : null;

    // Если не perf и есть ads данные → значит из транзакций.
    if (!hasPerfData && totals.adsRub > 0) {
      adsSource = 'transactions-heuristic';
    }

    const payload: OzonAnalyticsResponse = {
      ok: true,
      rows,
      totals,
      period: { from: from.toISOString(), to: to.toISOString() },
      adsSource,
      ordersSource,
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
