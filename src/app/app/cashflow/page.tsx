// PURPOSE: Главная страница Cashflow модуля (Block-Grid)
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import {
  getCashflowSummary,
  getTopCategories,
  listTransactions,
} from '@/lib/cashflow/queries';
import { loadLayout } from '@/lib/blocks/queries';
import { CashflowClient } from './cashflow-client';

export default async function CashflowPage() {
  const session = await auth();
  if (!session?.tenantId || !session.userId) redirect('/login');

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [summary, topIncome, topExpense, recent, layout] = await Promise.all([
    getCashflowSummary(session.tenantId, monthStart),
    getTopCategories(session.tenantId, 'income', 5),
    getTopCategories(session.tenantId, 'expense', 5),
    listTransactions({ tenantId: session.tenantId, limit: 50 }),
    loadLayout({
      tenantId: session.tenantId,
      userId: session.userId,
      pageKey: 'cashflow',
    }),
  ]);

  return (
    <CashflowClient
      tenantId={session.tenantId}
      initialBlocks={layout.blocks}
      summary={summary}
      topIncome={topIncome}
      topExpense={topExpense}
      initialTransactions={recent.map((t) => ({
        id: t.id,
        amount: t.amount,
        type: t.type as 'income' | 'expense',
        description: t.description,
        counterparty: t.counterparty,
        occurredAt: t.occurredAt.toISOString(),
        source: t.source,
      }))}
    />
  );
}
