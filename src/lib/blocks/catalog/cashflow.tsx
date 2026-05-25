// PURPOSE: Каталог блоков для страницы Cashflow (income/expense/balance/top-cats/list).
// Полностью переработан в v0.19.0: StatCard + sparkline + trend + drill-down,
// per-block period override (lock-иконка), интеграция с PagePeriodContext,
// virtualized transactions list с cursor pagination + CSV export.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  Wallet,
  ListOrdered,
  BarChart3,
  Pencil,
  Trash2,
  Lock,
  Globe,
  ChevronRight,
  Download,
  Filter,
  X,
  Info,
} from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
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
import { useBlockValuePublisher, formatPeriodKey } from '../values';
import { useEffectivePeriod } from '../page-period-context';
import { useBlockPeriod } from '../use-block-period';
import { useEffectiveSource } from '../page-source-context';
import { usePersistedPeriodWithGlobal } from '../use-persisted-period';
import { usePersistedSourceWithGlobal } from '../use-persisted-source';
import { useDrillDown, type DrillDownFilter } from '../drill-down';
import { useBoundTxFilters, type BoundFilters } from '../use-bound-tx-filters';
import { EmptySourcePlaceholder } from '@/components/blocks/empty-source-placeholder';
import { DEFAULT_SOURCE_BINDING } from '../source-binding';
import type { SourceBinding } from '../types';
import { SOURCE_LABELS } from '@/components/blocks/source-filter-chips';
import {
  PeriodPicker,
  resolvePeriod,
  type PeriodPreset,
} from '@/components/blocks/period-picker';
import { StatCard, type StatCardDelta } from '@/components/blocks/stat-card';
import { useVirtualizer } from '@tanstack/react-virtual';

// ============================================================================
// Period helpers (per-block override + page-level)
// ============================================================================

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  '7d': '7 дней',
  '14d': '14 дней',
  '30d': '30 дней',
  mtd: 'Этот месяц',
  custom: 'Произвольный',
};

function describePeriodShort(preset: PeriodPreset, from: string | null, to: string | null): string {
  if (preset === 'custom' && from && to) return `${from} → ${to}`;
  return PRESET_LABELS[preset] ?? preset;
}

// ============================================================================
// Shared KPI config schema
// ============================================================================

const SourceBindingSchema = z.union([
  z.object({ mode: z.literal('empty') }),
  z.object({ mode: z.literal('global') }),
  z.object({
    mode: z.literal('block'),
    blockId: z.string(),
    pageKey: z.string().optional(),
  }),
]);

const KpiConfig = z.object({
  showKopecks: z.boolean().nullable().default(null),
  /** Заголовок (override appearance.title). */
  title: z.string().optional(),
  /** Per-block override периода. null = listen page-level. */
  periodOverride: z
    .object({
      preset: z.enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom']),
      customFrom: z.string().nullable().optional(),
      customTo: z.string().nullable().optional(),
    })
    .nullable()
    .default(null),
  /**
   * Per-block source override.
   *   - `undefined` (omitted) → блок слушает page-level source.
   *   - `null` → блок явно «все источники» (override).
   *   - `string` → конкретный source ('bank' / 'manual' / ...).
   */
  sourceOverride: z.string().nullable().optional(),
  /**
   * Привязка к блоку-источнику (cashflow.transactions). См. `SourceBinding`
   * в `src/lib/blocks/types.ts`. Дефолт для НОВЫХ блоков — `{mode:'empty'}`;
   * `sanitizeBlocks` миграция авто-биндит legacy блоки к первому tx-блоку
   * на странице. В режиме `block` фильтры наследуются из __txFilters
   * источника; в `global` — текущая логика; в `empty` — placeholder.
   */
  sourceBinding: SourceBindingSchema.optional(),
});

function useKpiKopecks(showKopecksFromCfg: boolean | null): boolean {
  const { settings } = useFormatSettings();
  return showKopecksFromCfg ?? settings.showKopecks;
}

// ============================================================================
// useCashflowKpi — fetch KPI с current/previous/byDay
// ============================================================================

type KpiFetchResult = {
  current: number;
  previous: number;
  count: number;
  prevCount: number;
  deltaPct: number | null;
  byDay: Array<{ date: string; value: number }>;
};

type KpiWithHint = KpiFetchResult & {
  /** Если current+previous=0 за период, но за всё время есть данные — здесь allTimeTotal в копейках. */
  hintAllTime: number | null;
  /** Кол-во операций за всё время (если current=0). */
  hintAllTimeCount: number | null;
};

function useCashflowKpi(
  metric: 'income' | 'expense' | 'balance',
  period: { preset: PeriodPreset; customFrom: string | null; customTo: string | null },
  filters: { counterparty?: string; categoryName?: string; source?: string | null } = {},
): { data: KpiWithHint | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<KpiWithHint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sourceKey = filters.source ?? '';
  const cacheKey = `${metric}|${period.preset}|${period.customFrom}|${period.customTo}|${filters.counterparty ?? ''}|${filters.categoryName ?? ''}|${sourceKey}`;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    function buildParams(presetVal: PeriodPreset, customFrom?: string | null, customTo?: string | null) {
      const params = new URLSearchParams({ metric, preset: presetVal });
      if (customFrom) params.set('customFrom', customFrom);
      if (customTo) params.set('customTo', customTo);
      if (filters.counterparty) params.set('counterparty', filters.counterparty);
      if (filters.categoryName) params.set('categoryName', filters.categoryName);
      if (filters.source) params.set('source', filters.source);
      return params;
    }

    async function go() {
      try {
        const params = buildParams(period.preset, period.customFrom, period.customTo);
        const res = await fetch(`/api/cashflow/kpi?${params.toString()}`, { signal: controller.signal });
        const json = await res.json();
        if (cancelled) return;
        if (!json.ok) {
          setError(json.error ?? 'Ошибка загрузки');
          setLoading(false);
          return;
        }
        const base: KpiFetchResult = {
          current: json.current,
          previous: json.previous,
          count: json.count,
          prevCount: json.prevCount,
          deltaPct: json.deltaPct,
          byDay: json.byDay ?? [],
        };

        // Smart hint: если текущий и предыдущий = 0 для income/expense
        // (для balance = 0 не значит «нет данных»),
        // делаем фоновый fetch за «всё время» (1y), чтобы предложить пользователю.
        const needsHint =
          metric !== 'balance' &&
          base.current === 0 &&
          base.previous === 0 &&
          period.preset !== 'custom';

        if (!needsHint) {
          setData({ ...base, hintAllTime: null, hintAllTimeCount: null });
          setLoading(false);
          return;
        }

        // Получаем agg за «всё время» через большой custom-период (последние 5 лет).
        const now = new Date();
        const fiveYearsAgo = new Date(now.getTime());
        fiveYearsAgo.setFullYear(now.getFullYear() - 5);
        const longParams = buildParams(
          'custom',
          fiveYearsAgo.toISOString().slice(0, 10),
          now.toISOString().slice(0, 10),
        );
        const longRes = await fetch(`/api/cashflow/kpi?${longParams.toString()}`, {
          signal: controller.signal,
        });
        const longJson = await longRes.json();
        if (cancelled) return;
        if (longJson.ok && longJson.current > 0) {
          setData({
            ...base,
            hintAllTime: longJson.current,
            hintAllTimeCount: longJson.count,
          });
        } else {
          setData({ ...base, hintAllTime: null, hintAllTimeCount: null });
        }
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const e = err as Error;
        if (e.name === 'AbortError') return;
        setError(String(err));
        setLoading(false);
      }
    }

    void go();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return { data, loading, error };
}

