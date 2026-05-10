// PURPOSE: PATCH/DELETE /api/cashflow/transactions/:id — редактирование и удаление
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { transactions } from '@/lib/db/schema/transactions';

const UpdateBody = z.object({
  amount: z.number().int().positive().optional(),
  type: z.enum(['income', 'expense']).optional(),
  description: z.string().max(2000).nullable().optional(),
  counterparty: z.string().max(200).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  occurredAt: z.string().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  let body: z.infer<typeof UpdateBody>;
  try {
    body = UpdateBody.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : 'Invalid body';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.amount !== undefined) updates.amount = body.amount;
  if (body.type !== undefined) updates.type = body.type;
  if (body.description !== undefined) updates.description = body.description;
  if (body.counterparty !== undefined) updates.counterparty = body.counterparty;
  if (body.categoryId !== undefined) updates.categoryId = body.categoryId;
  if (body.occurredAt !== undefined) updates.occurredAt = new Date(body.occurredAt);

  const [tx] = await db
    .update(transactions)
    .set(updates)
    .where(and(eq(transactions.id, id), eq(transactions.tenantId, session.tenantId)))
    .returning();

  if (!tx) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, transaction: tx });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const result = await db
    .delete(transactions)
    .where(and(eq(transactions.id, id), eq(transactions.tenantId, session.tenantId)))
    .returning({ id: transactions.id });

  if (result.length === 0) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
