// PURPOSE: Каталог блоков для страницы Cashflow (income/expense/balance/top-cats/list)
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Wallet, ListOrdered, BarChart3, Pencil, Trash2 } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { formatRubles, formatDate } from '@/lib/utils';
import { useCashflowData, type CashflowTx } from './cashflow-data';
import { TransactionDialog } from './transaction-dialog';

// ============================================================================
// stat.income / stat.expense / stat.balance — KPI карточки
// ============================================================================

function StatCard({
  label,
  value,
  icon,
  big,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  big?: boolean;
}) {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-normal text-muted-foreground">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`${big ? 'text-3xl' : 'text-2xl'} font-semibold tabular-nums`}>
          {value < 0 ? '−' : ''}
          {formatRubles(Math.abs(value))}
        </div>
      </CardContent>
    </Card>
  );
}

function RenderIncome(_props: BlockRenderProps) {
  const { summary, loading } = useCashflowData();
  return (
    <StatCard
      label="Доходы за месяц"
      value={loading ? 0 : summary.incomeTotal}
      icon={<ArrowDown className="h-4 w-4 text-green-600" />}
    />
  );
}

function RenderExpense(_props: BlockRenderProps) {
  const { summary, loading } = useCashflowData();
  return (
    <StatCard
      label="Расходы за месяц"
      value={loading ? 0 : summary.expenseTotal}
      icon={<ArrowUp className="h-4 w-4 text-red-600" />}
    />
  );
}

function RenderBalance(_props: BlockRenderProps) {
  const { summary, loading } = useCashflowData();
  return (
    <StatCard
      label="Баланс"
      value={loading ? 0 : summary.balance}
      icon={<Wallet className="h-4 w-4 text-muted-foreground" />}
      big
    />
  );
}

export const StatIncomeBlock: BlockDef = {
  type: 'stat.income',
  displayName: 'Доходы (KPI)',
  description: 'Сумма поступлений за текущий месяц',
  category: 'stats',
  icon: ArrowDown,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 3, h: 2 },
  pages: ['cashflow', 'dashboard'],
  Render: RenderIncome,
};

export const StatExpenseBlock: BlockDef = {
  type: 'stat.expense',
  displayName: 'Расходы (KPI)',
  description: 'Сумма расходов за текущий месяц',
  category: 'stats',
  icon: ArrowUp,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 3, h: 2 },
  pages: ['cashflow', 'dashboard'],
  Render: RenderExpense,
};

export const StatBalanceBlock: BlockDef = {
  type: 'stat.balance',
  displayName: 'Баланс (KPI)',
  description: 'Доходы минус расходы за месяц',
  category: 'stats',
  icon: Wallet,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 3, h: 2 },
  pages: ['cashflow', 'dashboard'],
  Render: RenderBalance,
};

// ============================================================================
// cashflow.top-categories
// ============================================================================

const TopCatsConfig = z.object({
  type: z.enum(['income', 'expense']).default('expense'),
  title: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(5),
});

function RenderTopCategories({ instance }: BlockRenderProps) {
  const cfg = TopCatsConfig.parse(instance.config ?? {});
  const { topIncome, topExpense, loading } = useCashflowData();
  const rows = cfg.type === 'income' ? topIncome : topExpense;
  const sliced = rows.slice(0, cfg.limit);
  const max = sliced.length > 0 ? Math.max(...sliced.map((r) => r.total)) : 1;

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader>
        <CardTitle className="text-base">
          {cfg.title ?? (cfg.type === 'income' ? 'Топ доходов' : 'Топ расходов')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 overflow-y-auto">
        {loading ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : sliced.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет данных</p>
        ) : (
          sliced.map((r) => (
            <div key={r.categoryName} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{r.categoryName}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatRubles(r.total)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full ${
                    cfg.type === 'income' ? 'bg-green-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${Math.round((r.total / max) * 100)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export const TopCategoriesBlock: BlockDef = {
  type: 'cashflow.top-categories',
  displayName: 'Топ категорий',
  description: 'Топ категорий по доходам или расходам',
  category: 'charts',
  icon: BarChart3,
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 4, h: 3 },
  pages: ['cashflow', 'dashboard'],
  configSchema: TopCatsConfig,
  defaultConfig: () => ({ type: 'expense', limit: 5 }),
  Render: RenderTopCategories,
};

// ============================================================================
// cashflow.transactions — список последних операций
// ============================================================================

const TxListConfig = z.object({
  limit: z.number().int().min(5).max(200).default(50),
  title: z.string().optional(),
});

function RenderTransactionsList({ instance }: BlockRenderProps) {
  const cfg = TxListConfig.parse(instance.config ?? {});
  const { transactions, loading } = useCashflowData();
  const router = useRouter();
  const [editing, setEditing] = useState<CashflowTx | null>(null);
  const [editingNew, setEditingNew] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clearAll, setClearAll] = useState(false);

  const rows = transactions.slice(0, cfg.limit);

  async function deleteOne(id: string) {
    const res = await fetch(`/api/cashflow/transactions/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) router.refresh();
    else alert(data.error ?? 'Не удалось удалить');
  }

  async function doClearAll() {
    const res = await fetch('/api/cashflow/transactions?confirm=true', { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) router.refresh();
    else alert(data.error ?? 'Не удалось очистить');
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">{cfg.title ?? 'История операций'}</CardTitle>
        {transactions.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-red-600 hover:bg-red-50 hover:text-red-700"
            onClick={() => setClearAll(true)}
          >
            Очистить всё
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto p-0">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Загрузка…</p>
        ) : rows.length === 0 ? (
          <p className="p-12 text-center text-sm text-muted-foreground">Нет операций</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Дата</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Контрагент
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Сумма
                </th>
                <th className="w-16"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="group border-b last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                    {formatDate(t.occurredAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="line-clamp-1">{t.counterparty ?? '—'}</div>
                    {t.description && (
                      <div className="line-clamp-1 text-xs text-muted-foreground">
                        {t.description}
                      </div>
                    )}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums ${
                      t.type === 'income' ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {t.type === 'income' ? '+' : '−'}
                    {formatRubles(t.amount)}
                  </td>
                  <td className="px-2">
                    <div className="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setEditing(t)}
                        aria-label="Редактировать"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setDeleteId(t.id)}
                        aria-label="Удалить"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>

      <TransactionDialog
        open={editing !== null || editingNew}
        initial={editing}
        onClose={() => {
          setEditing(null);
          setEditingNew(false);
        }}
        onSaved={() => {
          setEditing(null);
          setEditingNew(false);
          router.refresh();
        }}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить операцию?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись будет удалена безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                if (deleteId) deleteOne(deleteId);
                setDeleteId(null);
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearAll} onOpenChange={setClearAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Очистить всю историю?</AlertDialogTitle>
            <AlertDialogDescription>
              Будут удалены <strong>все {transactions.length}</strong> транзакций. Категории и
              настройки сохранятся.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={() => {
                doClearAll();
                setClearAll(false);
              }}
            >
              Удалить все
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export const TransactionsListBlock: BlockDef = {
  type: 'cashflow.transactions',
  displayName: 'Список операций',
  description: 'Список последних транзакций с фильтрами',
  category: 'tables',
  icon: ListOrdered,
  defaultSize: { w: 12, h: 6 },
  minSize: { w: 6, h: 3 },
  pages: ['cashflow'],
  configSchema: TxListConfig,
  defaultConfig: () => ({ limit: 50 }),
  Render: RenderTransactionsList,
};