// ============================================================================
// KPI Blocks: stat.income / stat.expense / stat.balance
// ============================================================================

/**
 * Резолвит binding в эффективный fetch-context (период / источник / прочие фильтры).
 * Возвращает:
 *   - `null`        — binding не `block` → consumer использует page-level (global mode).
 *   - `'missing'`   — binding указывает на удалённый/cross-page блок без локального состояния.
 *   - { period, source, counterparty, categoryName } — резолвированные фильтры.
 *
 * Для `block` mode: period источника применяется в приоритете над page-period;
 * если источник не задал period — наследуем pagePeriod.
 */
function resolveBoundContext(args: {
  binding: SourceBinding;
  boundFilters: ReturnType<typeof useBoundTxFilters>;
  pagePeriod: { preset: PeriodPreset; customFrom: string | null; customTo: string | null };
  pageSource: string | null;
}):
  | null
  | 'missing'
  | {
      period: { preset: PeriodPreset; customFrom: string | null; customTo: string | null };
      source: string | null;
      counterparty: string | null;
      categoryName: string | null;
    } {
  if (args.binding.mode !== 'block') return null;
  if (!args.boundFilters || args.boundFilters.kind === 'missing') return 'missing';
  const f: BoundFilters = args.boundFilters.filters;
  const period = f.period ?? args.pagePeriod;
  // source:
  //   - undefined  → наследуем page source (тот же эффект, что у global)
  //   - null       → явно «все источники»
  //   - string     → конкретный source
  const source = f.source === undefined ? args.pageSource : f.source;
  return {
    period,
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

function StatKpiBlock(props: {
  instance: BlockRenderProps['instance'];
  metric: 'income' | 'expense' | 'balance';
  defaultTitle: string;
  defaultIcon: import('lucide-react').LucideIcon;
  defaultAccent: string;
  drillType?: 'income' | 'expense';
  goodDirection?: 'up' | 'down';
}) {
  const { instance, metric, defaultTitle, defaultIcon, defaultAccent, drillType, goodDirection } = props;
  const cfg = KpiConfig.parse(instance.config ?? {});
  const { Icon, animClass } = resolveIconWithAnimation(instance.appearance?.icon, defaultIcon);
  void animClass; // icon size слишком мал для анимации, оставляем без animClass
  const accent = instance.appearance?.accentColor ?? defaultAccent;
  const showKopecks = useKpiKopecks(cfg.showKopecks);
  const density = useBlockDensity();
  const drill = useDrillDown();

  // Source binding (cashflow.transactions → этот KPI). Если undefined в config —
  // считаем `{empty}` (миграция sanitizeBlocks уже расставила для legacy).
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

  const { override: sourceOverride, setOverride: setSourceOverride } = usePersistedSourceWithGlobal({
    instanceId: instance.id,
    initial:
      cfg.sourceOverride !== undefined
        ? { mode: 'override', value: cfg.sourceOverride }
        : { mode: 'global' },
  });
  const { value: pageSource, source: sourceSource } = useEffectiveSource(
    instance.id,
    sourceOverride,
  );

  // Резолвинг эффективного периода/source по mode binding:
  //   - empty   → не делаем fetch, рендерим placeholder.
  //   - global  → текущая логика (pagePeriod + pageSource).
  //   - block   → фильтры из источника + merge с pagePeriod (если bound block
  //               не задал собственный period — наследуем page-level).
  const resolved = resolveBoundContext({
    binding: sourceBinding,
    boundFilters,
    pagePeriod,
    pageSource,
  });

  const skipFetch = sourceBinding.mode === 'empty' || resolved === 'missing';
  const period = resolved && resolved !== 'missing' ? resolved.period : pagePeriod;
  const effectiveSource = resolved && resolved !== 'missing' ? resolved.source : pageSource;

  const extraFilters: { counterparty?: string; categoryName?: string } =
    resolved && resolved !== 'missing'
      ? {
          counterparty: resolved.counterparty ?? undefined,
          categoryName: resolved.categoryName ?? undefined,
        }
      : {};

  const fetchedKpi = useCashflowKpi(skipFetch ? 'balance' : metric, period, {
    source: effectiveSource ?? undefined,
    counterparty: extraFilters.counterparty,
    categoryName: extraFilters.categoryName,
  });
  const data = skipFetch ? null : fetchedKpi.data;
  const loading = skipFetch ? false : fetchedKpi.loading;
  const valueKop = data?.current ?? 0;
  const valueRub = valueKop / 100;
  const title = instance.appearance?.title ?? cfg.title ?? defaultTitle;

  useBlockValuePublisher(instance.id, {
    value: valueKop,
    valuePrev: data?.previous ?? 0,
    deltaPct: data?.deltaPct ?? 0,
    count: data?.count ?? 0,
    label: title,
    __money: 'value,valuePrev',
    __labels: `value=Сумма за период,valuePrev=Прошлый период,deltaPct=Изменение %,count=Кол-во операций`,
    __periodKey: formatPeriodKey(period),
  });

  const delta: StatCardDelta | null =
    data && data.deltaPct !== null && data.previous !== 0
      ? {
          value: data.deltaPct,
          label: 'vs прошлый период',
          tooltip: `${formatRublesWithSettings(data.previous, showKopecks)} → ${formatRublesWithSettings(data.current, showKopecks)}`,
          goodDirection,
        }
      : null;

  const sparkline =
    data?.byDay && data.byDay.length > 1
      ? data.byDay.map((d) => d.value / 100)
      : null;

  const sourceMeta = effectiveSource ? SOURCE_LABELS[effectiveSource] : null;
  const sourceLabel = sourceMeta?.label ?? effectiveSource ?? null;

  function handleDrill(e?: React.MouseEvent) {
    if (!drillType) return;
    e?.stopPropagation();
    drill.setFocus({
      blockType: 'cashflow.transactions',
      filter: {
        type: drillType,
        source: effectiveSource ?? undefined,
      },
    });
  }

  // Early return: empty / missing — рендер placeholder вместо данных.
  if (sourceBinding.mode === 'empty') {
    return (
      <EmptySourcePlaceholder
        title={title}
        subtitle="источник не привязан"
        onOpenSettings={() => openBlockSettings(instance.id)}
        compact={density === 'xs' || density === 'sm'}
      />
    );
  }
  if (resolved === 'missing') {
    return (
      <EmptySourcePlaceholder
        title={title}
        subtitle="источник недоступен"
        description="Привязанный блок «Список операций» был удалён или находится на другой странице."
        onOpenSettings={() => openBlockSettings(instance.id)}
        compact={density === 'xs' || density === 'sm'}
      />
    );
  }

  // === XS density: только иконка + число ===
  if (density === 'xs') {
    return (
      <Card
        className={
          'flex h-full flex-col items-center justify-center gap-0.5 p-2 transition ' +
          (drillType ? 'cursor-pointer hover:ring-1 hover:ring-primary/30' : '')
        }
        onClick={handleDrill}
      >
        <div className="flex items-center gap-1">
          <Icon className="h-3 w-3 shrink-0" style={{ color: accent }} />
          <span
            className="truncate text-[15px] font-semibold tabular-nums leading-none tracking-tight"
            style={{ color: accent }}
            title={`${title}: ${formatRublesWithSettings(Math.abs(valueKop), showKopecks)}`}
          >
            {loading ? '—' : formatCompactRubles(valueKop)}
          </span>
        </div>
      </Card>
    );
  }

  // === SM/MD/LG: single Card → StatCard inner ===
  const showSparkline = density === 'lg' && sparkline;
  const showHint = data && density !== 'sm';
  const noDataInPeriod = !loading && data && data.current === 0 && data.previous === 0;

  return (
    <Card
      className={
        'group/kpi relative flex h-full min-h-0 flex-col p-3 transition ' +
        (drillType ? 'cursor-pointer hover:ring-1 hover:ring-primary/30' : '')
      }
      onClick={handleDrill}
    >
      {/* badges row: lock period + source override */}
      {(periodSource === 'override' || sourceSource === 'override') && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
          {periodSource === 'override' && (
            <button
              type="button"
              className="inline-flex h-4 items-center gap-0.5 rounded bg-amber-50 px-1 text-[9px] font-medium text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:ring-amber-900"
              title={`Период: ${describePeriodShort(period.preset as PeriodPreset, period.customFrom, period.customTo)}. Клик — вернуть глобальный.`}
              onClick={(e) => {
                e.stopPropagation();
                setOverride(null);
              }}
            >
              <Lock className="h-2.5 w-2.5" />
              {PRESET_LABELS[period.preset as PeriodPreset]}
            </button>
          )}
          {sourceSource === 'override' && (
            <button
              type="button"
              className="inline-flex h-4 items-center gap-0.5 rounded bg-sky-50 px-1 text-[9px] font-medium text-sky-700 ring-1 ring-sky-200 transition hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900"
              title={`Источник: ${sourceLabel ?? 'Все'}. Клик — вернуть глобальный.`}
              onClick={(e) => {
                e.stopPropagation();
                setSourceOverride(undefined);
              }}
            >
              <Lock className="h-2.5 w-2.5" />
              {sourceLabel ?? 'Все'}
            </button>
          )}
        </div>
      )}

      <StatCard
        variant="inner"
        icon={Icon}
        iconColor={accent}
        label={title}
        value={valueRub}
        format="rub"
        delta={delta}
        sparkline={showSparkline ? sparkline : null}
        loading={loading}
        accent={accent === '#16a34a' ? 'emerald' : accent === '#dc2626' ? 'rose' : 'sky'}
        tone={metric === 'balance' ? (valueRub >= 0 ? 'positive' : 'negative') : 'default'}
        hint={
          showHint && data && !noDataInPeriod
            ? `${data.count} опер.${sourceMeta ? ' · ' + sourceMeta.label : ''}`
            : undefined
        }
      />

      {/* smart-hint: «нет за период, но есть за всё время» */}
      {noDataInPeriod && data?.hintAllTime != null && data.hintAllTime > 0 && (
        <div className="mt-1 flex shrink-0 items-center gap-1 rounded-md bg-amber-50/60 px-1.5 py-1 text-[10px] text-amber-800 ring-1 ring-amber-100 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900">
          <Info className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">
            За «{PRESET_LABELS[period.preset as PeriodPreset]}» — пусто. Всего:{' '}
            <strong>{formatRublesWithSettings(data.hintAllTime, false)}</strong>
            {data.hintAllTimeCount ? ` · ${data.hintAllTimeCount} опер.` : ''}
          </span>
        </div>
      )}
    </Card>
  );
}

function formatCompactRubles(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_00) return `${(abs / 1_000_000_00).toFixed(1)}М₽`;
  if (abs >= 1_000_00) return `${(abs / 1_000_00).toFixed(0)}к₽`;
  const rubles = Math.round(abs / 100);
  return `${new Intl.NumberFormat('ru-RU').format(rubles)} ₽`;
}

