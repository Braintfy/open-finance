// PURPOSE: GET /api/cashflow/aggregate — агрегация транзакций с фильтрами для blocks
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { and, eq, gte, ilike, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { transactions } from '@/lib/db/schema/transactions';

const Query = z.object({
  metric: z.enum(['income', 'expense', 'balance', 'count']).default('income'),
  period: z.enum(['month', 'quarter', 'year', 'all_time']).default('month'),
  counterparty: z.string().max(200).optional(), // contains (ilike)
  source: z.string().max(200).optional(), // exact match
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const parsed = Query.safeParse({
    metric: url.searchParams.get('metric') ?? undefined,
    period: url.searchParams.get('period') ?? undefined,
    counterparty: url.searchParams.get('counterparty') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Bad query' }, { status: 400 });
  }
  const q = parsed.data;

  const conds = [eq(transactions.tenantId, session.tenantId)];

  // Period
  if (q.period !== 'all_time') {
    const now = new Date();
    let from: Date;
    if (q.period === 'month') from = new Date(now.getFullYear(), now.getMonth(), 1);
    else if (q.period === 'quarter')
      from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    else from = new Date(now.getFullYear(), 0, 1); // year
    conds.push(gte(transactions.occurredAt, from));
  }

  if (q.counterparty) {
    conds.push(ilike(transactions.counterparty, `%${q.counterparty}%`));
  }
  if (q.source) {
    conds.push(eq(transactions.source, q.source));
  }

  // Если metric — income/expense/count — фильтруем тип. balance — оба.
  if (q.metric === 'income' || q.metric === 'expense') {
    conds.push(eq(transactions.type, q.metric));
  }

  const rows = await db
    .select({
      type: transactions.type,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...conds))
    .groupBy(transactions.type);

  const income = rows.find((r) => r.type === 'income');
  const expense = rows.find((r) => r.type === 'expense');
  const incomeTotal = Number(income?.total ?? 0);
  const expenseTotal = Number(expense?.total ?? 0);
  const totalCount = (income?.count ?? 0) + (expense?.count ?? 0);

  let value: number;
  let count: number;
  switch (q.metric) {
    case 'income':
      value = incomeTotal;
      count = income?.count ?? 0;
      break;
    case 'expense':
      value = expenseTotal;
      count = expense?.count ?? 0;
      break;
    case 'balance':
      value = incomeTotal - expenseTotal;
      count = totalCount;
      break;
    case 'count':
      value = totalCount;
      count = totalCount;
      break;
  }

  return NextResponse.json({ ok: true, metric: q.metric, value, count });
}
