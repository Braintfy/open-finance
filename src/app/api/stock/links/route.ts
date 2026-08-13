// PURPOSE: /api/stock/links — сшивка «наш товар ↔ SKU канала» и экран сопоставления.
// GET    ?mode=screen[&includeLinked=1]  → строки канала + автоподбор кандидатов
// GET    [?itemId=&channel=]             → плоский список существующих сшивок
// POST   {links:[…]}                     → сохранить подтверждённые сшивки
// POST   {createItem:{…}}                → завести товар с экрана сопоставления
// DELETE ?id=<uuid>                      → снять сшивку
//
// §10 риск 6: qty_per_unit («3 банки» = 3 базовые единицы) приходит ТОЛЬКО из
// явного подтверждения человека. Автосоздание stock_items из канала запрещено —
// поэтому создание товара это отдельное поле createItem, а не побочный эффект.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTenantRoute } from '@/lib/auth/guards';
import { listStockLinks } from '@/lib/stock/queries';
import {
  createItemFromOffer,
  deleteLink,
  getMatchingScreen,
  saveLinks,
} from '@/lib/stock/import-ozon';
import { stockErrorResponse } from '@/lib/stock/http';

const ChannelSchema = z.enum(['ozon', 'wb', 'yandex', 'site']);

const LinkSchema = z.object({
  itemId: z.string().uuid(),
  channel: ChannelSchema.optional(),
  scopeKey: z.string().max(64).nullable().optional(),
  externalId: z.string().min(1).max(200),
  externalSku: z.string().max(200).nullable().optional(),
  qtyPerUnit: z.number().int().min(1).max(999).optional(),
  unitProductId: z.string().uuid().nullable().optional(),
  accountId: z.string().uuid().nullable().optional(),
  matchSource: z.enum(['manual', 'barcode', 'name', 'sku']).optional(),
  matchConfidence: z.number().int().min(0).max(100).optional(),
});

const BodySchema = z.object({
  links: z.array(LinkSchema).max(1000).optional(),
  createItem: z
    .object({
      sku: z.string().min(1).max(80),
      name: z.string().max(500),
      barcode: z.string().max(200).nullable().optional(),
      brand: z.string().max(120).nullable().optional(),
      category: z.string().max(160).nullable().optional(),
      minQty: z.number().int().min(0).optional(),
      link: LinkSchema.omit({ itemId: true }).optional(),
    })
    .optional(),
});

export async function GET(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };
    const url = new URL(req.url);

    if (url.searchParams.get('mode') === 'screen') {
      const screen = await getMatchingScreen(ctx, {
        includeLinked: url.searchParams.get('includeLinked') === '1',
        limit: Number(url.searchParams.get('limit') ?? 300),
      });
      return NextResponse.json({ ok: true, ...screen });
    }

    const channelRaw = url.searchParams.get('channel');
    const channel = ChannelSchema.safeParse(channelRaw);
    const links = await listStockLinks(ctx, {
      channel: channel.success ? channel.data : undefined,
      itemId: url.searchParams.get('itemId') ?? undefined,
    });
    return NextResponse.json({ ok: true, links });
  } catch (error) {
    return stockErrorResponse('links', error);
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
        { ok: false, error: `Некорректная сшивка: ${parsed.error.issues[0]?.message}` },
        { status: 400 },
      );
    }

    if (parsed.data.createItem) {
      const created = await createItemFromOffer(ctx, parsed.data.createItem);
      return NextResponse.json({ ok: true, ...created });
    }

    const saved = await saveLinks(ctx, parsed.data.links ?? []);
    return NextResponse.json({ ok: true, ...saved });
  } catch (error) {
    return stockErrorResponse('links', error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Не указан id сшивки' }, { status: 400 });
    }
    await deleteLink({ tenantId: t.ctx.tenantId, userId: t.ctx.userId }, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return stockErrorResponse('links', error);
  }
}