function RenderIncome({ instance }: BlockRenderProps) {
  return (
    <StatKpiBlock
      instance={instance}
      metric="income"
      defaultTitle="Доходы"
      defaultIcon={ArrowDown}
      defaultAccent="#16a34a"
      drillType="income"
      goodDirection="up"
    />
  );
}

function RenderExpense({ instance }: BlockRenderProps) {
  return (
    <StatKpiBlock
      instance={instance}
      metric="expense"
      defaultTitle="Расходы"
      defaultIcon={ArrowUp}
      defaultAccent="#dc2626"
      drillType="expense"
      goodDirection="down"
    />
  );
}

function RenderBalance({ instance }: BlockRenderProps) {
  return (
    <StatKpiBlock
      instance={instance}
      metric="balance"
      defaultTitle="Баланс"
      defaultIcon={Wallet}
      defaultAccent="#3b82f6"
      goodDirection="up"
    />
  );
}

// ============================================================================
// Shared SettingsForm для stat.income/stat.expense/stat.balance
// ============================================================================

function KpiSettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const cfg = KpiConfig.parse(config ?? {});

  function setOverride(next: typeof cfg.periodOverride) {
    onChange({ ...cfg, periodOverride: next });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Заголовок</Label>
        <Input
          placeholder="Например: Доходы за месяц"
          value={cfg.title ?? ''}
          onChange={(e) => onChange({ ...cfg, title: e.target.value || undefined })}
        />
      </div>

      <div className="space-y-1.5">
        <Label>Период</Label>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Использовать период страницы</div>
            <div className="text-[11px] text-muted-foreground">
              {cfg.periodOverride === null
                ? 'Период наследуется от страницы (Globe)'
                : `Свой: ${PRESET_LABELS[cfg.periodOverride.preset]}`}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Globe className="h-3 w-3 text-muted-foreground" />
            <Switch
              checked={cfg.periodOverride === null}
              onCheckedChange={(v) =>
                setOverride(v ? null : { preset: 'mtd', customFrom: null, customTo: null })
              }
            />
          </div>
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

      <SourceOverrideSection
        value={cfg.sourceOverride}
        onChange={(next) => onChange({ ...cfg, sourceOverride: next })}
      />

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
  description: 'Сумма поступлений с trend и sparkline',
  category: 'stats',
  icon: ArrowDown,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 1, h: 1 },
  minContentSize: { w: 80, h: 40 },
  pages: ['cashflow', 'dashboard'],
  configSchema: KpiConfig,
  defaultConfig: () => ({ showKopecks: null, periodOverride: null }),
  SettingsForm: KpiSettingsForm,
  Render: RenderIncome,
};

