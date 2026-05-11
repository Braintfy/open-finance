// PURPOSE: Каталог блоков для страницы Cashflow (income/expense/balance/top-cats/list)
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDown, ArrowUp, Wallet, ListOrdered, BarChart3, Pencil, Trash2 } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { formatDate } from '@/lib/utils';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import { useCashflowData, type CashflowTx } from './cashflow-data';
import { TransactionDialog } from './transaction-dialog';
import { resolveIconWithAnimation } from '../icon-resolver';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useBlockValuePublisher } from '../values';

// ============================================================================
// Shared KPI config
// ============================================================================

const KpiConfig = z.object({
  showKopecks: z.boolean().nullable().default(null),
});

// ============================================================================
// stat.income / stat.expense / stat.balance — KPI карточки
// ============================================================================

function formatCompactRubles(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_00) return `${(abs / 1_000_000_00).toFixed(1)}М₽`;
  if (abs >= 1_000_00) return `${(abs / 1_000_00).toFixed(0)}к₽`;
  const rubles = Math.round(abs / 100);
  return `${new Intl.NumberFormat('ru-RU').format(rubles)} ₽`;
}

function StatCard({
  label,
  value,
  icon,
  big,
  accent,
  showKopecks,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  big?: boolean;
  accent?: string;
  showKopecks: boolean;
}) {
  const density = useBlockDensity();
  const fmt = (v: number) => formatRublesWithSettings(v, showKopecks);
  const sign = value < 0 ? '−' : '';

  // XS — только значение крупно, без header
  if (density === 'xs') {
    return (
      <Card className="flex h-full flex-col justify-center p-0">
        <div className="flex items-center justify-center gap-1 px-1">
          {icon}
          <span
            className="truncate text-sm font-semibold tabular-nums tracking-tight"
            style={accent ? { color: accent } : undefined}
            title={`${sign}${fmt(Math.abs(value))}`}
          >
            {sign}
            {formatCompactRubles(value)}
          </span>
        </div>
      </Card>
    );
  }

  // SM — иконка + число, полный формат с truncate при переполнении
  if (density === 'sm') {
    return (
      <Card className="flex h-full flex-col justify-center p-2.5">
        <div className="flex items-center gap-1">
          {icon}
          <span className="truncate text-[11px] font-medium text-muted-foreground">{label}</span>
        </div>
        <div
          className="mt-0.5 truncate text-base font-semibold tabular-nums tracking-tight"
          style={accent ? { color: accent } : undefined}
          title={`${sign}${fmt(Math.abs(value))}`}
        >
          {sign}
          {fmt(Math.abs(value))}
        </div>
      </Card>
    );
  }

  // MD/LG — полный вариант
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-1.5">
        <CardTitle className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          {icon}
          <span className="line-clamp-1">{label}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 items-center">
        <div
          className={`${density === 'lg' ? 'text-2xl' : 'text-xl'} truncate font-semibold tabular-nums tracking-tight`}
          style={accent ? { color: accent } : undefined}
        >
          {sign}
          {fmt(Math.abs(value))}
        </div>
      </CardContent>
    </Card>
  );
}

function useKpiKopecks(config: unknown): boolean {
  const cfg = KpiConfig.safeParse(config ?? {});
  const { settings } = useFormatSettings();
  return (cfg.success ? cfg.data.showKopecks : null) ?? settings.showKopecks;
}

function RenderIncome({ instance }: BlockRenderProps) {
  const { summary, loading } = useCashflowData();
  const { Icon, animClass } = resolveIconWithAnimation(instance.appearance?.icon, ArrowDown);
  const accent = instance.appearance?.accentColor;
  const value = loading ? 0 : summary.incomeTotal;
  const showKopecks = useKpiKopecks(instance.config);
  useBlockValuePublisher(instance.id, {
    value,
    count: loading ? 0 : summary.incomeCount,
    label: instance.appearance?.title ?? 'Доходы за месяц',
  });
  return (
    <StatCard
      label={instance.appearance?.title ?? 'Доходы за месяц'}
      value={value}
      icon={<Icon className={`h-4 w-4 ${animClass}`} style={{ color: accent ?? '#16a34a' }} />}
      accent={accent}
      showKopecks={showKopecks}
    />
  );
}

function RenderExpense({ instance }: BlockRenderProps) {
  const { summary, loading } = useCashflowData();
  const { Icon, animClass } = resolveIconWithAnimation(instance.appearance?.icon, ArrowUp);
  const accent = instance.appearance?.accentColor;
  const value = loading ? 0 : summary.expenseTotal;
  const showKopecks = useKpiKopecks(instance.config);
  useBlockValuePublisher(instance.id, {
    value,
    count: loading ? 0 : summary.expenseCount,
    label: instance.appearance?.title ?? 'Расходы за месяц',
  });
  return (
    <StatCard
      label={instance.appearance?.title ?? 'Расходы за месяц'}
      value={value}
      icon={<Icon className={`h-4 w-4 ${animClass}`} style={{ color: accent ?? '#dc2626' }} />}
      accent={accent}
      showKopecks={showKopecks}
    />
  );
}

