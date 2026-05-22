// PURPOSE: Chart block для визуализации cashflow — line/bar/area графики
// доходов, расходов и баланса по дням/неделям/месяцам.
// v0.19.0: использует ChartShell rich + compare overlay + /api/cashflow/chart
// + density-aware adapt + auto-granularity по периоду.
'use client';

import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import { BarChart3, Lock } from 'lucide-react';
import {
  useFormatSettings,
  formatRublesWithSettings,
} from '@/lib/format-settings';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { useBlockDensity, useBlockSize } from '@/components/blocks/block-size';
import { useBlockValuePublisher } from '../values';
import { useEffectivePeriod } from '../page-period-context';
import { useEffectiveSource } from '../page-source-context';
import { usePersistedPeriodWithGlobal } from '../use-persisted-period';
import { usePersistedSourceWithGlobal } from '../use-persisted-source';
import { useBoundTxFilters, type BoundFilters } from '../use-bound-tx-filters';
import { EmptySourcePlaceholder } from '@/components/blocks/empty-source-placeholder';
import { DEFAULT_SOURCE_BINDING } from '../source-binding';
import type { SourceBinding } from '../types';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { ChartShell, type ChartSeries } from '@/components/blocks/chart-shell';
import {
  PeriodPicker,
  type PeriodPreset,
} from '@/components/blocks/period-picker';
import { SOURCE_LABELS } from '@/components/blocks/source-filter-chips';

const SourceBindingSchema = z.union([
  z.object({ mode: z.literal('empty') }),
  z.object({ mode: z.literal('global') }),
  z.object({
    mode: z.literal('block'),
    blockId: z.string(),
    pageKey: z.string().optional(),
  }),
]);

const ChartConfig = z.object({
  chartType: z.enum(['bar', 'line', 'area']).default('area'),
  showIncome: z.boolean().default(true),
  showExpense: z.boolean().default(true),
  showBalance: z.boolean().default(false),
  compare: z.enum(['none', 'prev']).default('none'),
  granularity: z.enum(['auto', 'day', 'week', 'month']).default('auto'),
  title: z.string().optional(),
  periodOverride: z
    .object({
      preset: z.enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom']),
      customFrom: z.string().nullable().optional(),
      customTo: z.string().nullable().optional(),
    })
    .nullable()
    .default(null),
  sourceOverride: z.string().nullable().optional(),
  sourceBinding: SourceBindingSchema.optional(),
});

type Cfg = z.infer<typeof ChartConfig>;

const INCOME_COLOR = '#10b981';
const EXPENSE_COLOR = '#ef4444';
const BALANCE_COLOR = '#3b82f6';

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  '7d': '7 дней',
  '14d': '14 дней',
  '30d': '30 дней',
  mtd: 'Этот месяц',
  custom: 'Произвольный',
};

function formatYAxisRub(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_00) return `${(v / 1_000_000_00).toFixed(1)}М`;
  if (abs >= 1_000_00) return `${Math.round(v / 1_000_00)}к`;
  return String(Math.round(v / 100));
}

function resolveBoundChartContext(
  binding: SourceBinding,
  boundFilters: ReturnType<typeof useBoundTxFilters>,
  pagePeriod: { preset: PeriodPreset; customFrom: string | null; customTo: string | null },
  pageSource: string | null,
):
  | null
  | 'missing'
  | {
      period: { preset: PeriodPreset; customFrom: string | null; customTo: string | null };
      source: string | null;
      counterparty: string | null;
      categoryName: string | null;
    } {
  if (binding.mode !== 'block') return null;
  if (!boundFilters || boundFilters.kind === 'missing') return 'missing';
  const f: BoundFilters = boundFilters.filters;
  const source = f.source === undefined ? pageSource : f.source;
  return {
    period: f.period ?? pagePeriod,
    source: source ?? null,
    counterparty: f.counterparty ?? null,
    categoryName: f.categoryName ?? null,
  };
}

function openBlockSettings(blockId: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('block-open-settings', { detail: { blockId } }),
  );
}