export const StatExpenseBlock: BlockDef = {
  type: 'stat.expense',
  displayName: 'Расходы (KPI)',
  description: 'Сумма расходов с trend и sparkline',
  category: 'stats',
  icon: ArrowUp,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 1, h: 1 },
  minContentSize: { w: 80, h: 40 },
  pages: ['cashflow', 'dashboard'],
  configSchema: KpiConfig,
  defaultConfig: () => ({ showKopecks: null, periodOverride: null }),
  SettingsForm: KpiSettingsForm,
  Render: RenderExpense,
};

export const StatBalanceBlock: BlockDef = {
  type: 'stat.balance',
  displayName: 'Баланс (KPI)',
  description: 'Доходы − расходы с trend и sparkline',
  category: 'stats',
  icon: Wallet,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 1, h: 1 },
  minContentSize: { w: 80, h: 40 },
  pages: ['cashflow', 'dashboard'],
  configSchema: KpiConfig,
  defaultConfig: () => ({ showKopecks: null, periodOverride: null }),
  SettingsForm: KpiSettingsForm,
  Render: RenderBalance,
};

// ============================================================================
// cashflow.top-categories — категории за период с drill-down
// ============================================================================

const TopCatsConfig = z.object({
  type: z.enum(['income', 'expense']).default('expense'),
  title: z.string().optional(),
  limit: z.number().int().min(1).max(20).default(5),
  showKopecks: z.boolean().nullable().default(null),
  periodOverride: KpiConfig.shape.periodOverride,
  sourceOverride: z.string().nullable().optional(),
  sourceBinding: SourceBindingSchema.optional(),
});

type TopCatsCfg = z.infer<typeof TopCatsConfig>;

