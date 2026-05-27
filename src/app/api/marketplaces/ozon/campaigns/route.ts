// PURPOSE: Список рекламных кампаний из ozon_perf_campaigns + агрегаты
// расхода/заказов из ozon_perf_sku_stats за период.

import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  ozonPerfCampaigns,
  ozonPerfSkuStats,
} from '@/lib/db/schema/marketplaces';

export const runtime = 'nodejs';

export type OzonCampaignsResponse = {
  ok: true;
  rows: Array<{
    campaignId: string;
    title: string | null;
    state: string | null;
    advObjectType: string | null;
    paymentType: string | null;
    startDate: string | null;
    endDate: string | null;
    dailyBudgetRub: number | null;
    budgetRub: number | null;
    expenseRub: number;
    orders: number;
    ordersRub: number;
    views: number;
    clicks: number;
    cartAdds: number;
    drrPct: number | null;
    ctrPct: number | null;
    cpcRub: number | null;
  }>;
  /** Суммарный расход / ордера по всем perf_sku_stats за период (включая campaign_id=null). */
  summary: {
    expenseRub: number;
    orders: number;
    ordersRub: number;
    drrPct: number | null;
    /** True если у кампаний нет распределения stats per campaignId
     *  (Ozon Performance API не разбил отчёт по кампаниям). */
    statsAreAccountWide: boolean;
  };
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
    if (!fromStr || !toStr) {
      return NextResponse.json({ ok: false, error: 'from/to required' }, { status: 400 });
    }
    const from = new Date(fromStr);
    const to = new Date(toStr);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
      return NextResponse.json({ ok: false, error: 'Invalid date' }, { status: 400 });
    }
    // postgres.js не сериализует Date в raw sql-template'ах — передаём ISO-строки.
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    const accountCondStats = accountId
      ? sql`AND s.account_id = ${accountId}`
      : sql``;

    // Кампании из текущего состояния (raw).
    const campaignConds = [eq(ozonPerfCampaigns.tenantId, session.tenantId)];
    if (accountId) campaignConds.push(eq(ozonPerfCampaigns.accountId, accountId));
    const campaigns = await db
      .select()
      .from(ozonPerfCampaigns)
      .where(and(...campaignConds));

    // Per-campaign агрегаты — могут быть пустыми, если sync не разбивал
    // отчёт по кампаниям (campaign_id=null в stats).
    type AggRow = {
      campaign_id: string;
      expense_kopecks: number;
      orders: number;
      orders_kopecks: number;
      views: number;
      clicks: number;
      cart_adds: number;
    };
    const aggResult = await db.execute<AggRow>(sql`
      SELECT
        s.campaign_id,
        SUM(s.expense_kopecks) AS expense_kopecks,
        SUM(s.orders) AS orders,
        SUM(s.orders_kopecks) AS orders_kopecks,
        SUM(s.views) AS views,
        SUM(s.clicks) AS clicks,
        SUM(s.cart_adds) AS cart_adds
      FROM ${ozonPerfSkuStats} s
      WHERE s.tenant_id = ${session.tenantId}
        ${accountCondStats}
        AND s.date >= ${fromIso}::date
        AND s.date < ${toIso}::date
        AND s.campaign_id IS NOT NULL
      GROUP BY s.campaign_id
    `);
    const aggRows: AggRow[] = Array.isArray(aggResult)
      ? (aggResult as AggRow[])
      : (((aggResult as unknown) as { rows: AggRow[] }).rows ?? []);
    const aggByCampaign = new Map(
      aggRows.map((a) => [
        String(a.campaign_id),
        {
          expense_kopecks: Number(a.expense_kopecks ?? 0),
          orders: Number(a.orders ?? 0),
          orders_kopecks: Number(a.orders_kopecks ?? 0),
          views: Number(a.views ?? 0),
          clicks: Number(a.clicks ?? 0),
          cart_adds: Number(a.cart_adds ?? 0),
        },
      ]),
    );

    // Account-wide totals (включая строки с campaign_id=null) — нужны как
    // fallback и для summary, если Ozon отчёт пришёл без campaign_id.
    type TotalRow = {
      expense_kopecks: number;
      orders: number;
      orders_kopecks: number;
    };
    const totalResult = await db.execute<TotalRow>(sql`
      SELECT
        COALESCE(SUM(s.expense_kopecks), 0) AS expense_kopecks,
        COALESCE(SUM(s.orders), 0) AS orders,
        COALESCE(SUM(s.orders_kopecks), 0) AS orders_kopecks
      FROM ${ozonPerfSkuStats} s
      WHERE s.tenant_id = ${session.tenantId}
        ${accountCondStats}
        AND s.date >= ${fromIso}::date
        AND s.date < ${toIso}::date
    `);
    const totals: TotalRow[] = Array.isArray(totalResult)
      ? (totalResult as TotalRow[])
      : (((totalResult as unknown) as { rows: TotalRow[] }).rows ?? []);
    const totalAgg = totals[0] ?? { expense_kopecks: 0, orders: 0, orders_kopecks: 0 };
    const summaryExpenseRub = Number(totalAgg.expense_kopecks ?? 0) / 100;
    const summaryOrders = Number(totalAgg.orders ?? 0);
    const summaryOrdersRub = Number(totalAgg.orders_kopecks ?? 0) / 100;
    const statsAreAccountWide = aggByCampaign.size === 0 && summaryExpenseRub > 0;

    const rows: OzonCampaignsResponse['rows'] = campaigns.map((c) => {
      const agg = aggByCampaign.get(c.campaignId);
      const expenseRub = (agg?.expense_kopecks ?? 0) / 100;
      const ordersRub = (agg?.orders_kopecks ?? 0) / 100;
      const views = agg?.views ?? 0;
      const clicks = agg?.clicks ?? 0;
      return {
        campaignId: c.campaignId,
        title: c.title,
        state: c.state,
        advObjectType: c.advObjectType,
        paymentType: c.paymentType,
        startDate: c.startDate ?? null,
        endDate: c.endDate ?? null,
        dailyBudgetRub: c.dailyBudgetKopecks ? c.dailyBudgetKopecks / 100 : null,
        budgetRub: c.budgetKopecks ? c.budgetKopecks / 100 : null,
        expenseRub,
        orders: agg?.orders ?? 0,
        ordersRub,
        views,
        clicks,
        cartAdds: agg?.cart_adds ?? 0,
        drrPct: ordersRub > 0 ? (expenseRub / ordersRub) * 100 : null,
        ctrPct: views > 0 ? (clicks / views) * 100 : null,
        cpcRub: clicks > 0 ? expenseRub / clicks : null,
      };
    });

    rows.sort((a, b) => b.expenseRub - a.expenseRub);
    return NextResponse.json({
      ok: true,
      rows,
      summary: {
        expenseRub: summaryExpenseRub,
        orders: summaryOrders,
        ordersRub: summaryOrdersRub,
        drrPct: summaryOrdersRub > 0 ? (summaryExpenseRub / summaryOrdersRub) * 100 : null,
        statsAreAccountWide,
      },
    } satisfies OzonCampaignsResponse);
  } catch (e) {
    console.error('[marketplaces] GET /ozon/campaigns failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