function ChartRender({ instance }: BlockRenderProps) {
  const density = useBlockDensity();
  const { width: blockWidth, height: blockHeight } = useBlockSize();
  const { settings: fmtSettings } = useFormatSettings();
  const cfg = ChartConfig.parse(instance.config ?? {});

  const sourceBinding: SourceBinding = cfg.sourceBinding ?? DEFAULT_SOURCE_BINDING;
  const boundFilters = useBoundTxFilters(sourceBinding);

  const { override, setOverride } = usePersistedPeriodWithGlobal({
    instanceId: instance.id,
    initial:
      cfg.periodOverride === null
        ? { mode: 'global' }
        : {
            mode: 'override',
            preset: cfg.periodOverride.preset,
            customFrom: cfg.periodOverride.customFrom ?? null,
            customTo: cfg.periodOverride.customTo ?? null,
          },
  });
  const { value: pagePeriod, source: periodSource } = useEffectivePeriod(instance.id, override);

  const { override: srcOverride, setOverride: setSrcOverride } = usePersistedSourceWithGlobal({
    instanceId: instance.id,
    initial:
      cfg.sourceOverride !== undefined
        ? { mode: 'override', value: cfg.sourceOverride }
        : { mode: 'global' },
  });
  const { value: pageSource, source: sourceSource } = useEffectiveSource(
    instance.id,
    srcOverride,
  );

  // Резолвинг по binding mode. `block` — берём фильтры из источника
  // (counterparty/categoryName тоже — для них API расширен в Phase 6).
  const bound = resolveBoundChartContext(sourceBinding, boundFilters, pagePeriod, pageSource);
  const skipFetch = sourceBinding.mode === 'empty' || bound === 'missing';
  const period = bound && bound !== 'missing' ? bound.period : pagePeriod;
  const effectiveSource = bound && bound !== 'missing' ? bound.source : pageSource;
  const boundCounterparty = bound && bound !== 'missing' ? bound.counterparty : null;
  const boundCategoryName = bound && bound !== 'missing' ? bound.categoryName : null;

  type ChartPoint = { date: string; income: number; expense: number; balance: number };
  type Resp = {
    ok: boolean;
    granularity: 'day' | 'week' | 'month';
    points: ChartPoint[];
    compare?: ChartPoint[];
  };

  const [resp, setResp] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(skipFetch ? false : true);

  const key = `${skipFetch ? 'skip' : 'go'}|${period.preset}|${period.customFrom}|${period.customTo}|${cfg.compare}|${cfg.granularity}|${effectiveSource ?? ''}|${boundCounterparty ?? ''}|${boundCategoryName ?? ''}`;
  useEffect(() => {
    if (skipFetch) {
      setResp(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({
      preset: period.preset,
      granularity: cfg.granularity,
      compare: cfg.compare,
    });
    if (period.customFrom) params.set('customFrom', period.customFrom);
    if (period.customTo) params.set('customTo', period.customTo);
    if (effectiveSource) params.set('source', effectiveSource);
    if (boundCounterparty) params.set('counterparty', boundCounterparty);
    if (boundCategoryName) params.set('categoryName', boundCategoryName);
    fetch(`/api/cashflow/chart?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((json: Resp) => {
        if (cancelled) return;
        if (json.ok) setResp(json);
        else setResp(null);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || err.name === 'AbortError') return;
        setResp(null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const data = resp?.points ?? [];
  const compareData = resp?.compare ?? null;

  // Publish для computed-блоков
  const totalIncome = useMemo(() => data.reduce((s, p) => s + p.income, 0), [data]);
  const totalExpense = useMemo(() => data.reduce((s, p) => s + p.expense, 0), [data]);
  useBlockValuePublisher(instance.id, {
    value: totalIncome - totalExpense,
    totalIncome,
    totalExpense,
    count: data.length,
    label: instance.appearance?.title ?? cfg.title ?? 'График денежного потока',
    __money: 'value,totalIncome,totalExpense',
    __labels:
      'value=Чистый поток,totalIncome=Доходы,totalExpense=Расходы,count=Кол-во точек',
  });

  const series: ChartSeries[] = [];
  if (cfg.showIncome) {
    series.push({
      key: 'income',
      label: 'Доход',
      color: INCOME_COLOR,
      type: cfg.chartType,
      yAxisId: 'left',
    });
  }
  if (cfg.showExpense) {
    series.push({
      key: 'expense',
      label: 'Расход',
      color: EXPENSE_COLOR,
      type: cfg.chartType,
      yAxisId: 'left',
    });
  }
  if (cfg.showBalance) {
    series.push({
      key: 'balance',
      label: 'Баланс',
      color: BALANCE_COLOR,
      type: 'line',
      yAxisId: 'left',
      strokeWidth: 2,
    });
  }

  const title = instance.appearance?.title ?? cfg.title ?? 'Денежный поток';

  // Adapt narrow / shortH
  const narrow = blockWidth > 0 && blockWidth < 360;
  const shortH = blockHeight > 0 && blockHeight < 200;

  if (sourceBinding.mode === 'empty') {
    return (
      <EmptySourcePlaceholder
        title={`${title}: источник не привязан`}
        onOpenSettings={() => openBlockSettings(instance.id)}
        compact={density === 'xs' || density === 'sm'}
      />
    );
  }
  if (bound === 'missing') {
    return (
      <EmptySourcePlaceholder
        title={`${title}: источник недоступен`}
        description="Привязанный блок «Список операций» был удалён или находится на другой странице."
        onOpenSettings={() => openBlockSettings(instance.id)}
        compact={density === 'xs' || density === 'sm'}
      />
    );
  }

  if (density === 'xs') {
    return (
      <Card className="flex h-full items-center justify-center p-1">
        <div className="text-center">
          <BarChart3 className="mx-auto h-3.5 w-3.5 text-muted-foreground" />
          <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{title}</div>
        </div>
      </Card>
    );
  }

  if (loading && data.length === 0) {
    return (
      <Card className="flex h-full items-center justify-center p-3">
        <div className="text-xs text-muted-foreground">Загрузка…</div>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card className="flex h-full items-center justify-center p-3">
        <div className="space-y-2 text-center">
          <BarChart3 className="mx-auto h-5 w-5 text-muted-foreground" />
          <div className="text-xs text-muted-foreground">
            Нет данных за период {PRESET_LABELS[period.preset as PeriodPreset]}
          </div>
          {periodSource === 'override' && (
            <button
              type="button"
              onClick={() => setOverride(null)}
              className="text-[10px] text-primary underline-offset-2 hover:underline"
            >
              Вернуть глобальный период
            </button>
          )}
        </div>
      </Card>
    );
  }

  const sourceMeta = effectiveSource ? SOURCE_LABELS[effectiveSource] : null;

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden p-3">
      <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
        <h3 className="truncate text-sm font-medium text-muted-foreground">{title}</h3>
        <div className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
          {!shortH && resp?.granularity && (
            <span className="rounded bg-muted px-1.5 py-0.5">
              {resp.granularity === 'day'
                ? 'дни'
                : resp.granularity === 'week'
                  ? 'недели'
                  : 'месяцы'}
            </span>
          )}
          {!narrow && cfg.compare === 'prev' && compareData && (
            <span className="rounded bg-muted px-1.5 py-0.5">vs прошлый</span>
          )}
          {periodSource === 'override' && (
            <button
              type="button"
              className="inline-flex h-4 items-center gap-0.5 rounded bg-amber-50 px-1 text-[9px] font-medium text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:ring-amber-900"
              title="Свой период — клик: вернуть глобальный"
              onClick={() => setOverride(null)}
            >
              <Lock className="h-2.5 w-2.5" />
              {PRESET_LABELS[period.preset as PeriodPreset]}
            </button>
          )}
          {sourceSource === 'override' && (
            <button
              type="button"
              className="inline-flex h-4 items-center gap-0.5 rounded bg-sky-50 px-1 text-[9px] font-medium text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900"
              title="Клик — вернуть глобальный источник"
              onClick={() => setSrcOverride(undefined)}
            >
              <Lock className="h-2.5 w-2.5" />
              {sourceMeta?.label ?? effectiveSource ?? 'Все'}
            </button>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <ChartShell
          data={data}
          series={series}
          xKey="date"
          height="fill"
          variant="rich"
          margin={{
            top: 4,
            right: narrow ? 4 : 8,
            left: narrow ? 0 : 4,
            bottom: 0,
          }}
          compare={compareData ? { data: compareData, suffix: 'прошлый' } : undefined}
          formatY={formatYAxisRub}
          formatTooltipValue={(v) => formatRublesWithSettings(Number(v), fmtSettings.showKopecks)}
        />
      </div>
    </Card>
  );
}

function ChartSettings({ config, onChange }: BlockSettingsFormProps) {
  const cfg = ChartConfig.parse(config ?? {});

  function set<K extends keyof Cfg>(key: K, value: Cfg[K]) {
    onChange({ ...cfg, [key]: value });
  }

  function setOverride(next: Cfg['periodOverride']) {
    onChange({ ...cfg, periodOverride: next });
  }

  const chartTypes: Array<{ value: Cfg['chartType']; label: string }> = [
    { value: 'bar', label: 'Столбцы' },
    { value: 'line', label: 'Линии' },
    { value: 'area', label: 'Область' },
  ];

  const granularityOptions: Array<{ value: Cfg['granularity']; label: string }> = [
    { value: 'auto', label: 'Авто' },
    { value: 'day', label: 'По дням' },
    { value: 'week', label: 'По неделям' },
    { value: 'month', label: 'По месяцам' },
  ];

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Заголовок</Label>
        <input
          type="text"
          value={cfg.title ?? ''}
          onChange={(e) => set('title', e.target.value || undefined)}
          placeholder="Денежный поток"
          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
        />
      </div>

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
          {granularityOptions.map((g) => (
            <button
              key={g.value}
              type="button"
              onClick={() => set('granularity', g.value)}
              className={
                'inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors ' +
                (cfg.granularity === g.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent')
              }
            >
              {g.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Авто: день для ≤31 дн., неделя ≤120 дн., месяц иначе.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Серии данных</Label>
        <div className="space-y-1">
          {(
            [
              { key: 'showIncome' as const, label: 'Доходы', color: INCOME_COLOR },
              { key: 'showExpense' as const, label: 'Расходы', color: EXPENSE_COLOR },
              { key: 'showBalance' as const, label: 'Баланс (накопительный)', color: BALANCE_COLOR },
            ]
          ).map((s) => (
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

      <div className="space-y-1.5">
        <Label>Сравнение</Label>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => set('compare', 'none')}
            className={
              'inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors ' +
              (cfg.compare === 'none'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent')
            }
          >
            Нет
          </button>
          <button
            type="button"
            onClick={() => set('compare', 'prev')}
            className={
              'inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors ' +
              (cfg.compare === 'prev'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-accent')
            }
          >
            vs прошлый период
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Период</Label>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Использовать период страницы</div>
            <div className="text-[11px] text-muted-foreground">
              {cfg.periodOverride === null
                ? 'Период наследуется от страницы'
                : `Свой: ${PRESET_LABELS[cfg.periodOverride.preset]}`}
            </div>
          </div>
          <Switch
            checked={cfg.periodOverride === null}
            onCheckedChange={(v) =>
              setOverride(v ? null : { preset: '30d', customFrom: null, customTo: null })
            }
          />
        </div>
        {cfg.periodOverride !== null && (
          <div className="rounded-md border border-border/60 p-2">
            <PeriodPicker
              value={{
                preset: cfg.periodOverride.preset,
                customFrom: cfg.periodOverride.customFrom ?? null,
                customTo: cfg.periodOverride.customTo ?? null,
              }}
              onChange={(v) =>
                setOverride({
                  preset: v.preset,
                  customFrom: v.customFrom ?? null,
                  customTo: v.customTo ?? null,
                })
              }
            />
          </div>
        )}
      </div>

      <ChartSourceOverrideField
        value={cfg.sourceOverride}
        onChange={(next) => set('sourceOverride', next)}
      />
    </div>
  );
}

function ChartSourceOverrideField({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (next: string | null | undefined) => void;
}) {
  const [sources, setSources] = useState<Array<{ source: string; count: number }>>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/cashflow/meta')
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok && Array.isArray(d.sourcesWithCount)) setSources(d.sourcesWithCount);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const isOverride = value !== undefined;
  return (
    <div className="space-y-1.5">
      <Label>Источник</Label>
      <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs font-medium">Использовать источник страницы</div>
          <div className="text-[11px] text-muted-foreground">
            {!isOverride
              ? 'Источник наследуется от страницы'
              : value === null
                ? 'Свой: все источники'
                : `Свой: ${SOURCE_LABELS[value]?.label ?? value}`}
          </div>
        </div>
        <Switch
          checked={!isOverride}
          onCheckedChange={(v) => onChange(v ? undefined : null)}
        />
      </div>
      {isOverride && sources.length > 0 && (
        <div className="flex flex-wrap gap-1 rounded-md border border-border/60 p-2">
          <button
            type="button"
            onClick={() => onChange(null)}
            className={
              'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] tabular-nums transition ' +
              (value === null
                ? 'border-primary/40 bg-primary/10 text-primary'
                : 'border-border/60 bg-background text-muted-foreground hover:bg-accent/40')
            }
          >
            Все
          </button>
          {sources.map((s) => {
            const meta = SOURCE_LABELS[s.source];
            const Icon = meta?.icon;
            return (
              <button
                key={s.source}
                type="button"
                onClick={() => onChange(s.source)}
                className={
                  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] tabular-nums transition ' +
                  (value === s.source
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border/60 bg-background text-muted-foreground hover:bg-accent/40')
                }
              >
                {Icon ? <Icon className="h-3 w-3" /> : null}
                {meta?.label ?? s.source}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export const CashflowChartBlock: BlockDef = {
  type: 'chart.cashflow',
  displayName: 'График денежного потока',
  description:
    'Line/Bar/Area график доходов, расходов и баланса с compare vs прошлый период',
  category: 'charts',
  icon: BarChart3,
  defaultSize: { w: 8, h: 5 },
  minSize: { w: 3, h: 2 },
  minContentSize: { w: 200, h: 120 },
  pages: ['cashflow', 'dashboard'],
  configSchema: ChartConfig,
  defaultConfig: () => ({
    chartType: 'area',
    showIncome: true,
    showExpense: true,
    showBalance: false,
    compare: 'none',
    granularity: 'auto',
    periodOverride: null,
  }),
  SettingsForm: ChartSettings,
  Render: ChartRender,
};
