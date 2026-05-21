// PURPOSE: KPI Grid block — контейнер с 1–6 KPI-ячейками cashflow
// (income/expense/balance/count) в одном Card. Один заголовок, разные ячейки
// со своими period/source/category override. Заменяет несколько отдельных
// stat.* блоков на странице.
//
// Дизайн: один Card → grid внутри. Каждая ячейка — компактный KPI:
//   - label (truncate)
//   - value (tabular-nums, format=rub/number/percent)
//   - delta % (опц., при наличии previous)
//
// Layout: row (горизонтально) / column (вертикально) / grid-2col / grid-3col.
//
// Hooks: каждая ячейка — отдельный <KpiCellRender> компонент, который
// вызывает `useCashflowKpiLite` для своих фильтров. Это даёт стабильный
// порядок хуков (никаких условных вызовов).

'use client';

import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import {
  ArrowDown,
  ArrowUp,
  ListOrdered,
  Wallet,
  TrendingUp,
  TrendingDown,
  Minus,
  type LucideIcon,
} from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps } from '../types';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useEffectivePeriod } from '../page-period-context';
import { useEffectiveSource } from '../page-source-context';
import { useBlockValuePublisher } from '../values';
import { useCashflowKpiLite } from '../virtual-sources';
import { KpiGridSettings } from './kpi-grid-settings';

// ===========================================================================
// Schema
// ===========================================================================

const PeriodPresetSchema = z.enum([
  'today',
  'yesterday',
  '7d',
  '14d',
  '30d',
  'mtd',
  'custom',
]);

const MetricSchema = z.enum(['income', 'expense', 'balance', 'count']);
const FormatSchema = z.enum(['rub', 'number', 'percent', 'compact']);
const LayoutSchema = z.enum(['row', 'column', 'grid-2col', 'grid-3col']);

const CellSchema = z.object({
  id: z.string(),
  metric: MetricSchema.default('income'),
  /** Если задан — отображается вместо дефолтного для метрики. */
  label: z.string().optional(),
  /** Если задан — этот период вместо global. */
  periodOverride: z
    .object({
      preset: PeriodPresetSchema.default('mtd'),
      customFrom: z.string().nullable().default(null),
      customTo: z.string().nullable().default(null),
    })
    .nullable()
    .optional(),
  /** Если задан — этот source вместо global (null = override на «все»). */
  sourceOverride: z.string().nullable().optional(),
  categoryName: z.string().optional(),
  counterparty: z.string().optional(),
  format: FormatSchema.default('rub'),
  /** HEX акцент — для иконки + значения. */
  accentColor: z.string().optional(),
});

const ConfigSchema = z.object({
  title: z.string().default('KPI'),
  layout: LayoutSchema.default('row'),
  cells: z.array(CellSchema).min(1).max(6).default([]),
});

export type KpiGridConfig = z.infer<typeof ConfigSchema>;
export type KpiGridCell = z.infer<typeof CellSchema>;

function parseConfig(raw: unknown): KpiGridConfig {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  return { title: 'KPI', layout: 'row', cells: [] };
}

// ===========================================================================
// Helpers
// ===========================================================================

const METRIC_DEFAULTS: Record<
  z.infer<typeof MetricSchema>,
  { label: string; icon: LucideIcon; accent: string; goodDirection: 'up' | 'down' }
> = {
  income: { label: 'Доходы', icon: ArrowDown, accent: '#10b981', goodDirection: 'up' },
  expense: { label: 'Расходы', icon: ArrowUp, accent: '#ef4444', goodDirection: 'down' },
  balance: { label: 'Баланс', icon: Wallet, accent: '#3b82f6', goodDirection: 'up' },
  count: { label: 'Операций', icon: ListOrdered, accent: '#64748b', goodDirection: 'up' },
};