function RenderBalance({ instance }: BlockRenderProps) {
  const { summary, loading } = useCashflowData();
  const { Icon, animClass } = resolveIconWithAnimation(instance.appearance?.icon, Wallet);
  const accent = instance.appearance?.accentColor;
  const value = loading ? 0 : summary.balance;
  const showKopecks = useKpiKopecks(instance.config);
  useBlockValuePublisher(instance.id, {
    value,
    count: loading ? 0 : summary.incomeCount + summary.expenseCount,
    label: instance.appearance?.title ?? 'Баланс',
  });
  return (
    <StatCard
      label={instance.appearance?.title ?? 'Баланс'}
      value={value}
      icon={<Icon className={`h-4 w-4 ${animClass}`} style={accent ? { color: accent } : undefined} />}
      accent={accent}
      showKopecks={showKopecks}
      big
    />
  );
}

function KpiSettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const cfg = KpiConfig.parse(config ?? {});
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Копейки</Label>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Показывать копейки</div>
            <div className="text-[11px] text-muted-foreground">
              {cfg.showKopecks === null
                ? 'Глобальная настройка'
                : cfg.showKopecks
                  ? '1 234,56 ₽'
                  : '1 235 ₽'}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {cfg.showKopecks !== null && (
              <button
                type="button"
                onClick={() => onChange({ ...cfg, showKopecks: null })}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Сбросить
              </button>
            )}
            <Switch
              checked={cfg.showKopecks ?? false}
              onCheckedChange={(v) => onChange({ ...cfg, showKopecks: v })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const StatIncomeBlock: BlockDef = {
  type: 'stat.income',
  displayName: 'Доходы (KPI)',
  description: 'Сумма поступлений за текущий месяц',
  category: 'stats',
  icon: ArrowDown,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 1, h: 1 },
  minContentSize: { w: 80, h: 40 },
  pages: ['cashflow', 'dashboard'],
  configSchema: KpiConfig,
  defaultConfig: () => ({ showKopecks: null }),
  SettingsForm: KpiSettingsForm,
  Render: RenderIncome,
};

export const StatExpenseBlock: BlockDef = {
  type: 'stat.expense',
  displayName: 'Расходы (KPI)',
  description: 'Сумма расходов за текущий месяц',
  category: 'stats',
  icon: ArrowUp,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 1, h: 1 },
  minContentSize: { w: 80, h: 40 },
  pages: ['cashflow', 'dashboard'],
  configSchema: KpiConfig,
  defaultConfig: () => ({ showKopecks: null }),
  SettingsForm: KpiSettingsForm,
  Render: RenderExpense,
};

export const StatBalanceBlock: BlockDef = {
  type: 'stat.balance',
  displayName: 'Баланс (KPI)',
  description: 'Доходы минус расходы за месяц',
  category: 'stats',
  icon: Wallet,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 1, h: 1 },
  minContentSize: { w: 80, h: 40 },
  pages: ['cashflow', 'dashboard'],
  configSchema: KpiConfig,
  defaultConfig: () => ({ showKopecks: null }),
  SettingsForm: KpiSettingsForm,
  Render: RenderBalance,
};

// ============================================================================
// cashflow.top-categories
// ============================================================================

const TopCatsConfig = z.object({
  type: z.enum(['income', 'expense']).default('expense'),
  title: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(5),
  showKopecks: z.boolean().nullable().default(null),
});

