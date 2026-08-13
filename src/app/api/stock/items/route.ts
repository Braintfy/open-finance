// PURPOSE: /api/stock/items — номенклатура склада (список, карточка, CRUD).
// GET    ?search=&brand=&includeInactive=1        → список
// GET    ?id=<uuid>                               → карточка товара (остатки, партии, лента)
// POST   {sku,name,…}                             → создать
// PATCH  ?id=<uuid> {…}                           → изменить
// DELETE ?id=<uuid>                               → удалить (только без движений)
//
// tenantId — только из сессии. Канон — docs/STOCK_MODULE_DESIGN.md §2.2.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTenantRoute } from '@/lib/auth/guards';
import { getStockItemCard, listStockItems } from '@/lib/stock/queries';
import { createStockItem, deleteStockItem, updateStockItem } from '@/lib/stock/items';
import { stockErrorResponse } from '@/lib/stock/http';

const ItemSchema = z.object({
  sku: z.string().min(1).max(80),
  name: z.string().max(500).optional(),
  brand: z.string().max(120).nullable().optional(),
  category: z.string().max(160).nullable().optional(),
  unit: z.string().max(16).optional(),
  barcode: z.string().max(200).nullable().optional(),
  expiryControl: z.boolean().optional(),
  shelfLifeDays: z.number().int().nullable().optional(),
  minQty: z.number().int().min(0).optional(),
  costOverrideKopecks: z.number().int().min(0).nullable().optional(),
  isActive: z.boolean().optional(),
  note: z.string().nullable().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };
    const url = new URL(req.url);

    const id = url.searchParams.get('id');
    if (id) {
      const card = await getStockItemCard(ctx, id);
      if (!card) {
        return NextResponse.json({ ok: false, error: 'Товар не найден' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, ...card });
    }

    const items = await listStockItems(ctx, {
      search: url.searchParams.get('search') ?? undefined,
      brand: url.searchParams.get('brand') ?? undefined,
      includeInactive: url.searchParams.get('includeInactive') === '1',
      limit: Number(url.searchParams.get('limit') ?? 500),
    });
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return stockErrorResponse('items', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const parsed = ItemSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: `Некорректный товар: ${parsed.error.issues[0]?.message}` },
        { status: 400 },
      );
    }
    const item = await createStockItem(
      { tenantId: t.ctx.tenantId, userId: t.ctx.userId },
      parsed.data,
    );
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return stockErrorResponse('items', error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Не указан id товара' }, { status: 400 });
    }
    const parsed = ItemSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: `Некорректный товар: ${parsed.error.issues[0]?.message}` },
        { status: 400 },
      );
    }
    const item = await updateStockItem(
      { tenantId: t.ctx.tenantId, userId: t.ctx.userId },
      id,
      parsed.data,
    );
    return NextResponse.json({ ok: true, item });
  } catch (error) {
    return stockErrorResponse('items', error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Не указан id товара' }, { status: 400 });
    }
    await deleteStockItem({ tenantId: t.ctx.tenantId, userId: t.ctx.userId }, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return stockErrorResponse('items', error);
  }
}
