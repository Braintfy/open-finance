// PURPOSE: /api/stock/import — перенос пользователя с бумаги (§8 шаги 1 и 4).
// GET  ?mode=ozon      → превью «что даст импорт номенклатуры из Ozon»
// GET  ?mode=opening   → шаблон стартового документа с подсказками цен
// POST {unitProductIds, qtyPerUnit?} → выполнить импорт по ЯВНОМУ списку
//
// Автосоздание номенклатуры из канала запрещено (§10 риск 6): POST без
// unitProductIds ничего не делает, «импортировать всё молча» здесь нельзя.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTenantRoute } from '@/lib/auth/guards';
import { ensureStockSetup } from '@/lib/stock/queries';
import {
  getOpeningTemplate,
  previewOzonImport,
  runOzonImport,
} from '@/lib/stock/import-ozon';
import { stockErrorResponse } from '@/lib/stock/http';

const BodySchema = z.object({
  unitProductIds: z.array(z.string().uuid()).min(1).max(2000),
  qtyPerUnit: z.record(z.string(), z.number().int().min(1).max(999)).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };
    const mode = new URL(req.url).searchParams.get('mode') ?? 'ozon';

    if (mode === 'opening') {
      const template = await getOpeningTemplate(ctx);
      return NextResponse.json({ ok: true, ...template });
    }

    const preview = await previewOzonImport(ctx);
    return NextResponse.json({ ok: true, ...preview });
  } catch (error) {
    return stockErrorResponse('import', error);
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
        {
          ok: false,
          error:
            'Нужен явный список карточек для импорта: автосоздание номенклатуры из канала запрещено (§10 риск 6)',
        },
        { status: 400 },
      );
    }

    // Импортированные товары сразу попадут в блок остатков — местам надо быть.
    await ensureStockSetup(ctx);
    const result = await runOzonImport(ctx, parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return stockErrorResponse('import', error);
  }
}
