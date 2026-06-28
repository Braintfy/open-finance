// PURPOSE: ABC-анализ выручки Ozon. Группа A — 80% выручки, B — 15%, C — 5%.

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { ozonOrders } from '@/lib/db/schema/marketplaces';
import { unitProducts } from '@/lib/db/schema/unit-economics';

export const runtime = 'nodejs';

export type OzonAbcResponse = {
  ok: true;
  groups: Array<{
    label: 'A' | 'B' | 'C';
    threshold: number;
    revenueRub: number;
    productCount: number;
    sharePct: number;
  }>;
  rows: Array<{
    offerId: string;
    name: string | null;
    revenueRub: number;
    cumulativeSharePct: number;
    group: 'A' | 'B' | 'C';
  }>;
  totalRevenueRub: number;
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

    const accountCond = accountId ? sql`AND o.account_id = ${accountId}` : sql``;

    type Row = { offer_id: string; revenue: number };
    const result = await db.execute<Row>(sql`
      WITH order_items AS (
        SELECT
          (it->>'offerId')::text AS offer_id,
          COALESCE(NULLIF(it->>'price', '')::numeric, 0) AS price_rub,
          COALESCE(NULLIF(it->>'quantity', '')::numeric, 0) AS qty
        FROM ${ozonOrders} o
        CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
        WHERE o.tenant_id = ${session.tenantId}
          ${accountCond}
          AND o.order_created_at >= ${fromIso}::timestamp
          AND o.order_created_at < ${toIso}::timestamp
          AND o.status = 'delivered'
      )
      SELECT
        offer_id,
        SUM(price_rub * qty) AS revenue
      FROM order_items
      WHERE offer_id IS NOT NULL AND offer_id <> ''
      GROUP BY offer_id
      ORDER BY revenue DESC NULLS LAST
    `);
    const rawRows: Row[] = Array.isArray(result)
      ? (result as Row[])
      : (((result as unknown) as { rows: Row[] }).rows ?? []);
    const ranked = rawRows
      .map((r) => ({ offer_id: r.offer_id, revenue: Number(r.revenue ?? 0) }))
      .filter((r) => r.revenue > 0);

    // JOIN с unit_products чтобы получить name.
    const nameConds = accountId
      ? sql`AND up.marketplace_account_id = ${accountId}`
      : sql``;
    type NameRow = { article: string; name: string | null };
    const nameResult = await db.execute<NameRow>(sql`
      SELECT up.article, up.name
      FROM ${unitProducts} up
      WHERE up.tenant_id = ${session.tenantId}
        AND up.marketplace = 'ozon'
        ${nameConds}
    `);
    const nameRows: NameRow[] = Array.isArray(nameResult)
      ? (nameResult as NameRow[])
      : (((nameResult as unknown) as { rows: NameRow[] }).rows ?? []);
    const nameByArticle = new Map(nameRows.map((n) => [n.article, n.name]));

    const totalRevenue = ranked.reduce((s, r) => s + r.revenue, 0);
    let cumulative = 0;
    const rows = ranked.map((r) => {
      cumulative += r.revenue;
      const share = totalRevenue > 0 ? (cumulative / totalRevenue) * 100 : 0;
      const group: 'A' | 'B' | 'C' = share <= 80 ? 'A' : share <= 95 ? 'B' : 'C';
      return {
        offerId: r.offer_id,
        name: nameByArticle.get(r.offer_id) ?? null,
        revenueRub: r.revenue,
        cumulativeSharePct: share,
        group,
      };
    });

    const groups: OzonAbcResponse['groups'] = [
      {
        label: 'A',
        threshold: 80,
        revenueRub: 0,
        productCount: 0,
        sharePct: 0,
      },
      {
        label: 'B',
        threshold: 95,
        revenueRub: 0,
        productCount: 0,
        sharePct: 0,
      },
      {
        label: 'C',
        threshold: 100,
        revenueRub: 0,
        productCount: 0,
        sharePct: 0,
      },
    ];
    for (const r of rows) {
      const g = groups.find((x) => x.label === r.group);
      if (g) {
        g.revenueRub += r.revenueRub;
        g.productCount += 1;
      }
    }
    for (const g of groups) g.sharePct = totalRevenue > 0 ? (g.revenueRub / totalRevenue) * 100 : 0;

    return NextResponse.json({
      ok: true,
      groups,
      rows,
      totalRevenueRub: totalRevenue,
    });
  } catch (e) {
    console.error('[marketplaces] GET /ozon/abc failed:', e);
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}
