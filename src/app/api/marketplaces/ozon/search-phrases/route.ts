// PURPOSE: Топ поисковых фраз Ozon. SUM по ozon_perf_phrases за период.

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { ozonPerfPhrases } from '@/lib/db/schema/marketplaces';

export const runtime = 'nodejs';

export type OzonSearchPhrasesResponse = {
  ok: true;
  rows: Array<{
    phrase: string;
    views: number;
    clicks: number;
    orders: number;
    expenseRub: number;
    ctrPct: number | null;
    cpoRub: number | null;
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
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100)));
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
    const accountCond = accountId ? sql`AND p.account_id = ${accountId}` : sql``;

    type Row = {
      phrase: string;
      views: number;
      clicks: number;
      orders: number;
      expense_kopecks: number;
    };
    const result = await db.execute<Row>(sql`
      SELECT
        p.phrase,
        SUM(p.views) AS views,
        SUM(p.clicks) AS clicks,
        SUM(p.orders) AS orders,
        SUM(p.expense_kopecks) AS expense_kopecks
      FROM ${ozonPerfPhrases} p
      WHERE p.tenant_id = ${session.tenantId}
        ${accountCond}
        AND p.date >= ${fromIso}::date
        AND p.date < ${toIso}::date
      GROUP BY p.phrase
      ORDER BY expense_kopecks DESC NULLS LAST
      LIMIT ${limit}
    `);
    const rows: Row[] = Array.isArray(result)
      ? (result as Row[])
      : (((result as unknown) as { rows: Row[] }).rows ?? []);

    const out = rows.map((r) => {
      const views = Number(r.views ?? 0);
      const clicks = Number(r.clicks ?? 0);
      const orders = Number(r.orders ?? 0);
      const expenseRub = Number(r.expense_kopecks ?? 0) / 100;
      return {
        phrase: r.phrase,
        views,
        clicks,
        orders,
        expenseRub,
        ctrPct: views > 0 ? (clicks / views) * 100 : null,
        cpoRub: orders > 0 ? expenseRub / orders : null,
      };
    });

    return NextResponse.json({ ok: true, rows: out });
  } catch (e) {
    console.error('[marketplaces] GET /ozon/search-phrases failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
