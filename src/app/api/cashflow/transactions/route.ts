// PURPOSE: GET/POST /api/cashflow/transactions — список и создание транзакций
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { transactions } from '@/lib/db/schema/transactions';
import { listTransactions, ensureDefaultCategories } from '@/lib/cashflow/queries';

const CreateBody = z.object({
  amount: z.number().int().positive('Сумма должна быть положительной (в копейках)'),
  type: z.enum(['income', 'expense']),
  description: z.string().max(2000).optional(),
  counterparty: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  occurredAt: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  source: z.enum(['manual', 'ozon', 'wb', 'bank', 'inbox']).default('manual'),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const type = url.searchParams.get('type') as 'income' | 'expense' | null;
  const limit = Number(url.searchParams.get('limit') ?? '100');
  const offset = Number(url.searchParams.get('offset') ?? '0');
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');

  const items = await listTransactions({
    tenantId: session.tenantId,
    type: type ?? undefined,
    limit,
    offset,
    from: fromStr ? new Date(fromStr) : undefined,
    to: toStr ? new Date(toStr) : undefined,
  });

  return NextResponse.json({ ok: true, items });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let parsed: z.infer<typeof CreateBody>;
  try {
    parsed = CreateBody.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : 'Некорректный запрос';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  // Авто-создание дефолтных категорий при первой транзакции
  await ensureDefaultCategories(session.tenantId);

  const [tx] = await db
    .insert(transactions)
    .values({
      tenantId: session.tenantId,
      amount: parsed.amount,
      type: parsed.type,
      description: parsed.description ?? null,
      counterparty: parsed.counterparty ?? null,
      categoryId: parsed.categoryId ?? null,
      source: parsed.source,
      occurredAt: new Date(parsed.occurredAt),
    })
    .returning();

  return NextResponse.json({ ok: true, transaction: tx });
}

// DELETE /api/cashflow/transactions?confirm=true — удалить все транзакции текущего tenant
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  if (url.searchParams.get('confirm') !== 'true') {
    return NextResponse.json(
      { ok: false, error: 'Передайте ?confirm=true для подтверждения массового удаления' },
      { status: 400 }
    );
  }
  const result = await db
    .delete(transactions)
    .where(eq(transactions.tenantId, session.tenantId))
    .returning({ id: transactions.id });
  return NextResponse.json({ ok: true, deleted: result.length });
}
