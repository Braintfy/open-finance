// PURPOSE: GET/PATCH /api/stock/settings — настройки модуля «Склад» и справочник мест.
// GET дополнительно СИДИТ раздел (девять встроенных мест + строка настроек) —
// это и есть «первый вход в раздел» из docs/STOCK_MODULE_DESIGN.md §2.1.
//
// tenantId — только из сессии (requireTenantRoute), никогда из тела запроса.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTenantRoute } from '@/lib/auth/guards';
import { ensureStockSetup, updateStockSettings } from '@/lib/stock/queries';
import { stockErrorResponse } from '@/lib/stock/http';

export async function GET() {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };
    const { places, settings } = await ensureStockSetup(ctx);
    return NextResponse.json({ ok: true, places, settings });
  } catch (error) {
    return stockErrorResponse('settings', error);
  }
}

const PatchSchema = z.object({
  costingMode: z.enum(['avg', 'fifo']).optional(),
  lotPolicy: z.enum(['fifo', 'fefo']).optional(),
  /**
   * §12.2: меняет ТОЛЬКО дефолт для новых поступлений. Исторические партии
   * остаются в своём базисе — UI обязан предупредить словами.
   */
  costBasis: z.enum(['gross', 'net']).optional(),
  ledgerStartDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  lockedThrough: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  allowNegative: z.boolean().optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };

    const parsed = PatchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: `Некорректные настройки: ${parsed.error.issues[0]?.message}` },
        { status: 400 },
      );
    }

    const settings = await updateStockSettings(ctx, parsed.data);
    return NextResponse.json({ ok: true, settings });
  } catch (error) {
    return stockErrorResponse('settings', error);
  }
}