function RenderTopCategories({ instance }: BlockRenderProps) {
  const cfg = TopCatsConfig.parse(instance.config ?? {});
  const { topIncome, topExpense, loading } = useCashflowData();
  const density = useBlockDensity();
  const { settings } = useFormatSettings();
  const showKopecks = cfg.showKopecks ?? settings.showKopecks;
  const fmt = (v: number) => formatRublesWithSettings(v, showKopecks);
  const rows = cfg.type === 'income' ? topIncome : topExpense;

  // Ограничение по плотности: чем меньше места — тем меньше строк
  const densityLimit =
    density === 'xs' ? 1 : density === 'sm' ? 3 : density === 'md' ? cfg.limit : cfg.limit;
  const sliced = rows.slice(0, Math.min(cfg.limit, densityLimit));
  const max = sliced.length > 0 ? Math.max(...sliced.map((r: { total: number }) => r.total)) : 1;

  const accent =
    instance.appearance?.accentColor ??
    (cfg.type === 'income' ? '#10b981' : '#ef4444');
  const title =
    instance.appearance?.title ??
    cfg.title ??
    (cfg.type === 'income' ? 'Топ доходов' : 'Топ расходов');

  const isCompact = density === 'xs' || density === 'sm';

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className={isCompact ? 'p-2 pb-1' : 'pb-2'}>
        <CardTitle className={isCompact ? 'truncate text-xs' : 'text-base font-semibold'}>{title}</CardTitle>
      </CardHeader>
      <CardContent
        className={
          isCompact
            ? 'flex-1 space-y-1 overflow-y-auto p-2 pt-0'
            : 'flex-1 space-y-3 overflow-y-auto'
        }
      >
        {loading ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : sliced.length === 0 ? (
          <p className="text-sm text-muted-foreground">Нет данных</p>
        ) : (
          sliced.map((r: { categoryName: string; total: number }) => (
            <div key={r.categoryName} className="space-y-1">
              <div className={`flex items-center justify-between gap-2 ${isCompact ? 'text-[11px]' : 'text-sm'}`}>
                <span className="truncate font-medium">{r.categoryName}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {isCompact ? formatCompactRubles(r.total) : fmt(r.total)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.round((r.total / max) * 100)}%`,
                    backgroundColor: accent,
                  }}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function TopCategoriesSettings({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const cfg = TopCatsConfig.parse(config ?? {});
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">Что показывать</label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={cfg.type === 'income' ? 'default' : 'outline'}
            onClick={() => onChange({ ...cfg, type: 'income' })}
            className="flex-1"
          >
            Доходы
          </Button>
          <Button
            type="button"
            size="sm"
            variant={cfg.type === 'expense' ? 'default' : 'outline'}
            onClick={() => onChange({ ...cfg, type: 'expense' })}
            className="flex-1"
          >
            Расходы
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Количество строк: <span className="tabular-nums">{cfg.limit}</span>
        </label>
        <input
          type="range"
          min={1}
          max={20}
          value={cfg.limit}
          onChange={(e) => onChange({ ...cfg, limit: Number(e.target.value) })}
          className="w-full accent-primary"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Копейки</Label>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Показывать копейки</div>
            <div className="text-[11px] text-muted-foreground">
              {cfg.showKopecks === null
                ? 'Глобальная настройка'
                : cfg.showKopecks
                  ? '1 234,56 ₽'
                  : '1 235 ₽'}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {cfg.showKopecks !== null && (
              <button
                type="button"
                onClick={() => onChange({ ...cfg, showKopecks: null })}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Сбросить
              </button>
            )}
            <Switch
              checked={cfg.showKopecks ?? false}
              onCheckedChange={(v) => onChange({ ...cfg, showKopecks: v })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const TopCategoriesBlock: BlockDef = {
  type: 'cashflow.top-categories',
  displayName: 'Топ категорий',
  description: 'Топ категорий по доходам или расходам',
  category: 'charts',
  icon: BarChart3,
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 2, h: 2 },
  minContentSize: { w: 180, h: 120 },
  pages: ['cashflow', 'dashboard'],
  configSchema: TopCatsConfig,
  defaultConfig: () => ({ type: 'expense', limit: 5, showKopecks: null }),
  SettingsForm: TopCategoriesSettings,
  Render: RenderTopCategories,
};

// ============================================================================
// cashflow.transactions — список последних операций
// ============================================================================

const TxListConfig = z.object({
  limit: z.number().int().min(5).max(200).default(50),
  title: z.string().optional(),
  showKopecks: z.boolean().nullable().default(null),
});

function RenderTransactionsList({ instance }: BlockRenderProps) {
  const cfg = TxListConfig.parse(instance.config ?? {});
  const { transactions, loading } = useCashflowData();
  const router = useRouter();
  const { settings } = useFormatSettings();
  const showKopecks = cfg.showKopecks ?? settings.showKopecks;
  const fmt = (v: number) => formatRublesWithSettings(v, showKopecks);
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
        <CardTitle className="text-base">
          {instance.appearance?.title ?? cfg.title ?? 'История операций'}
        </CardTitle>
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
                    {fmt(t.amount)}
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

function TransactionsSettings({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const cfg = TxListConfig.parse(config ?? {});
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-sm font-medium">
          Сколько строк показывать: <span className="tabular-nums">{cfg.limit}</span>
        </label>
        <input
          type="range"
          min={5}
          max={200}
          step={5}
          value={cfg.limit}
          onChange={(e) => onChange({ ...cfg, limit: Number(e.target.value) })}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>5</span>
          <span>200</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Копейки</Label>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Показывать копейки</div>
            <div className="text-[11px] text-muted-foreground">
              {cfg.showKopecks === null
                ? 'Глобальная настройка'
                : cfg.showKopecks
                  ? '1 234,56 ₽'
                  : '1 235 ₽'}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {cfg.showKopecks !== null && (
              <button
                type="button"
                onClick={() => onChange({ ...cfg, showKopecks: null })}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                Сбросить
              </button>
            )}
            <Switch
              checked={cfg.showKopecks ?? false}
              onCheckedChange={(v) => onChange({ ...cfg, showKopecks: v })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export const TransactionsListBlock: BlockDef = {
  type: 'cashflow.transactions',
  displayName: 'Список операций',
  description: 'Список последних транзакций с edit/delete и Очистить всё',
  category: 'tables',
  icon: ListOrdered,
  defaultSize: { w: 12, h: 6 },
  minSize: { w: 3, h: 3 },
  minContentSize: { w: 280, h: 180 },
  pages: ['cashflow'],
  configSchema: TxListConfig,
  defaultConfig: () => ({ limit: 50 }),
  SettingsForm: TransactionsSettings,
  Render: RenderTransactionsList,
};
