// PURPOSE: Топ товаров по рекламному расходу. JOIN ozon_perf_sku_stats
// с unit_products. Возвращает per-SKU агрегаты за период.

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { ozonPerfSkuStats } from '@/lib/db/schema/marketplaces';
import { unitProducts } from '@/lib/db/schema/unit-economics';

export const runtime = 'nodejs';

export type OzonTopAdsResponse = {
  ok: true;
  rows: Array<{
    sku: string;
    article: string | null;
    name: string | null;
    views: number;
    clicks: number;
    orders: number;
    expenseRub: number;
    ordersRub: number;
    ctrPct: number | null;
    cpcRub: number | null;
    cpoRub: number | null;
    drrPct: number | null;
  }>;
};

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const accountId = url.searchParams.get('accountId');
    const fromStr = url.searchParams.get('from');
    const toStr = url.searchParams.get('to');
    const limitRaw = Number(url.searchParams.get('limit') ?? 50);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 50;
    if (!fromStr || !toStr) {
      return NextResponse.json(
        { ok: false, error: 'from/to required (ISO)' },
        { status: 400 },
      );
    }
    const from = new Date(fromStr);
    const to = new Date(toStr);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      return NextResponse.json({ ok: false, error: 'Invalid date' }, { status: 400 });
    }
    // postgres.js не сериализует Date в raw sql-template'ах — передаём ISO-строки.
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const accountCondPerf = accountId
      ? sql`AND ps.account_id = ${accountId}`
      : sql``;

    type Row = {
      sku: string;
      article: string | null;
      name: string | null;
      views: number;
      clicks: number;
      orders: number;
      expense_kopecks: number;
      orders_kopecks: number;
    };
    const result = await db.execute<Row>(sql`
      WITH agg AS (
        SELECT
          ps.sku,
          SUM(ps.views) AS views,
          SUM(ps.clicks) AS clicks,
          SUM(ps.orders) AS orders,
          SUM(ps.expense_kopecks) AS expense_kopecks,
          SUM(ps.orders_kopecks) AS orders_kopecks
        FROM ${ozonPerfSkuStats} ps
        WHERE ps.tenant_id = ${session.tenantId}
          ${accountCondPerf}
          AND ps.date >= ${fromIso}::date
          AND ps.date < ${toIso}::date
        GROUP BY ps.sku
      )
      SELECT
        agg.sku AS sku,
        up.article AS article,
        up.name AS name,
        agg.views,
        agg.clicks,
        agg.orders,
        agg.expense_kopecks,
        agg.orders_kopecks
      FROM agg
      LEFT JOIN ${unitProducts} up
        ON up.tenant_id = ${session.tenantId}
        AND up.marketplace = 'ozon'
        AND up.sku = agg.sku
      ORDER BY agg.expense_kopecks DESC NULLS LAST
      LIMIT ${limit}
    `);
    const rows: Row[] = Array.isArray(result)
      ? (result as Row[])
      : (((result as unknown) as { rows: Row[] }).rows ?? []);

    const out: OzonTopAdsResponse['rows'] = rows.map((r) => {
      const views = Number(r.views ?? 0);
      const clicks = Number(r.clicks ?? 0);
      const orders = Number(r.orders ?? 0);
      const expenseRub = Number(r.expense_kopecks ?? 0) / 100;
      const ordersRub = Number(r.orders_kopecks ?? 0) / 100;
      return {
        sku: r.sku,
        article: r.article,
        name: r.name,
        views,
        clicks,
        orders,
        expenseRub,
        ordersRub,
        ctrPct: views > 0 ? (clicks / views) * 100 : null,
        cpcRub: clicks > 0 ? expenseRub / clicks : null,
        cpoRub: orders > 0 ? expenseRub / orders : null,
        drrPct: ordersRub > 0 ? (expenseRub / ordersRub) * 100 : null,
      };
    });

    return NextResponse.json({ ok: true, rows: out });
  } catch (e) {
    console.error('[marketplaces] GET /ozon/top-ads failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
