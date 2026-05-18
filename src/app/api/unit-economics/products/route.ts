// PURPOSE: API для unit_products — list/create. Tenant-scoped.
// GET ?marketplace=ozon[&accountId=...][&include=aggregates]
//   include=aggregates → JOIN ozon_orders, считаем salesPerMonth (delivered за 30д)
//   и buyoutPct (delivered / (delivered+cancelled+returned)) per article/sku.

import { NextResponse, type NextRequest } from 'next/server';
import { sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import {
  listUnitProducts,
  upsertUnitProduct,
} from '@/lib/unit-economics/queries';
import type { UnitMarketplace } from '@/lib/db/schema/unit-economics';
import { ozonOrders } from '@/lib/db/schema/marketplaces';

const ALLOWED_MP: UnitMarketplace[] = ['ozon', 'yandex'];

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const mp = url.searchParams.get('marketplace');
    const marketplace =
      mp && (ALLOWED_MP as string[]).includes(mp) ? (mp as UnitMarketplace) : undefined;
    const limitRaw = Number(url.searchParams.get('limit') ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 200;
    const accountId = url.searchParams.get('accountId');
    const includeAggregates = url.searchParams.get('include') === 'aggregates';

    // Базовая выборка через существующий helper. accountId уточняет фильтр
    // отдельным запросом, чтобы не плодить специализированных функций.
    let products = await listUnitProducts({
      tenantId: session.tenantId,
      marketplace,
      limit,
    });

    if (accountId) {
      products = products.filter((p) => p.marketplaceAccountId === accountId);
    }

    if (!includeAggregates || marketplace !== 'ozon' || products.length === 0) {
      return NextResponse.json({ ok: true, products });
    }

    // Агрегаты из ozon_orders. Группируем по offer_id (lateral) — в items
    // JSONB лежат массивы; раскрываем через jsonb_array_elements.
    // НИЖЕ: явный tenant_id фильтр в обоих местах — обязательное правило.
    // postgres.js не сериализует Date в raw sql-template'ах — передаём ISO-строки.
    const since30Iso = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const since90Iso = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
    const accountConds = accountId
      ? sql`AND o.account_id = ${accountId}`
      : sql``;
    // Делаем один SQL: по offer_id из items[].offerId считаем delivered за 30 дней
    // и total/cancelled/returned за 90 дней.
    type AggRow = {
      offer_id: string;
      delivered_30d: number;
      delivered_90d: number;
      cancelled_90d: number;
      returned_90d: number;
    };
    const rawResult = await db.execute<AggRow>(sql`
      WITH item_rows AS (
        SELECT
          o.id,
          o.status,
          o.order_created_at,
          o.delivered_at,
          o.cancelled_at,
          o.returned_at,
          (it->>'offerId')::text AS offer_id
        FROM ${ozonOrders} o
        CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
        WHERE o.tenant_id = ${session.tenantId}
          ${accountConds}
          AND o.order_created_at >= ${since90Iso}::timestamp
      )
      SELECT
        offer_id,
        COUNT(*) FILTER (WHERE status = 'delivered' AND order_created_at >= ${since30Iso}::timestamp) AS delivered_30d,
        COUNT(*) FILTER (WHERE status = 'delivered') AS delivered_90d,
        COUNT(*) FILTER (WHERE cancelled_at IS NOT NULL) AS cancelled_90d,
        COUNT(*) FILTER (WHERE returned_at IS NOT NULL) AS returned_90d
      FROM item_rows
      WHERE offer_id IS NOT NULL AND offer_id <> ''
      GROUP BY offer_id
    `);
    // Drizzle's db.execute возвращает разные структуры в зависимости от драйвера:
    // node-postgres → { rows: [...] }, postgres-js → массив напрямую.
    // Поддерживаем обе формы.
    const aggregateRows: AggRow[] = Array.isArray(rawResult)
      ? (rawResult as AggRow[])
      : (((rawResult as unknown) as { rows: AggRow[] }).rows ?? []);

    const aggregatesByArticle = new Map<string, {
      salesPerMonth: number;
      buyoutPct: number | null;
    }>();
    for (const row of aggregateRows) {
      const delivered30 = Number(row.delivered_30d ?? 0);
      const delivered90 = Number(row.delivered_90d ?? 0);
      const cancelled90 = Number(row.cancelled_90d ?? 0);
      const returned90 = Number(row.returned_90d ?? 0);
      const total = delivered90 + cancelled90 + returned90;
      // НЕдостаточно данных — статистика нерепрезентативна, не показываем.
      const buyoutPct = total >= 5 ? (delivered90 / total) * 100 : null;
      aggregatesByArticle.set(row.offer_id, {
        salesPerMonth: delivered30,
        buyoutPct,
      });
    }

    const enriched = products.map((p) => {
      const agg = p.article ? aggregatesByArticle.get(p.article) : undefined;
      return {
        ...p,
        salesPerMonth: agg?.salesPerMonth ?? null,
        buyoutPct: agg?.buyoutPct ?? null,
      };
    });

    return NextResponse.json({ ok: true, products: enriched });
  } catch (e) {
    console.error('[unit-economics] GET /products failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId || !session.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
    const mp = String(body.marketplace ?? '');
    if (!(ALLOWED_MP as string[]).includes(mp)) {
      return NextResponse.json({ ok: false, error: 'Invalid marketplace' }, { status: 400 });
    }
    const product = await upsertUnitProduct({
      tenantId: session.tenantId,
      userId: session.userId,
      marketplace: mp as UnitMarketplace,
      article: typeof body.article === 'string' ? body.article : null,
      sku: typeof body.sku === 'string' ? body.sku : null,
      barcode: typeof body.barcode === 'string' ? body.barcode : null,
      name: typeof body.name === 'string' ? body.name : '',
      status: typeof body.status === 'string' ? body.status : null,
      visibility: typeof body.visibility === 'string' ? body.visibility : null,
      stockMarketplace: typeof body.stockMarketplace === 'number' ? body.stockMarketplace : 0,
      stockOwn: typeof body.stockOwn === 'number' ? body.stockOwn : 0,
      priceKopecks: typeof body.priceKopecks === 'number' ? body.priceKopecks : 0,
      costKopecks: typeof body.costKopecks === 'number' ? body.costKopecks : 0,
      volumeL: typeof body.volumeL === 'number' ? Math.round(body.volumeL * 100) : 0,
      metadata: (body.metadata && typeof body.metadata === 'object'
        ? (body.metadata as Record<string, unknown>)
        : {}),
    });
    return NextResponse.json({ ok: true, product });
  } catch (e) {
    console.error('[unit-economics] POST /products failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
