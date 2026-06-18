// PURPOSE: Dashboard client — обёртка над BlockGrid с CashflowDataProvider (чтобы stat.* работали)
'use client';

import Link from 'next/link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BlockGrid } from '@/components/blocks/block-grid';
import { SectionAiButton } from '@/components/blocks/section-ai-button';
import {
  CashflowDataProvider,
  type CashflowSummary,
  type CashflowCategory,
  type CashflowTx,
} from '@/lib/blocks/catalog/cashflow-data';
import type { BlockInstance } from '@/lib/blocks/types';

export function DashboardClient({
  tenantId,
  greeting,
  hasData,
  initialBlocks,
  summary,
  topIncome,
  topExpense,
  initialTransactions,
}: {
  tenantId: string;
  greeting: string;
  hasData: boolean;
  initialBlocks: BlockInstance[];
  summary: CashflowSummary;
  topIncome: CashflowCategory[];
  topExpense: CashflowCategory[];
  initialTransactions: CashflowTx[];
}) {
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            Привет, {greeting}
          </h1>
          <p className="text-xs text-muted-foreground">
            {hasData
              ? 'Сводка за текущий месяц'
              : 'Начните с импорта выписки или добавления первой операции'}
          </p>
        </div>
        <div className="shrink-0">
          <SectionAiButton pageKey="dashboard" pageLabel="Главная" />
        </div>
      </div>

      <BlockGrid pageKey="dashboard" tenantId={tenantId} initialBlocks={initialBlocks}>
        {(grid) => (
          <CashflowDataProvider
            value={{
              summary,
              topIncome,
              topExpense,
              transactions: initialTransactions,
            }}
          >
            {grid}
          </CashflowDataProvider>
        )}
      </BlockGrid>

      <Alert variant="warning" className="text-xs">
        <AlertDescription>
          <strong>Foundation phase.</strong> Сейчас работают auth, лендинг, cashflow с импортом
          CSV/XLSX и конструктор блоков. Inbox, Deadlines, AI-секретарь — в разработке. План:{' '}
          <Link href="/PLAN.md" className="underline">
            PLAN.md
          </Link>
          .
        </AlertDescription>
      </Alert>
    </div>
  );
}
