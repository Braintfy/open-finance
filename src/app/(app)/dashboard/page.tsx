// PURPOSE: Главный экран дашборда — Block-Grid
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  getCashflowSummary,
  getTopCategories,
  listTransactions,
} from '@/lib/cashflow/queries';
import { loadLayout } from '@/lib/blocks/queries';
import { DashboardClient } from './dashboard-client';

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.userId) redirect('/login');

  let tenant: typeof tenants.$inferSelect | undefined;
  if (session.tenantId) {
    const rows = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
    tenant = rows[0];
  }

  if (tenant && !tenant.onboardingCompleted) {
    redirect('/onboarding');
  }

  if (!session.tenantId) {
    return (
      <div className="mx-auto max-w-2xl">
        <Alert variant="warning">
          <AlertDescription>
            Организация не найдена. Обратитесь к администратору или пройдите{' '}
            <Link href="/onboarding" className="underline">
              onboarding
            </Link>
            .
          </AlertDescription>
        </Alert>
      </div>
    );
  }

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
      pageKey: 'dashboard',
    }),
  ]);

  const hasData = summary.incomeCount + summary.expenseCount > 0;
  const greeting = session.email.split('@')[0];

  return (
    <DashboardClient
      tenantId={session.tenantId}
      greeting={greeting}
      hasData={hasData}
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
