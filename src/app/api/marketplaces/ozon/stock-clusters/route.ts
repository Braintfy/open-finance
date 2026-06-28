// PURPOSE: Агрегация остатков по типам Ozon-склада (FBO/FBS/CrossBorder).
// Берёт `metadata.stockByType` из unit_products (этот массив пишется
// stocks-стейджем синка). На текущей версии Seller API регион / кластер
// в payload не отдаются, поэтому показываем разрез по типу.

import { NextResponse, type NextRequest } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { unitProducts } from '@/lib/db/schema/unit-economics';

export const runtime = 'nodejs';

export type OzonStockClustersResponse = {
  ok: true;
  rows: Array<{
    cluster: string;
    stock: number;
    productCount: number;
    sharePct: number;
  }>;
};

type StockByTypeEntry = {
  type?: string;
  present?: number;
  reserved?: number;
};

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const accountId = url.searchParams.get('accountId');

    const conds = [
      eq(unitProducts.tenantId, session.tenantId),
      eq(unitProducts.marketplace, 'ozon'),
    ];
    if (accountId) conds.push(eq(unitProducts.marketplaceAccountId, accountId));

    const products = await db
      .select({
        id: unitProducts.id,
        metadata: unitProducts.metadata,
      })
      .from(unitProducts)
      .where(and(...conds));

    const byType = new Map<string, { stock: number; productCount: number }>();
    let total = 0;
    for (const p of products) {
      const meta = (p.metadata ?? {}) as Record<string, unknown>;
      const stockByType = meta.stockByType;
      if (!Array.isArray(stockByType)) continue;
      for (const entry of stockByType as StockByTypeEntry[]) {
        const type = (entry.type ?? 'unknown').toString();
        const present = Number(entry.present ?? 0);
        if (present <= 0) continue;
        const existing = byType.get(type) ?? { stock: 0, productCount: 0 };
        existing.stock += present;
        existing.productCount += 1;
        byType.set(type, existing);
        total += present;
      }
    }

    const rows: OzonStockClustersResponse['rows'] = Array.from(byType.entries())
      .map(([cluster, v]) => ({
        cluster: clusterLabel(cluster),
        stock: v.stock,
        productCount: v.productCount,
        sharePct: total > 0 ? (v.stock / total) * 100 : 0,
      }))
      .sort((a, b) => b.stock - a.stock);

    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    console.error('[marketplaces] GET /ozon/stock-clusters failed:', e);
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 },
    );
  }
}

function clusterLabel(type: string): string {
  const t = type.toLowerCase();
  if (t === 'fbo') return 'Склады Ozon (FBO)';
  if (t === 'fbs') return 'Склады продавца (FBS)';
  if (t === 'crossborder') return 'Cross-border';
  return type;
}

// Suppress unused import warning
void sql;
