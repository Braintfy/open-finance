// PURPOSE: GET /api/cashflow/summary — суммарный баланс + топ-категории за период
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getCashflowSummary, getTopCategories } from '@/lib/cashflow/queries';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const fromStr = url.searchParams.get('from');
  const toStr = url.searchParams.get('to');
  const from = fromStr ? new Date(fromStr) : undefined;
  const to = toStr ? new Date(toStr) : undefined;

  const [summary, topIncome, topExpense] = await Promise.all([
    getCashflowSummary(session.tenantId, from, to),
    getTopCategories(session.tenantId, 'income', 5),
    getTopCategories(session.tenantId, 'expense', 5),
  ]);

  return NextResponse.json({ ok: true, summary, topIncome, topExpense });
}
