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
  Lock,
  type LucideIcon,
} from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, SourceBinding } from '../types';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useEffectivePeriod } from '../page-period-context';
import { useBlockPeriod } from '../use-block-period';
import { useEffectiveSource } from '../page-source-context';
import { useBlockValuePublisher } from '../values';
import { useCashflowKpiLite } from '../virtual-sources';
import { useBoundTxFilters, type BoundFilters } from '../use-bound-tx-filters';
import { EmptySourcePlaceholder } from '@/components/blocks/empty-source-placeholder';
import { DEFAULT_SOURCE_BINDING } from '../source-binding';
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

const SourceBindingSchema = z.union([
  z.object({ mode: z.literal('empty') }),
  z.object({ mode: z.literal('global') }),
  z.object({
    mode: z.literal('block'),
    blockId: z.string(),
    pageKey: z.string().optional(),
  }),
]);

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
  /**
   * Per-cell override binding'а. Если задан — приоритет над `defaultSourceBinding`
   * блока. Если undefined — ячейка наследует block-level default.
   */
  sourceBindingOverride: SourceBindingSchema.optional(),
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
  /**
   * Блок-уровневый override периода: используется ячейками, у которых нет
   * собственного `periodOverride`. Если null — ячейки наследуют period страницы.
   */
  defaultPeriodOverride: z
    .object({
      preset: PeriodPresetSchema.default('mtd'),
      customFrom: z.string().nullable().default(null),
      customTo: z.string().nullable().default(null),
    })
    .nullable()
    .optional(),
  /**
   * Блок-уровневый source binding: дефолт для всех ячеек без
   * `sourceBindingOverride`. Если undefined в конфиге — после миграции
   * `sanitizeBlocks` будет `{mode:'block', blockId: <первый tx-блок>}` либо
   * `{mode:'empty'}`. Семантика 3 mode такая же, как у обычных cashflow блоков.
   */
  defaultSourceBinding: SourceBindingSchema.optional(),
});

export type KpiGridConfig = z.infer<typeof ConfigSchema>;
export type KpiGridCell = z.infer<typeof CellSchema>;

