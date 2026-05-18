// PURPOSE: Ozon-аналитика per-product. Для каждого товара —
// выручка, заказы, возвраты, расходы на рекламу, ДРР, остаток за выбранный
// период. tenant-scoped, joins из ozon_orders + ozon_transactions через
// unit_products как «спин».

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { unitProducts } from '@/lib/db/schema/unit-economics';
import { ozonOrders, ozonTransactions } from '@/lib/db/schema/marketplaces';
import type { OzonAnalyticsRow } from '@/lib/blocks/catalog/unit-ozon-analytics-types';

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
};

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

    const accountCondOrders = accountId ? sql`AND o.account_id = ${accountId}` : sql``;
    const accountCondTx = accountId ? sql`AND tx.account_id = ${accountId}` : sql``;
    const accountCondUp = accountId
      ? sql`AND ${unitProducts.marketplaceAccountId} = ${accountId}`
      : sql``;

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
    };

    const rawResult = await db.execute<Raw>(sql`
      WITH order_items AS (
        SELECT
          o.id,
          o.status,
          o.order_created_at,
          o.delivered_at,
          o.cancelled_at,
          o.returned_at,
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
          offer_id,
          COUNT(DISTINCT id) FILTER (WHERE status = 'delivered') AS delivered,
          COUNT(DISTINCT id) FILTER (WHERE cancelled_at IS NOT NULL) AS cancelled,
          COUNT(DISTINCT id) FILTER (WHERE returned_at IS NOT NULL) AS returned,
          SUM(item_qty) FILTER (WHERE status = 'delivered') AS qty_delivered,
          SUM(item_qty * item_price_rub) FILTER (WHERE status = 'delivered') AS revenue_rub
        FROM order_items
        WHERE offer_id IS NOT NULL AND offer_id <> ''
        GROUP BY offer_id
      ),
      agg_ads AS (
        SELECT
          tx.sku,
          SUM(ABS(tx.amount_kopecks)) AS ads_kopecks
        FROM ${ozonTransactions} tx
        WHERE tx.tenant_id = ${session.tenantId}
          ${accountCondTx}
          AND tx.operation_date >= ${fromIso}::timestamp
          AND tx.operation_date < ${toIso}::timestamp
          AND tx.sku IS NOT NULL
          AND ${ADS_FILTER_SQL}
        GROUP BY tx.sku
      )
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
        COALESCE(ao.cancelled, 0)::int AS cancelled,
        COALESCE(ao.returned, 0)::int AS returned,
        COALESCE(ao.qty_delivered, 0) AS qty_delivered,
        COALESCE(ao.revenue_rub * 100, 0) AS revenue_kopecks,
        COALESCE(ad.ads_kopecks, 0) AS ads_kopecks
      FROM ${unitProducts}
      LEFT JOIN agg_orders ao ON ao.offer_id = ${unitProducts.article}
      LEFT JOIN agg_ads ad ON ad.sku = ${unitProducts.sku}
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

    return NextResponse.json({
      ok: true,
      rows,
      totals,
      period: { from: from.toISOString(), to: to.toISOString() },
    } satisfies OzonAnalyticsResponse);
  } catch (e) {
    console.error('[ozon-analytics] GET failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
