// PURPOSE: /api/stock/docs — журнал документов склада и работа с ними.
// GET    ?kind=&status=&from=&to=&search=   → лента + «закуплено за период»
// GET    ?id=<uuid>                         → документ со строками
// GET    ?suppliers=1                       → автокомплит поставщиков
// POST   {…, post:true}                     → создать черновик (и сразу провести)
// POST   {id, action:'post'|'void'}         → провести / сторнировать
// PATCH  ?id=<uuid>                         → переписать черновик
// DELETE ?id=<uuid>                         → удалить ЧЕРНОВИК (§1.4)
//
// Инварианты, которые держит именно этот файл:
//   • DELETE проходит только для draft — проверка в deleteDraftDoc, здесь она
//     не дублируется, чтобы не разъехались два условия;
//   • проводка в закрытый период отдаёт 403 с готовым текстом (§4.7) —
//     это делает StockError, роут его только транслирует.

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTenantRoute } from '@/lib/auth/guards';
import { getStockDoc, listStockDocs, listSuppliers } from '@/lib/stock/queries';
import {
  createDraftDoc,
  deleteDraftDoc,
  postDoc,
  updateDraftDoc,
  voidDoc,
  type DocPayload,
} from '@/lib/stock/posting';
import { stockErrorResponse } from '@/lib/stock/http';

const KindSchema = z.enum([
  'opening',
  'purchase',
  'transfer',
  'accept',
  'writeoff',
  'adjust',
  'return_in',
  'regrade',
]);
const StatusSchema = z.enum(['draft', 'posted', 'void']);
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'ожидается дата YYYY-MM-DD');

const LineSchema = z.object({
  itemId: z.string().uuid(),
  direction: z.enum(['in', 'out']).optional(),
  qty: z.number().int().min(1),
  unitPriceKopecks: z.number().int().min(0).optional(),
  vatRateBp: z.number().int().min(0).max(10000).optional(),
  batchNumber: z.string().max(64).nullable().optional(),
  expiresAt: DateSchema.nullable().optional(),
  isEstimated: z.boolean().optional(),
  countedQty: z.number().int().nullable().optional(),
  comment: z.string().nullable().optional(),
});

const DocSchema = z.object({
  kind: KindSchema,
  docDate: DateSchema,
  supplier: z.string().max(200).optional(),
  supplierInn: z.string().max(12).nullable().optional(),
  docNumber: z.string().max(80).nullable().optional(),
  fromPlaceCode: z.string().max(40).nullable().optional(),
  toPlaceCode: z.string().max(40).nullable().optional(),
  priceIncludesVat: z.boolean().optional(),
  costBasis: z.enum(['gross', 'net']).optional(),
  extraCostKopecks: z.number().int().min(0).optional(),
  extraAlloc: z.enum(['by_value', 'by_qty', 'none']).optional(),
  reason: z
    .enum(['expired', 'damaged', 'lost', 'sample', 'mp_shortage', 'recount'])
    .nullable()
    .optional(),
  source: z.string().max(32).optional(),
  sourceRef: z.string().max(200).nullable().optional(),
  comment: z.string().nullable().optional(),
  lines: z.array(LineSchema).min(1).max(1000),
  /** Провести сразу после создания (обычный сценарий «Новая поставка», §5). */
  post: z.boolean().optional(),
});

const ActionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['post', 'void']),
});

export async function GET(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };
    const url = new URL(req.url);

    if (url.searchParams.get('suppliers') === '1') {
      return NextResponse.json({ ok: true, suppliers: await listSuppliers(ctx) });
    }

    const id = url.searchParams.get('id');
    if (id) {
      const doc = await getStockDoc(ctx, id);
      if (!doc) {
        return NextResponse.json({ ok: false, error: 'Документ не найден' }, { status: 404 });
      }
      return NextResponse.json({ ok: true, ...doc });
    }

    const kind = KindSchema.safeParse(url.searchParams.get('kind'));
    const status = StatusSchema.safeParse(url.searchParams.get('status'));
    const from = DateSchema.safeParse(url.searchParams.get('from'));
    const to = DateSchema.safeParse(url.searchParams.get('to'));

    const result = await listStockDocs(ctx, {
      kind: kind.success ? kind.data : undefined,
      status: status.success ? status.data : undefined,
      from: from.success ? from.data : undefined,
      to: to.success ? to.data : undefined,
      search: url.searchParams.get('search') ?? undefined,
      limit: Number(url.searchParams.get('limit') ?? 100),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return stockErrorResponse('docs', error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const ctx = { tenantId: t.ctx.tenantId, userId: t.ctx.userId };
    const body = await req.json();

    const action = ActionSchema.safeParse(body);
    if (action.success) {
      const result =
        action.data.action === 'post'
          ? await postDoc(ctx, action.data.id)
          : await voidDoc(ctx, action.data.id);
      return NextResponse.json({ ok: true, ...result });
    }

    const parsed = DocSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: `Некорректный документ: ${parsed.error.issues[0]?.message}` },
        { status: 400 },
      );
    }

    const { post, ...payload } = parsed.data;
    const created = await createDraftDoc(ctx, payload as DocPayload);
    if (!post) return NextResponse.json({ ok: true, ...created, status: 'draft' });

    const posted = await postDoc(ctx, created.docId);
    return NextResponse.json({ ok: true, ...created, status: 'posted', ...posted });
  } catch (error) {
    return stockErrorResponse('docs', error);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Не указан id документа' }, { status: 400 });
    }
    const parsed = DocSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: `Некорректный документ: ${parsed.error.issues[0]?.message}` },
        { status: 400 },
      );
    }
    // Поле `post` в PATCH игнорируется намеренно (updateDraftDoc его не читает):
    // правка черновика и его проводка — два разных действия, иначе «Сохранить»
    // незаметно провело бы документ и создало движения.
    const updated = await updateDraftDoc(
      { tenantId: t.ctx.tenantId, userId: t.ctx.userId },
      id,
      parsed.data as DocPayload,
    );
    return NextResponse.json({ ok: true, ...updated });
  } catch (error) {
    return stockErrorResponse('docs', error);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const t = await requireTenantRoute();
    if (!t.ok) return t.response;
    const id = new URL(req.url).searchParams.get('id');
    if (!id) {
      return NextResponse.json({ ok: false, error: 'Не указан id документа' }, { status: 400 });
    }
    await deleteDraftDoc({ tenantId: t.ctx.tenantId, userId: t.ctx.userId }, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return stockErrorResponse('docs', error);
  }
}