function parseConfig(raw: unknown): KpiGridConfig {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  return {
    title: 'KPI',
    layout: 'row',
    cells: [],
    defaultPeriodOverride: null,
    defaultSourceBinding: DEFAULT_SOURCE_BINDING,
  };
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

/**
 * Форматирование значения для display.
 *
 * @param value      — сырое значение (для money-метрик это КОПЕЙКИ из API).
 * @param format     — желаемый формат отображения.
 * @param isMoney    — если true, делим на 100 для всех «денежных» форматов
 *                     (rub / compact). Для percent/number — выводим как есть.
 */
function formatValue(
  value: number | null,
  format: KpiGridCell['format'],
  isMoney: boolean,
): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (format === 'rub') {
    const rubles = isMoney ? value / 100 : value;
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(rubles);
  }
  if (format === 'percent') {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + '%';
  }
  if (format === 'compact') {
    const display = isMoney ? value / 100 : value;
    return new Intl.NumberFormat('ru-RU', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(display);
  }
  // 'number'
  const display = isMoney ? value / 100 : value;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(display);
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

function isMoneyMetric(metric: KpiGridCell['metric']): boolean {
  return metric === 'income' || metric === 'expense' || metric === 'balance';
}

function KpiCellRender({
  cell,
  instanceId,
  defaultPeriodOverride,
  defaultSourceBinding,
  compact,
  onValue,
  onOpenSettings,
}: {
  cell: KpiGridCell;
  instanceId: string;
  /** Block-level fallback override (используется, если у ячейки нет своего periodOverride). */
  defaultPeriodOverride: KpiGridCell['periodOverride'] | null;
  /** Block-level binding (используется, если у ячейки нет sourceBindingOverride). */
  defaultSourceBinding: SourceBinding;
  compact: boolean;
  onValue: (
    cellId: string,
    valueKop: number | null,
    isMoney: boolean,
    label: string,
  ) => void;
  onOpenSettings: () => void;
}) {
  // Эффективный binding: cell.sourceBindingOverride > block-level default.
  const effectiveBinding: SourceBinding =
    cell.sourceBindingOverride !== undefined ? cell.sourceBindingOverride : defaultSourceBinding;
  const boundFilters = useBoundTxFilters(effectiveBinding);

  // Resolve effective period + source: cell.periodOverride > block-level default > page-level.
  const effectiveOverride =
    cell.periodOverride !== undefined ? cell.periodOverride : (defaultPeriodOverride ?? null);
  const { value: pagePeriod } = useEffectivePeriod(
    `${instanceId}:${cell.id}`,
    effectiveOverride ?? null,
  );
  const { value: pageSource } = useEffectiveSource(
    `${instanceId}:${cell.id}`,
    cell.sourceOverride === undefined ? undefined : cell.sourceOverride,
  );

  // Резолвинг binding: 'empty' → skipFetch, 'block' → period+source из источника,
  // 'global' → page-level. ПРИМЕЧАНИЕ: kpi.grid использует `useCashflowKpiLite`,
  // который не поддерживает counterparty/categoryName-фильтры — поэтому из
  // bound фильтров используются только period и source.
  const isBoundMissing =
    effectiveBinding.mode === 'block' && boundFilters?.kind === 'missing';
  const skipFetch = effectiveBinding.mode === 'empty' || isBoundMissing;
  let period = pagePeriod;
  let source: string | null = pageSource;
  if (
    effectiveBinding.mode === 'block' &&
    boundFilters &&
    boundFilters.kind === 'filters'
  ) {
    const f: BoundFilters = boundFilters.filters;
    period = f.period ?? pagePeriod;
    source = f.source === undefined ? pageSource : f.source;
  }
  const liteSource = skipFetch ? null : source;

  // Загружаем все 3 lite-KPI без условий (стабильный порядок hooks).
  // По cell.metric — берём нужное значение из них.
  const incomeKpi = useCashflowKpiLite('income', period, liteSource);
  const expenseKpi = useCashflowKpiLite('expense', period, liteSource);
  const balanceKpi = useCashflowKpiLite('balance', period, liteSource);

  // ВНИМАНИЕ: API возвращает money-метрики в КОПЕЙКАХ.
  // Внутри храним «как есть» (для bindings → __money convention),
  // а делим на 100 только в момент display через formatValue(... isMoney).
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
  const moneyMetric = isMoneyMetric(cell.metric);

  // Дельта % vs previous (если применимо и есть данные).
  // Считается на «сырых» kopecks/count — пропорция не зависит от единицы.
  const deltaPct =
    previous !== null && previous !== 0 && value !== null
      ? ((value - previous) / Math.abs(previous)) * 100
      : null;

  // Публикуем значение наверх для bindings (kopecks для money — отметим __money сверху).
  // ВАЖНО: для empty/missing — публикуем null (а не stale value) чтобы консьюмеры
  // не видели остатков.
  const publishedValue = skipFetch ? null : value;
  useLayoutEffect(() => {
    onValue(cell.id, publishedValue, moneyMetric, label);
  }, [cell.id, publishedValue, moneyMetric, label, onValue]);

  // Empty / missing source → компактный placeholder в стиле ячейки.
  if (skipFetch) {
    return (
      <button
        type="button"
        onClick={onOpenSettings}
        className="flex h-full min-h-0 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border/60 bg-muted/20 p-2 text-center transition-colors hover:border-border hover:bg-muted/40"
        title={
          isBoundMissing
            ? 'Источник был удалён или недоступен. Нажмите, чтобы выбрать другой.'
            : 'Источник не привязан. Нажмите, чтобы выбрать.'
        }
      >
        <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
        <div className="truncate text-[10px] font-medium text-muted-foreground">
          {isBoundMissing ? 'Источник удалён' : 'Нет источника'}
        </div>
        <div className="text-[10px] text-muted-foreground/70 underline-offset-2 group-hover:underline">
          {label}
        </div>
      </button>
    );
  }

  // v0.23: lock-badge для ячейки с per-cell `periodOverride`.
  // Помогает понять, что эта ячейка зависит от своего периода, а не от
  // page-level / block-level periodOverride.
  const cellHasOwnPeriod =
    cell.periodOverride !== undefined && cell.periodOverride !== null;

  return (
    <div className="relative flex h-full min-h-0 flex-col justify-between rounded-md border border-border/50 bg-card/40 p-2">
      {cellHasOwnPeriod && (
        <button
          type="button"
          onClick={onOpenSettings}
          className="absolute right-1 top-1 z-10 inline-flex h-4 items-center gap-0.5 rounded bg-amber-50 px-1 text-[9px] font-medium text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900"
          title="Период этой ячейки не синхронизирован с настройкой страницы. Откройте настройки блока, чтобы изменить."
        >
          <Lock className="h-2.5 w-2.5" />
        </button>
      )}
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
            title={`vs прошлый период: ${previous !== null ? formatValue(previous, cell.format, moneyMetric) : '—'}`}
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
          {formatValue(value, cell.format, moneyMetric)}
        </div>
      </div>
    </div>
  );
}

function openBlockSettings(blockId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('block-open-settings', { detail: { blockId } }),
  );
}

function RenderKpiGrid({ instance }: BlockRenderProps) {
  const config = parseConfig(instance.config);
  const density = useBlockDensity();
  const compact = density === 'xs' || density === 'sm';
  const defaultBinding: SourceBinding = config.defaultSourceBinding ?? DEFAULT_SOURCE_BINDING;
  const onOpenSettings = useCallback(() => openBlockSettings(instance.id), [instance.id]);

  // v0.23: регистрируем block в PagePeriodContext для счётчика overridden /
  // mass-reset. block-level defaultPeriodOverride живёт в config и считается
  // override относительно page-level. Per-cell `cell.periodOverride` —
  // отдельный layer (lock-badge на ячейках).
  const {
    isOverride: isBlockPeriodOverride,
    resetToGlobal: resetBlockPeriod,
  } = useBlockPeriod({
    instanceId: instance.id,
    configOverride: config.defaultPeriodOverride
      ? {
          preset: config.defaultPeriodOverride.preset,
          customFrom: config.defaultPeriodOverride.customFrom ?? null,
          customTo: config.defaultPeriodOverride.customTo ?? null,
        }
      : null,
    defaultMode: 'global',
  });

  // Если block-level binding = empty И ни у одной ячейки нет per-cell
  // override — рисуем единый block-level placeholder.
  const allCellsInheritEmpty =
    defaultBinding.mode === 'empty' &&
    config.cells.every((c) => c.sourceBindingOverride === undefined);

  const [cellValues, setCellValues] = useState<
    Record<string, { value: number | null; isMoney: boolean; label: string }>
  >({});

  const setCellValue = useCallback(
    (id: string, value: number | null, isMoney: boolean, label: string) => {
      setCellValues((prev) => {
        const current = prev[id];
        if (
          current &&
          current.value === value &&
          current.isMoney === isMoney &&
          current.label === label
        )
          return prev;
        return { ...prev, [id]: { value, isMoney, label } };
      });
    },
    [],
  );

  // Publish values: для каждой ячейки — `cells.{id}.value` и `cells.{id}.label`.
  // `__money` помечает money-ячейки (выводимые значения в KOPECKS), чтобы
  // консьюмеры (excel.cell / formula) знали что делить на 100 при отображении.
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
      // Money-метка идёт от METRIC, а не от формата (income/expense/balance —
      // всегда копейки, независимо от того как пользователь хочет их отобразить).
      if (v.isMoney) moneyKeys.push(key);
    });
    out.label = config.title;
    // value по умолчанию — первая ячейка (для удобства бинда).
    if (config.cells[0] && cellValues[config.cells[0].id]) {
      out.value = cellValues[config.cells[0].id].value;
      // Если первая ячейка — money, добавим алиас `value` в __money.
      if (cellValues[config.cells[0].id].isMoney) moneyKeys.push('value');
    }
    out.__money = moneyKeys.join(',');
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

  if (allCellsInheritEmpty) {
    return (
      <Card className={compact ? 'flex h-full flex-col p-2' : 'flex h-full flex-col p-3'}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="truncate text-sm font-medium text-muted-foreground">
            {config.title}
          </div>
        </div>
        <EmptySourcePlaceholder
          title="KPI-сетка"
          subtitle="источник не привязан"
          description="Привяжите блок KPI-сетки к списку операций, чтобы видеть метрики из выбранного среза."
          onOpenSettings={onOpenSettings}
          compact={compact}
          variant="inner"
        />
      </Card>
    );
  }

  return (
    <Card className={compact ? 'flex h-full flex-col p-2' : 'flex h-full flex-col p-3'}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate text-sm font-medium text-muted-foreground">{config.title}</div>
          {isBlockPeriodOverride && (
            <button
              type="button"
              onClick={resetBlockPeriod}
              className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900"
              title="Локальный период этого блока. Клик — вернуться к периоду страницы."
            >
              <Lock className="h-2.5 w-2.5" />
              свой
            </button>
          )}
        </div>
      </div>
      <div className={'min-h-0 flex-1 ' + gridClass}>
        {config.cells.map((cell) => (
          <KpiCellRender
            key={cell.id}
            cell={cell}
            instanceId={instance.id}
            defaultPeriodOverride={config.defaultPeriodOverride ?? null}
            defaultSourceBinding={defaultBinding}
            compact={compact}
            onValue={setCellValue}
            onOpenSettings={onOpenSettings}
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
