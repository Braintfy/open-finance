// PURPOSE: Chart block для визуализации cashflow — line/bar/area графики
// доходов, расходов и баланса по дням. Использует Recharts.
'use client';

import { useMemo } from 'react';
import { z } from 'zod';
import { BarChart3 } from 'lucide-react';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { useCashflowData, type CashflowTx } from './cashflow-data';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useBlockValuePublisher } from '../values';
import { Label } from '@/components/ui/label';

const ChartConfig = z.object({
  chartType: z.enum(['bar', 'line', 'area']).default('bar'),
  showIncome: z.boolean().default(true),
  showExpense: z.boolean().default(true),
  showBalance: z.boolean().default(false),
  groupBy: z.enum(['day', 'week', 'month']).default('day'),
});

type Cfg = z.infer<typeof ChartConfig>;

type DataPoint = {
  label: string;
  income: number;
  expense: number;
  balance: number;
};

function groupTransactions(txs: CashflowTx[], groupBy: Cfg['groupBy']): DataPoint[] {
  const map = new Map<string, { income: number; expense: number }>();

  for (const tx of txs) {
    const date = new Date(tx.occurredAt);
    let key: string;
    if (groupBy === 'month') {
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    } else if (groupBy === 'week') {
      const d = new Date(date);
      d.setDate(d.getDate() - d.getDay());
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } else {
      key = tx.occurredAt.slice(0, 10);
    }
    const prev = map.get(key) ?? { income: 0, expense: 0 };
    if (tx.type === 'income') {
      prev.income += tx.amount;
    } else {
      prev.expense += tx.amount;
    }
    map.set(key, prev);
  }

  const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  let runningBalance = 0;
  return sorted.map(([label, { income, expense }]) => {
    runningBalance += income - expense;
    const shortLabel = formatLabel(label, groupBy);
    return {
      label: shortLabel,
      income: Math.round(income / 100),
      expense: Math.round(expense / 100),
      balance: Math.round(runningBalance / 100),
    };
  });
}

function formatLabel(raw: string, groupBy: Cfg['groupBy']): string {
  if (groupBy === 'month') {
    const parts = raw.split('-');
    const months = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
    return months[parseInt(parts[1], 10) - 1] ?? raw;
  }
  if (groupBy === 'week') {
    const parts = raw.split('-');
    return `${parts[2]}.${parts[1]}`;
  }
  // day
  const parts = raw.split('-');
  return `${parts[2]}.${parts[1]}`;
}

