// PURPOSE: Контекст данных Cashflow — одна выборка на все блоки страницы
'use client';

import { createContext, useContext, type ReactNode } from 'react';

export type CashflowSummary = {
  incomeTotal: number;
  expenseTotal: number;
  balance: number;
};

export type CashflowCategory = {
  categoryName: string;
  total: number;
  count: number;
};

export type CashflowTx = {
  id: string;
  amount: number;
  type: 'income' | 'expense';
  description: string | null;
  counterparty: string | null;
  occurredAt: string;
  source: string | null;
};

type Ctx = {
  summary: CashflowSummary;
  topIncome: CashflowCategory[];
  topExpense: CashflowCategory[];
  transactions: CashflowTx[];
  loading: boolean;
};

const CashflowDataContext = createContext<Ctx>({
  summary: { incomeTotal: 0, expenseTotal: 0, balance: 0 },
  topIncome: [],
  topExpense: [],
  transactions: [],
  loading: true,
});

export function CashflowDataProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: Omit<Ctx, 'loading'>;
}) {
  return (
    <CashflowDataContext.Provider value={{ ...value, loading: false }}>
      {children}
    </CashflowDataContext.Provider>
  );
}

export function useCashflowData(): Ctx {
  return useContext(CashflowDataContext);
}
