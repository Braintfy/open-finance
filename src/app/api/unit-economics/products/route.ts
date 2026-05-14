// PURPOSE: API для unit_products — list/create. Tenant-scoped.

import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import {
  listUnitProducts,
  upsertUnitProduct,
} from '@/lib/unit-economics/queries';
import type { UnitMarketplace } from '@/lib/db/schema/unit-economics';

const ALLOWED_MP: UnitMarketplace[] = ['ozon', 'yandex'];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const mp = url.searchParams.get('marketplace');
  const marketplace = mp && (ALLOWED_MP as string[]).includes(mp) ? (mp as UnitMarketplace) : undefined;
  const limit = Number(url.searchParams.get('limit') ?? 200);
  const products = await listUnitProducts({
    tenantId: session.tenantId,
    marketplace,
    limit: Number.isFinite(limit) ? Math.min(500, Math.max(1, limit)) : 200,
  });
  return NextResponse.json({ ok: true, products });
}

export async function POST(req: NextRequest) {
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
}