function useTopCategoriesPeriod(
  type: 'income' | 'expense',
  period: { preset: PeriodPreset; customFrom: string | null; customTo: string | null },
  limit: number,
  source: string | null = null,
): {
  rows: Array<{ categoryName: string; total: number; count: number }>;
  totalSum: number;
  loading: boolean;
} {
  const [rows, setRows] = useState<Array<{ categoryName: string; total: number; count: number }>>([]);
  const [totalSum, setTotalSum] = useState(0);
  const [loading, setLoading] = useState(true);

  const cacheKey = `${type}|${limit}|${period.preset}|${period.customFrom}|${period.customTo}|${source ?? ''}`;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    const resolved = resolvePeriod(
      period.preset,
      period.customFrom ?? undefined,
      period.customTo ?? undefined,
    );
    const params = new URLSearchParams({
      type,
      limit: String(limit),
      from: resolved.from.toISOString(),
      to: resolved.to.toISOString(),
    });
    if (source) params.set('source', source);
    fetch(`/api/cashflow/top-categories?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok) {
          setRows(json.rows ?? []);
          setTotalSum(json.totalSum ?? 0);
        } else {
          setRows([]);
          setTotalSum(0);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || err.name === 'AbortError') return;
        setRows([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  return { rows, totalSum, loading };
}

function RenderTopCategories({ instance }: BlockRenderProps) {
  const cfg = TopCatsConfig.parse(instance.config ?? {});
  const density = useBlockDensity();
  const { settings } = useFormatSettings();
  const showKopecks = cfg.showKopecks ?? settings.showKopecks;
  const fmt = (v: number) => formatRublesWithSettings(v, showKopecks);
  const drill = useDrillDown();

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

  const resolved = resolveBoundContext({
    binding: sourceBinding,
    boundFilters,
    pagePeriod,
    pageSource,
  });
  const skipFetch = sourceBinding.mode === 'empty' || resolved === 'missing';
  const period = resolved && resolved !== 'missing' ? resolved.period : pagePeriod;
  const effectiveSource = resolved && resolved !== 'missing' ? resolved.source : pageSource;

  const { rows, totalSum, loading: fetchLoading } = useTopCategoriesPeriod(
    cfg.type,
    period,
    cfg.limit,
    skipFetch ? null : effectiveSource ?? null,
  );
  const loading = skipFetch ? false : fetchLoading;

  const densityLimit =
    density === 'xs' ? 1 : density === 'sm' ? 3 : density === 'md' ? cfg.limit : cfg.limit;
  const sliced = rows.slice(0, Math.min(cfg.limit, densityLimit));
  const max = sliced.length > 0 ? Math.max(...sliced.map((r) => r.total)) : 1;
  const sum = totalSum > 0 ? totalSum : sliced.reduce((s, r) => s + r.total, 0);

  const accent =
    instance.appearance?.accentColor ?? (cfg.type === 'income' ? '#10b981' : '#ef4444');
  const title =
    instance.appearance?.title ??
    cfg.title ??
    (cfg.type === 'income' ? 'Топ доходов' : 'Топ расходов');

  useBlockValuePublisher(instance.id, {
    value: sum,
    count: sliced.length,
    categories: sliced.map((r) => r.categoryName).join(','),
    label: title,
    __money: 'value',
    __labels: 'value=Сумма топ-категорий,count=Количество категорий,categories=Имена категорий',
  });

  function handleCategoryClick(categoryName: string) {
    drill.setFocus({
      blockType: 'cashflow.transactions',
      filter: { type: cfg.type, categoryName, source: effectiveSource ?? undefined },
    });
  }

  const isCompact = density === 'xs' || density === 'sm';

  if (sourceBinding.mode === 'empty') {
    return (
      <EmptySourcePlaceholder
        title={title}
        subtitle="источник не привязан"
        onOpenSettings={() => openBlockSettings(instance.id)}
        compact={isCompact}
      />
    );
  }
  if (resolved === 'missing') {
    return (
      <EmptySourcePlaceholder
        title={title}
        subtitle="источник недоступен"
        description="Привязанный блок «Список операций» был удалён или находится на другой странице."
        onOpenSettings={() => openBlockSettings(instance.id)}
        compact={isCompact}
      />
    );
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden p-3">
      <div className={'mb-2 flex shrink-0 items-center justify-between gap-2'}>
        <h3 className={isCompact ? 'truncate text-xs font-semibold' : 'truncate text-sm font-medium text-muted-foreground'}>
          {title}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          {periodSource === 'override' && !isCompact && (
            <button
              type="button"
              onClick={() => setOverride(null)}
              className="inline-flex h-4 items-center gap-0.5 rounded bg-amber-50 px-1 text-[9px] font-medium text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:ring-amber-900"
              title="Клик — вернуть глобальный период"
            >
              <Lock className="h-2.5 w-2.5" />
              {PRESET_LABELS[period.preset as PeriodPreset]}
            </button>
          )}
          {sourceSource === 'override' && !isCompact && (
            <button
              type="button"
              onClick={() => setSrcOverride(undefined)}
              className="inline-flex h-4 items-center gap-0.5 rounded bg-sky-50 px-1 text-[9px] font-medium text-sky-700 ring-1 ring-sky-200 transition hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900"
              title="Клик — вернуть глобальный источник"
            >
              <Lock className="h-2.5 w-2.5" />
              {effectiveSource ? SOURCE_LABELS[effectiveSource]?.label ?? effectiveSource : 'Все'}
            </button>
          )}
        </div>
      </div>
      <div className={'flex-1 min-h-0 space-y-2 overflow-y-auto ' + (isCompact ? 'space-y-1' : '')}>
        {loading ? (
          <p className="text-xs text-muted-foreground">Загрузка…</p>
        ) : sliced.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-4 text-center">
            <p className="text-xs text-muted-foreground">
              Нет данных за «{PRESET_LABELS[period.preset as PeriodPreset]}»
            </p>
            <p className="text-[10px] text-muted-foreground/70">
              {cfg.type === 'income'
                ? 'Поступлений за этот период не было'
                : 'Расходов за этот период не было'}
            </p>
          </div>
        ) : (
          sliced.map((r) => {
            const pctOfTotal = sum > 0 ? Math.round((r.total / sum) * 100) : 0;
            return (
              <button
                key={r.categoryName}
                type="button"
                className="block w-full space-y-1 rounded-md p-1 text-left transition-colors hover:bg-accent/30"
                onClick={() => handleCategoryClick(r.categoryName)}
                title={`Клик: показать операции категории ${r.categoryName}`}
              >
                <div
                  className={`flex items-center justify-between gap-2 ${isCompact ? 'text-[11px]' : 'text-sm'}`}
                >
                  <span className="truncate font-medium">{r.categoryName}</span>
                  <span className="flex shrink-0 items-center gap-1 tabular-nums text-muted-foreground">
                    {isCompact ? formatCompactRubles(r.total) : fmt(r.total)}
                    {!isCompact && (
                      <span className="text-[10px] text-muted-foreground/60">({pctOfTotal}%)</span>
                    )}
                    <ChevronRight className="h-3 w-3 text-muted-foreground/40" />
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
              </button>
            );
          })
        )}
      </div>
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
  function setOverride(next: TopCatsCfg['periodOverride']) {
    onChange({ ...cfg, periodOverride: next });
  }
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Что показывать</Label>
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
        <Label>
          Количество строк: <span className="tabular-nums">{cfg.limit}</span>
        </Label>
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
              setOverride(v ? null : { preset: 'mtd', customFrom: null, customTo: null })
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

      <SourceOverrideSection
        value={cfg.sourceOverride}
        onChange={(next) => onChange({ ...cfg, sourceOverride: next })}
      />

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

// ============================================================================
// Shared SourceOverrideSection — UI для override source в Settings блоков
// ============================================================================

function SourceOverrideSection({
  value,
  onChange,
}: {
  /** `undefined` = global (по умолчанию), `null` = override "Все", string = конкретный. */
  value: string | null | undefined;
  onChange: (next: string | null | undefined) => void;
}) {
  const isOverride = value !== undefined;
  return (
    <div className="space-y-1.5">
      <Label>Источник</Label>
      <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
        <div className="min-w-0">
          <div className="text-xs font-medium">Использовать источник страницы</div>
          <div className="text-[11px] text-muted-foreground">
            {!isOverride
              ? 'Источник наследуется от страницы (Globe)'
              : value === null
                ? 'Свой: все источники'
                : `Свой: ${SOURCE_LABELS[value]?.label ?? value}`}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Globe className="h-3 w-3 text-muted-foreground" />
          <Switch
            checked={!isOverride}
            onCheckedChange={(v) => onChange(v ? undefined : null)}
          />
        </div>
      </div>
      {isOverride && (
        <div className="rounded-md border border-border/60 p-2">
          <SourceFilterChipsSettings value={value ?? null} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

// Re-export wrapper: SourceFilterChips ожидает (null | string) → (null | string),
// здесь добавляем обёртку для override === null|string (но не undefined).
function SourceFilterChipsSettings({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  // Динамический импорт компонента (через прямой require, чтобы избежать циклов)
  return <InlineSourceChips value={value} onChange={onChange} />;
}

function InlineSourceChips({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
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

  if (sources.length === 0) {
    return <p className="text-[11px] text-muted-foreground">Источники появятся после импорта операций</p>;
  }

  return (
    <div className="flex flex-wrap gap-1">
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
            <span className="opacity-50">{s.count}</span>
          </button>
        );
      })}
    </div>
  );
}

export const TopCategoriesBlock: BlockDef = {
  type: 'cashflow.top-categories',
  displayName: 'Топ категорий',
  description: 'Топ категорий с долей от общего, drill-down кликом',
  category: 'charts',
  icon: BarChart3,
  defaultSize: { w: 6, h: 4 },
  minSize: { w: 2, h: 2 },
  minContentSize: { w: 180, h: 120 },
  pages: ['cashflow', 'dashboard'],
  configSchema: TopCatsConfig,
  defaultConfig: () => ({ type: 'expense', limit: 5, showKopecks: null, periodOverride: null }),
  SettingsForm: TopCategoriesSettings,
  Render: RenderTopCategories,
};

// ============================================================================
// cashflow.transactions — список с filters / virtualization / cursor pagination / CSV export
// ============================================================================

const TxListConfig = z.object({
  pageSize: z.number().int().min(20).max(500).default(100),
  title: z.string().optional(),
  showKopecks: z.boolean().nullable().default(null),
  /**
   * Вид-определяющие фильтры (default*). Они одновременно: (а) инициализируют
   * runtime-фильтры в UI блока на mount; (б) определяют его «view» для
   * консьюмеров через `__txFilters` publish. Runtime-изменения юзером —
   * ephemeral и не меняют bindings.
   */
  defaultType: z.enum(['all', 'income', 'expense']).default('all'),
  /** Период «view» этого блока. null = page-level. */
  defaultPeriodOverride: z
    .object({
      preset: z.enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom']),
      customFrom: z.string().nullable().optional(),
      customTo: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  /**
   * Source «view». `undefined` (omitted) → page-level, `null` → все источники
   * явно, `string` → конкретный source.
   */
  defaultSourceOverride: z.string().nullable().optional(),
  /** Категория «view» (точное имя). */
  defaultCategoryName: z.string().optional(),
  /** Контрагент «view» (подстрока). */
  defaultCounterparty: z.string().optional(),
});

type TxRow = CashflowTx & { categoryName?: string | null };

function exportToCsv(rows: TxRow[], showKopecks: boolean): void {
  const header = ['Дата', 'Тип', 'Сумма (руб)', 'Контрагент', 'Категория', 'Описание', 'Источник'];
  const lines = [header.join(',')];
  rows.forEach((r) => {
    const amountRub = (r.amount / 100).toFixed(showKopecks ? 2 : 0);
    const fields = [
      formatDate(r.occurredAt),
      r.type === 'income' ? 'Доход' : 'Расход',
      amountRub,
      r.counterparty ?? '',
      r.categoryName ?? '',
      r.description ?? '',
      r.source ?? '',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`);
    lines.push(fields.join(','));
  });
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `transactions-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const VIRTUAL_THRESHOLD = 100;
const VIRTUAL_ROW_HEIGHT = 44;

function RenderTransactionsList({ instance }: BlockRenderProps) {
  const cfg = TxListConfig.parse(instance.config ?? {});
  const router = useRouter();
  const { settings } = useFormatSettings();
  const showKopecks = cfg.showKopecks ?? settings.showKopecks;
  const fmt = (v: number) => formatRublesWithSettings(v, showKopecks);
  const ctx = useCashflowData();
  const drill = useDrillDown();

  // Period: cfg.defaultPeriodOverride > page-level. Используем единый
  // useBlockPeriod hook — он сам решает global vs override и регистрирует
  // блок в PagePeriodContext для счётчика overridden / mass-reset.
  const {
    period: effectivePeriod,
    source: periodSource,
    override: periodOverride,
    setOverride: setPeriodOverride,
    resetToGlobal: resetPeriodToGlobal,
    isOverride: isPeriodOverride,
  } = useBlockPeriod({
    instanceId: instance.id,
    configOverride: cfg.defaultPeriodOverride
      ? {
          preset: cfg.defaultPeriodOverride.preset,
          customFrom: cfg.defaultPeriodOverride.customFrom ?? null,
          customTo: cfg.defaultPeriodOverride.customTo ?? null,
        }
      : null,
    defaultMode: 'global',
  });
  void periodSource;
  void periodOverride;

  // Source: cfg.defaultSourceOverride > page-level. Effective source ↘
  // также может быть переопределён runtime-фильтром ниже.
  const { value: pageSource } = useEffectiveSource(
    instance.id,
    cfg.defaultSourceOverride === undefined ? undefined : cfg.defaultSourceOverride,
  );

  // Filters (UI controlled — initialized from default* config fields).
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>(cfg.defaultType);
  const [filterCounterparty, setFilterCounterparty] = useState(cfg.defaultCounterparty ?? '');
  const [filterCategoryName, setFilterCategoryName] = useState(cfg.defaultCategoryName ?? '');
  const [filterSource, setFilterSource] = useState<string | null>(null);

  // React-receive: drill-down focus from другого блока
  useEffect(() => {
    const focus = drill.focus;
    if (focus && focus.blockType === 'cashflow.transactions') {
      if (focus.filter.type) setFilterType(focus.filter.type);
      if (focus.filter.categoryName !== undefined)
        setFilterCategoryName(focus.filter.categoryName ?? '');
      if (focus.filter.counterparty !== undefined)
        setFilterCounterparty(focus.filter.counterparty ?? '');
      if (focus.filter.source !== undefined) setFilterSource(focus.filter.source ?? null);
    }
  }, [drill.focus]);

  // Effective source = block filter > page source.
  const effectiveSource = filterSource ?? pageSource;

  // Data: fetch с filters + cursor pagination
  const [rows, setRows] = useState<TxRow[]>([]);
  const [nextCursor, setNextCursor] = useState<{ occurredAt: string; id: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<CashflowTx | null>(null);
  const [editingNew, setEditingNew] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [clearAll, setClearAll] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Резолвим effectivePeriod в ISO from/to для fetch (API принимает `from`/`to`).
  const effectivePeriodRange = useMemo(() => {
    const resolved = resolvePeriod(
      effectivePeriod.preset,
      effectivePeriod.customFrom,
      effectivePeriod.customTo,
    );
    return { from: resolved.from.toISOString(), to: resolved.to.toISOString() };
  }, [effectivePeriod.preset, effectivePeriod.customFrom, effectivePeriod.customTo]);

  const filterKey = `${filterType}|${filterCounterparty}|${filterCategoryName}|${effectiveSource ?? ''}|${effectivePeriodRange.from}|${effectivePeriodRange.to}`;

  async function fetchPage(cursor: { occurredAt: string; id: string } | null) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(cfg.pageSize) });
      if (filterType !== 'all') params.set('type', filterType);
      if (filterCounterparty) params.set('counterparty', filterCounterparty);
      if (filterCategoryName) params.set('categoryName', filterCategoryName);
      if (effectiveSource) params.set('source', effectiveSource);
      // Effective period → from/to для бэкенда (v0.22.5: блок теперь учитывает
      // page-level / per-block override период вместо игнорирования).
      params.set('from', effectivePeriodRange.from);
      params.set('to', effectivePeriodRange.to);
      if (cursor) {
        params.set('cursorAt', cursor.occurredAt);
        params.set('cursorId', cursor.id);
      }
      const res = await fetch(`/api/cashflow/transactions?${params.toString()}`);
      const data = await res.json();
      if (data.ok) {
        const items: TxRow[] = (data.items ?? []).map((t: TxRow & { occurredAt: string }) => ({
          ...t,
          occurredAt: typeof t.occurredAt === 'string' ? t.occurredAt : new Date(t.occurredAt).toISOString(),
        }));
        setRows((prev) => (cursor ? [...prev, ...items] : items));
        setNextCursor(data.nextCursor ?? null);
      }
    } finally {
      setLoading(false);
    }
  }

  // (Re)load on filter change
  useEffect(() => {
    setRows([]);
    setNextCursor(null);
    fetchPage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // Initial fallback из context
  useEffect(() => {
    if (rows.length === 0 && !loading && ctx.transactions.length > 0) {
      setRows(ctx.transactions.map((t) => ({ ...t, categoryName: null })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.transactions]);

  // Publish stats
  const totalIncome = useMemo(
    () => rows.filter((r) => r.type === 'income').reduce((s, r) => s + r.amount, 0),
    [rows],
  );
  const totalExpense = useMemo(
    () => rows.filter((r) => r.type === 'expense').reduce((s, r) => s + r.amount, 0),
    [rows],
  );
  // Публикуем «view» блока (config-defined фильтры + effective period) как
  // источник для bound консьюмеров. v0.22.5: period теперь = effective (с
  // учётом page-level / override), чтобы dependent KPI/charts использовали
  // тот же период что отображается в этом блоке. Runtime-фильтры (type/cp/
  // category в UI) остаются ephemeral и не публикуются.
  const txFilters = useMemo(() => {
    return JSON.stringify({
      period: {
        preset: effectivePeriod.preset,
        customFrom: effectivePeriod.customFrom,
        customTo: effectivePeriod.customTo,
      },
      type: cfg.defaultType === 'all' ? null : cfg.defaultType,
      source:
        cfg.defaultSourceOverride === undefined ? null : cfg.defaultSourceOverride,
      counterparty: cfg.defaultCounterparty ?? null,
      categoryName: cfg.defaultCategoryName ?? null,
    });
  }, [
    effectivePeriod.preset,
    effectivePeriod.customFrom,
    effectivePeriod.customTo,
    cfg.defaultType,
    cfg.defaultSourceOverride,
    cfg.defaultCounterparty,
    cfg.defaultCategoryName,
  ]);

  useBlockValuePublisher(instance.id, {
    count: rows.length,
    totalIncome,
    totalExpense,
    label: instance.appearance?.title ?? cfg.title ?? 'История операций',
    __money: 'totalIncome,totalExpense',
    __labels:
      'count=Кол-во строк,totalIncome=Доходы (видимые),totalExpense=Расходы (видимые)',
    /**
     * Сериализованный «view» блока для bound консьюмеров (KPI / chart / etc).
     * Формат: JSON { period, type, source, counterparty, categoryName }.
     * Все поля nullable; `null` означает «не фильтровать».
     */
    __txFilters: txFilters,
    __periodKey: formatPeriodKey(effectivePeriod),
  });

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

  // Virtualization (rows > VIRTUAL_THRESHOLD)
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualize = rows.length > VIRTUAL_THRESHOLD;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => VIRTUAL_ROW_HEIGHT,
    overscan: 8,
    enabled: virtualize,
  });

  function clearFilters() {
    setFilterType('all');
    setFilterCounterparty('');
    setFilterCategoryName('');
    setFilterSource(null);
  }

  const hasActiveFilters =
    filterType !== 'all' ||
    filterCounterparty !== '' ||
    filterCategoryName !== '' ||
    filterSource !== null;

  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-2 pb-2">
        <div className="flex min-w-0 items-center gap-2">
          <CardTitle className="truncate text-base">
            {instance.appearance?.title ?? cfg.title ?? 'История операций'}
          </CardTitle>
          {isPeriodOverride && (
            <button
              type="button"
              onClick={() => resetPeriodToGlobal()}
              className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900"
              title={`Локальный период: ${describePeriodShort(effectivePeriod.preset as PeriodPreset, effectivePeriod.customFrom, effectivePeriod.customTo)}. Клик — вернуть глобальный.`}
            >
              <Lock className="h-2.5 w-2.5" />
              {PRESET_LABELS[effectivePeriod.preset as PeriodPreset] ?? effectivePeriod.preset}
            </button>
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            variant={filtersOpen || hasActiveFilters ? 'default' : 'outline'}
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => setFiltersOpen((v) => !v)}
          >
            <Filter className="h-3 w-3" />
            Фильтры
            {hasActiveFilters && (
              <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary/20 px-1 text-[10px]">
                {[filterType !== 'all', filterCounterparty, filterCategoryName, filterSource].filter(Boolean).length}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px]"
            onClick={() => exportToCsv(rows, showKopecks)}
            disabled={rows.length === 0}
          >
            <Download className="h-3 w-3" />
            CSV
          </Button>
          {rows.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px] text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setClearAll(true)}
            >
              Очистить
            </Button>
          )}
        </div>
      </CardHeader>

      {filtersOpen && (
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border/40 bg-muted/20 px-3 py-2">
          <div className="flex gap-0.5 rounded-md border border-border/60 p-0.5">
            {(['all', 'income', 'expense'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFilterType(t)}
                className={
                  'h-6 rounded px-2 text-[11px] font-medium transition ' +
                  (filterType === t
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent')
                }
              >
                {t === 'all' ? 'Все' : t === 'income' ? 'Доходы' : 'Расходы'}
              </button>
            ))}
          </div>
          <Input
            placeholder="Контрагент…"
            value={filterCounterparty}
            onChange={(e) => setFilterCounterparty(e.target.value)}
            className="h-7 w-[160px] text-[11px]"
          />
          <Input
            placeholder="Категория (точно)…"
            value={filterCategoryName}
            onChange={(e) => setFilterCategoryName(e.target.value)}
            className="h-7 w-[160px] text-[11px]"
          />
          {/* Inline period picker — переключает блок в override-mode.
              Если уже override, lock-badge в header'е даст вернуться к global. */}
          <PeriodPicker
            value={{
              preset: effectivePeriod.preset as PeriodPreset,
              customFrom: effectivePeriod.customFrom,
              customTo: effectivePeriod.customTo,
            }}
            onChange={(v) =>
              setPeriodOverride({
                preset: v.preset,
                customFrom: v.customFrom ?? null,
                customTo: v.customTo ?? null,
              })
            }
            compact
            collapsed
          />
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-[11px]"
              onClick={clearFilters}
            >
              <X className="h-3 w-3" />
              Сбросить
            </Button>
          )}
          <span className="ml-auto text-[11px] text-muted-foreground tabular-nums">
            {rows.length} {rows.length === 1 ? 'строка' : 'строк'}
          </span>
        </div>
      )}

      <CardContent className="flex-1 overflow-hidden p-0">
        <div ref={scrollRef} className="h-full overflow-y-auto">
          {loading && rows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Загрузка…</p>
          ) : rows.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-12 text-center">
              <p className="text-sm text-muted-foreground">Нет операций</p>
              {hasActiveFilters && (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Сбросить фильтры
                </Button>
              )}
            </div>
          ) : virtualize ? (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((vi) => {
                const t = rows[vi.index];
                return (
                  <div
                    key={t.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${vi.start}px)`,
                      height: vi.size,
                    }}
                  >
                    <VirtualRow
                      tx={t}
                      fmt={fmt}
                      onEdit={() => setEditing(t)}
                      onDelete={() => setDeleteId(t.id)}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Дата</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Контрагент
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                    Категория
                  </th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Сумма</th>
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
                    <td className="px-3 py-2">
                      {t.categoryName ? (
                        <span className="inline-flex rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/40">
                          {t.categoryName}
                        </span>
                      ) : (
                        <span className="text-[11px] text-muted-foreground/50">—</span>
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
          {nextCursor && !loading && (
            <div className="flex justify-center p-3">
              <Button variant="outline" size="sm" onClick={() => fetchPage(nextCursor)}>
                Загрузить ещё
              </Button>
            </div>
          )}
        </div>
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
          fetchPage(null);
        }}
      />

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить операцию?</AlertDialogTitle>
            <AlertDialogDescription>Запись будет удалена безвозвратно.</AlertDialogDescription>
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
              Будут удалены <strong>все {rows.length}</strong> транзакций. Категории и настройки
              сохранятся.
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