function formatYAxis(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}М`;
  if (abs >= 1_000) return `${(v / 1_000).toFixed(1)}к`;
  return String(v);
}

const INCOME_COLOR = '#10b981';
const EXPENSE_COLOR = '#ef4444';
const BALANCE_COLOR = '#3b82f6';

function ChartRender({ instance }: BlockRenderProps) {
  const density = useBlockDensity();
  const { settings: fmtSettings } = useFormatSettings();
  const { transactions, loading } = useCashflowData();
  const cfg: Cfg = { ...ChartConfig.parse({}), ...(instance.config as Partial<Cfg>) };

  const data = useMemo(
    () => groupTransactions(transactions, cfg.groupBy),
    [transactions, cfg.groupBy]
  );

  useBlockValuePublisher(instance.id, {
    value: data.length,
    points: data.length,
  });

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Загрузка…
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Нет данных для графика
      </div>
    );
  }

  const showLegend = density !== 'xs' && density !== 'sm';
  const showYAxis = density !== 'xs';
  const showGrid = density === 'md' || density === 'lg';
  const fontSize = density === 'xs' ? 9 : density === 'sm' ? 10 : 11;

  const chartProps = {
    data,
    margin: {
      top: 4,
      right: 4,
      left: showYAxis ? 4 : 0,
      bottom: showLegend ? 0 : 4,
    },
  };

  const xAxisProps = {
    dataKey: 'label' as const,
    tick: { fontSize },
    tickLine: false,
    axisLine: false,
  };

  const yAxisProps = {
    tick: { fontSize },
    tickFormatter: formatYAxis,
    tickLine: false,
    axisLine: false,
    width: 40,
  };

  const tooltipProps = {
    contentStyle: {
      fontSize: 12,
      borderRadius: 8,
      border: '1px solid hsl(var(--border))',
      backgroundColor: 'hsl(var(--background))',
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    formatter: (value: any) => {
      const num = typeof value === 'number' ? value : Number(value ?? 0);
      // num уже в рублях; formatRublesWithSettings ожидает копейки → ×100
      return [formatRublesWithSettings(num * 100, fmtSettings.showKopecks)];
    },
  };

  const renderChart = () => {
    if (cfg.chartType === 'line') {
      return (
        <LineChart {...chartProps}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />}
          <XAxis {...xAxisProps} />
          {showYAxis && <YAxis {...yAxisProps} />}
          <Tooltip {...tooltipProps} />
          {showLegend && <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />}
          {cfg.showIncome && (
            <Line type="monotone" dataKey="income" name="Доход" stroke={INCOME_COLOR} strokeWidth={2} dot={false} />
          )}
          {cfg.showExpense && (
            <Line type="monotone" dataKey="expense" name="Расход" stroke={EXPENSE_COLOR} strokeWidth={2} dot={false} />
          )}
          {cfg.showBalance && (
            <Line type="monotone" dataKey="balance" name="Баланс" stroke={BALANCE_COLOR} strokeWidth={2} dot={false} />
          )}
        </LineChart>
      );
    }

    if (cfg.chartType === 'area') {
      return (
        <AreaChart {...chartProps}>
          {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />}
          <XAxis {...xAxisProps} />
          {showYAxis && <YAxis {...yAxisProps} />}
          <Tooltip {...tooltipProps} />
          {showLegend && <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />}
          {cfg.showIncome && (
            <Area type="monotone" dataKey="income" name="Доход" stroke={INCOME_COLOR} fill={INCOME_COLOR} fillOpacity={0.15} strokeWidth={2} />
          )}
          {cfg.showExpense && (
            <Area type="monotone" dataKey="expense" name="Расход" stroke={EXPENSE_COLOR} fill={EXPENSE_COLOR} fillOpacity={0.15} strokeWidth={2} />
          )}
          {cfg.showBalance && (
            <Area type="monotone" dataKey="balance" name="Баланс" stroke={BALANCE_COLOR} fill={BALANCE_COLOR} fillOpacity={0.15} strokeWidth={2} />
          )}
        </AreaChart>
      );
    }

    // bar (default)
    return (
      <BarChart {...chartProps}>
        {showGrid && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.5} />}
        <XAxis {...xAxisProps} />
        {showYAxis && <YAxis {...yAxisProps} />}
        <Tooltip {...tooltipProps} />
        {showLegend && <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />}
        {cfg.showIncome && (
          <Bar dataKey="income" name="Доход" fill={INCOME_COLOR} radius={[2, 2, 0, 0]} />
        )}
        {cfg.showExpense && (
          <Bar dataKey="expense" name="Расход" fill={EXPENSE_COLOR} radius={[2, 2, 0, 0]} />
        )}
        {cfg.showBalance && (
          <Bar dataKey="balance" name="Баланс" fill={BALANCE_COLOR} radius={[2, 2, 0, 0]} />
        )}
      </BarChart>
    );
  };

  return (
    <div className="h-full w-full p-1">
      <ResponsiveContainer width="100%" height="100%">
        {renderChart()}
      </ResponsiveContainer>
    </div>
  );
}

function ChartSettings({ config, onChange }: BlockSettingsFormProps) {
  const cfg: Cfg = { ...ChartConfig.parse({}), ...(config as Partial<Cfg>) };

  function set<K extends keyof Cfg>(key: K, value: Cfg[K]) {
    onChange({ ...config, [key]: value });
  }

  const chartTypes: Array<{ value: Cfg['chartType']; label: string }> = [
    { value: 'bar', label: 'Столбцы' },
    { value: 'line', label: 'Линии' },
    { value: 'area', label: 'Область' },
  ];

  const groupOptions: Array<{ value: Cfg['groupBy']; label: string }> = [
    { value: 'day', label: 'По дням' },
    { value: 'week', label: 'По неделям' },
    { value: 'month', label: 'По месяцам' },
  ];

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Тип графика</Label>
        <div className="flex gap-1">
          {chartTypes.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => set('chartType', t.value)}
              className={
                'inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors ' +
                (cfg.chartType === t.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent')
              }
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Группировка</Label>
        <div className="flex gap-1">
          {groupOptions.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => set('groupBy', g.value)}
              className={
                'inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors ' +
                (cfg.groupBy === g.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent')
              }
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Серии данных</Label>
        <div className="space-y-1">
          {([
            { key: 'showIncome' as const, label: 'Доходы', color: INCOME_COLOR },
            { key: 'showExpense' as const, label: 'Расходы', color: EXPENSE_COLOR },
            { key: 'showBalance' as const, label: 'Баланс (накопительный)', color: BALANCE_COLOR },
          ]).map((s) => (
            <label key={s.key} className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={cfg[s.key]}
                onChange={(e) => set(s.key, e.target.checked)}
                className="accent-primary"
              />
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: s.color }}
              />
              {s.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export const CashflowChartBlock: BlockDef = {
  type: 'chart.cashflow',
  displayName: 'График денежного потока',
  description: 'Line/Bar/Area график доходов, расходов и баланса',
  category: 'charts',
  icon: BarChart3,
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 3, h: 2 },
  minContentSize: { w: 200, h: 120 },
  pages: ['cashflow', 'dashboard'],
  configSchema: ChartConfig,
  defaultConfig: () => ({
    chartType: 'bar',
    showIncome: true,
    showExpense: true,
    showBalance: false,
    groupBy: 'day',
  }),
  SettingsForm: ChartSettings,
  Render: ChartRender,
};