function formatValue(
  value: number | null,
  format: KpiGridCell['format'],
): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (format === 'rub') {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (format === 'percent') {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + '%';
  }
  if (format === 'compact') {
    return new Intl.NumberFormat('ru-RU', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function deltaToneClass(value: number | null, good: 'up' | 'down'): string {
  if (value === null || value === 0) return 'bg-muted text-muted-foreground';
  const up = value > 0;
  const isGood = good === 'up' ? up : !up;
  return isGood
    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
    : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300';
}

function layoutClassName(layout: KpiGridConfig['layout'], count: number): string {
  if (layout === 'row') return `grid grid-flow-col auto-cols-fr gap-2`;
  if (layout === 'column') return `grid grid-flow-row auto-rows-fr gap-2`;
  if (layout === 'grid-2col')
    return `grid grid-cols-2 gap-2 ${count > 2 ? 'auto-rows-fr' : ''}`;
  if (layout === 'grid-3col')
    return `grid grid-cols-3 gap-2 ${count > 3 ? 'auto-rows-fr' : ''}`;
  return 'grid grid-cols-1 gap-2';
}

// ===========================================================================
// Render
// ===========================================================================

function KpiCellRender({
  cell,
  instanceId,
  compact,
  onValue,
}: {
  cell: KpiGridCell;
  instanceId: string;
  compact: boolean;
  onValue: (cellId: string, value: number | null, label: string) => void;
}) {
  // Resolve effective period + source: блок-уровень override > page-level.
  const { value: period } = useEffectivePeriod(
    `${instanceId}:${cell.id}`,
    cell.periodOverride ?? null,
  );
  const { value: source } = useEffectiveSource(
    `${instanceId}:${cell.id}`,
    cell.sourceOverride === undefined ? undefined : cell.sourceOverride,
  );

  // Загружаем все 3 lite-KPI без условий (стабильный порядок hooks).
  // По cell.metric — берём нужное значение из них.
  const incomeKpi = useCashflowKpiLite('income', period, source);
  const expenseKpi = useCashflowKpiLite('expense', period, source);
  const balanceKpi = useCashflowKpiLite('balance', period, source);

  let value: number | null = null;
  let previous: number | null = null;
  if (cell.metric === 'income') {
    value = incomeKpi?.current ?? null;
    previous = incomeKpi?.previous ?? null;
  } else if (cell.metric === 'expense') {
    value = expenseKpi?.current ?? null;
    previous = expenseKpi?.previous ?? null;
  } else if (cell.metric === 'balance') {
    value = balanceKpi?.current ?? null;
    previous = balanceKpi?.previous ?? null;
  } else if (cell.metric === 'count') {
    value = (incomeKpi?.count ?? 0) + (expenseKpi?.count ?? 0);
    previous = (incomeKpi?.prevCount ?? 0) + (expenseKpi?.prevCount ?? 0);
  }

  const defaults = METRIC_DEFAULTS[cell.metric];
  const label = cell.label ?? defaults.label;
  const Icon = defaults.icon;
  const color = cell.accentColor ?? defaults.accent;

  // Дельта % vs previous (если применимо и есть данные).
  const deltaPct =
    previous !== null && previous !== 0 && value !== null
      ? ((value - previous) / Math.abs(previous)) * 100
      : null;

  // Публикуем значение наверх для bindings.
  useLayoutEffect(() => {
    onValue(cell.id, value, label);
  }, [cell.id, value, label, onValue]);

  return (
    <div className="flex h-full min-h-0 flex-col justify-between rounded-md border border-border/50 bg-card/40 p-2">
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon className="h-3.5 w-3.5 shrink-0" style={{ color }} />
          <div className="truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
        </div>
        {deltaPct !== null && !compact && (
          <div
            className={
              'flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ' +
              deltaToneClass(deltaPct, defaults.goodDirection)
            }
            title={`vs прошлый период: ${previous !== null ? formatValue(previous, cell.format) : '—'}`}
          >
            {deltaPct === 0 ? (
              <Minus className="h-2.5 w-2.5" />
            ) : deltaPct > 0 ? (
              <TrendingUp className="h-2.5 w-2.5" />
            ) : (
              <TrendingDown className="h-2.5 w-2.5" />
            )}
            {Math.abs(deltaPct).toFixed(0)}%
          </div>
        )}
      </div>
      <div className="mt-1 min-w-0">
        <div
          className={
            'tabular-nums font-semibold ' + (compact ? 'text-base' : 'text-xl')
          }
          style={{ color }}
          title={value !== null ? String(value) : undefined}
        >
          {formatValue(value, cell.format)}
        </div>
      </div>
    </div>
  );
}

function RenderKpiGrid({ instance }: BlockRenderProps) {
  const config = parseConfig(instance.config);
  const density = useBlockDensity();
  const compact = density === 'xs' || density === 'sm';

  const [cellValues, setCellValues] = useState<
    Record<string, { value: number | null; label: string }>
  >({});

  const setCellValue = useCallback((id: string, value: number | null, label: string) => {
    setCellValues((prev) => {
      const current = prev[id];
      if (current && current.value === value && current.label === label) return prev;
      return { ...prev, [id]: { value, label } };
    });
  }, []);

  // Publish values: для каждой ячейки — `cells.{id}.value` и `cells.{id}.label`.
  // Также `__money` помечает money-ячейки.
  const published = useMemo<Record<string, number | string | null>>(() => {
    const out: Record<string, number | string | null> = {};
    const moneyKeys: string[] = [];
    config.cells.forEach((cell) => {
      const v = cellValues[cell.id];
      if (!v) return;
      const key = `cells.${cell.id}.value`;
      const labelKey = `cells.${cell.id}.label`;
      out[key] = v.value;
      out[labelKey] = v.label;
      if (cell.format === 'rub') moneyKeys.push(key);
    });
    out.__money = moneyKeys.join(',');
    out.label = config.title;
    // value по умолчанию — первая ячейка (для удобства бинда).
    if (config.cells[0] && cellValues[config.cells[0].id]) {
      out.value = cellValues[config.cells[0].id].value;
    }
    return out;
  }, [config.cells, config.title, cellValues]);

  useBlockValuePublisher(instance.id, published);

  const gridClass = layoutClassName(config.layout, config.cells.length);

  if (config.cells.length === 0) {
    return (
      <Card className="flex h-full flex-col items-center justify-center gap-1 p-3 text-center">
        <Wallet className="h-5 w-5 text-muted-foreground/50" />
        <div className="text-xs text-muted-foreground">
          Пустая KPI-сетка. Добавьте ячейки в настройках блока.
        </div>
      </Card>
    );
  }

  return (
    <Card className={compact ? 'flex h-full flex-col p-2' : 'flex h-full flex-col p-3'}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="truncate text-sm font-medium text-muted-foreground">{config.title}</div>
      </div>
      <div className={'min-h-0 flex-1 ' + gridClass}>
        {config.cells.map((cell) => (
          <KpiCellRender
            key={cell.id}
            cell={cell}
            instanceId={instance.id}
            compact={compact}
            onValue={setCellValue}
          />
        ))}
      </div>
    </Card>
  );
}

// ===========================================================================
// Block definition
// ===========================================================================

export const KpiGridBlock: BlockDef = {
  type: 'kpi.grid',
  displayName: 'KPI-сетка',
  description: 'Несколько KPI cashflow в одном блоке: доходы, расходы, баланс, кол-во — независимо настраиваемые ячейки.',
  category: 'stats',
  icon: Wallet,
  iconName: 'Wallet',
  defaultSize: { w: 12, h: 3 },
  minSize: { w: 2, h: 2 },
  minContentSize: { w: 180, h: 80 },
  pages: ['cashflow', 'dashboard', '*'],
  supportsDependencies: false,
  configSchema: ConfigSchema,
  defaultConfig: () => ({
    title: 'Cashflow KPI',
    layout: 'row',
    cells: [
      {
        id: 'c1',
        metric: 'income',
        format: 'rub',
      },
      {
        id: 'c2',
        metric: 'expense',
        format: 'rub',
      },
      {
        id: 'c3',
        metric: 'balance',
        format: 'rub',
      },
    ],
  }),
  SettingsForm: KpiGridSettings,
  Render: RenderKpiGrid,
};