function VirtualRow({
  tx,
  fmt,
  onEdit,
  onDelete,
}: {
  tx: TxRow;
  fmt: (v: number) => string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 border-b border-border/40 px-3 py-2 text-sm hover:bg-muted/30">
      <span className="w-20 shrink-0 whitespace-nowrap text-xs text-muted-foreground">
        {formatDate(tx.occurredAt)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-1">{tx.counterparty ?? '—'}</div>
        {tx.description && (
          <div className="line-clamp-1 text-xs text-muted-foreground">{tx.description}</div>
        )}
      </div>
      {tx.categoryName && (
        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border/40">
          {tx.categoryName}
        </span>
      )}
      <span
        className={`shrink-0 whitespace-nowrap text-right font-medium tabular-nums ${
          tx.type === 'income' ? 'text-green-600' : 'text-red-600'
        }`}
      >
        {tx.type === 'income' ? '+' : '−'}
        {fmt(tx.amount)}
      </span>
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-red-600 hover:bg-red-50 hover:text-red-700"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
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
  function setOverride(next: typeof cfg.defaultPeriodOverride) {
    onChange({ ...cfg, defaultPeriodOverride: next });
  }
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Заголовок</Label>
        <Input
          value={cfg.title ?? ''}
          onChange={(e) => onChange({ ...cfg, title: e.target.value || undefined })}
          placeholder="История операций"
        />
      </div>
      <div className="space-y-2">
        <Label>
          Размер страницы (cursor pagination):{' '}
          <span className="tabular-nums">{cfg.pageSize}</span>
        </Label>
        <input
          type="range"
          min={20}
          max={500}
          step={20}
          value={cfg.pageSize}
          onChange={(e) => onChange({ ...cfg, pageSize: Number(e.target.value) })}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>20</span>
          <span>500</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          При &gt; 100 строк включается виртуализация — список плавно скроллится без лагов.
        </p>
      </div>

      <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2.5 text-[11px] text-muted-foreground">
        <div className="mb-1 text-xs font-semibold text-foreground">
          Вид этого блока (используется как источник для KPI/графиков)
        </div>
        Эти настройки определяют «view» блока — какие операции он показывает по умолчанию и какие
        фильтры наследуют bound консьюмеры. Runtime-фильтры в самом блоке остаются ephemeral.
      </div>

      <div className="space-y-1.5">
        <Label>Дефолтный фильтр типа</Label>
        <div className="flex gap-1">
          {(['all', 'income', 'expense'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onChange({ ...cfg, defaultType: t })}
              className={
                'inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors ' +
                (cfg.defaultType === t
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent')
              }
            >
              {t === 'all' ? 'Все' : t === 'income' ? 'Доходы' : 'Расходы'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Период (вид)</Label>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Использовать период страницы</div>
            <div className="text-[11px] text-muted-foreground">
              {cfg.defaultPeriodOverride == null
                ? 'Период наследуется от страницы (Globe)'
                : `Свой: ${PRESET_LABELS[cfg.defaultPeriodOverride.preset]}`}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Globe className="h-3 w-3 text-muted-foreground" />
            <Switch
              checked={cfg.defaultPeriodOverride == null}
              onCheckedChange={(v) =>
                setOverride(v ? null : { preset: 'mtd', customFrom: null, customTo: null })
              }
            />
          </div>
        </div>
        {cfg.defaultPeriodOverride != null && (
          <div className="rounded-md border border-border/60 p-2">
            <PeriodPicker
              value={{
                preset: cfg.defaultPeriodOverride.preset,
                customFrom: cfg.defaultPeriodOverride.customFrom ?? null,
                customTo: cfg.defaultPeriodOverride.customTo ?? null,
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

      <SourceOverrideSection
        value={cfg.defaultSourceOverride}
        onChange={(next) => onChange({ ...cfg, defaultSourceOverride: next })}
      />

      <div className="space-y-1.5">
        <Label htmlFor="tx-default-counterparty">Контрагент (вид)</Label>
        <Input
          id="tx-default-counterparty"
          placeholder="например: ТБанк, Яндекс, ВБ"
          value={cfg.defaultCounterparty ?? ''}
          onChange={(e) =>
            onChange({ ...cfg, defaultCounterparty: e.target.value || undefined })
          }
        />
        <p className="text-[11px] text-muted-foreground">
          Подстрока — bound KPI применит как ilike-фильтр.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="tx-default-category">Категория (вид, точно)</Label>
        <Input
          id="tx-default-category"
          placeholder="например: Реклама"
          value={cfg.defaultCategoryName ?? ''}
          onChange={(e) =>
            onChange({ ...cfg, defaultCategoryName: e.target.value || undefined })
          }
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

export const TransactionsListBlock: BlockDef = {
  type: 'cashflow.transactions',
  displayName: 'Список операций',
  description:
    'Фильтры, cursor-пагинация, виртуализация при >100 строк, экспорт в CSV, прием drill-down фокуса',
  category: 'tables',
  icon: ListOrdered,
  defaultSize: { w: 12, h: 6 },
  minSize: { w: 3, h: 3 },
  minContentSize: { w: 280, h: 180 },
  pages: ['cashflow'],
  configSchema: TxListConfig,
  defaultConfig: () => ({ pageSize: 100, defaultType: 'all', showKopecks: null }),
  SettingsForm: TransactionsSettings,
  Render: RenderTransactionsList,
};
