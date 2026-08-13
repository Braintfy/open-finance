// PURPOSE: /api/stock/writeback — диалог «Перевести себестоимость на склад» (§6.1).
// GET  [?itemIds=a,b]                       → превью «было ₽ / станет ₽ / Δ%»
// POST {unitProductIds, source}             → переключить cost_source (+writeback)
// POST {apply:true[, itemIds]}              → прогнать writeback по 'inventory'
//
// БЕЗ этого экрана дефолт cost_source='manual' означает, что после всей работы
// аналитика продолжит показывать старые ручные цифры и рычаг не сработает.
// Границу с синком Ozon (количества — не наши) держит src/lib/stock/writeback.ts.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTenantRoute } from '@/lib/auth/guards';
import {
  applyCostWriteback,
  previewCostWriteback,
  setCostSource,
} from '@/lib/stock/writeback';
import { stockErrorResponse } from '@/lib/stock/http';

const BodySchema = z.union([
  z.object({
    unitProductIds: z.array(z.string().uuid()).min(1).max(5000),
    source: z.enum(['manual', 'inventory']),
  }),
  z.object({
    apply: z.literal(true),
    itemIds: z.array(z.string().uuid()).max(5000).optional(),
  }),
]);

export async function GET(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };
    const raw = new URL(req.url).searchParams.get('itemIds');
    const itemIds = raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

    const preview = await previewCostWriteback(ctx, { itemIds });
    return NextResponse.json({ ok: true, ...preview });
  } catch (error) {
    return stockErrorResponse('writeback', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };

    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: 'Ожидается {unitProductIds, source} или {apply:true}' },
        { status: 400 },
      );
    }

    if ('apply' in parsed.data) {
      const result = await applyCostWriteback(ctx, undefined, parsed.data.itemIds);
      return NextResponse.json({ ok: true, ...result });
    }

    const result = await setCostSource(ctx, parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return stockErrorResponse('writeback', error);
  }
}
