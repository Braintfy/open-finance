// PURPOSE: Кастомный KPI-блок с фильтрами (metric / period / counterparty / source / category)
// v0.19.0: использует /api/cashflow/kpi для trend + sparkline + delta vs прошлый период.
'use client';

import { useEffect, useState } from 'react';
import { Sparkles, Lock, Globe, Info } from 'lucide-react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import { useBlockDensity } from '@/components/blocks/block-size';
import { useBlockValuePublisher } from '../values';
import { useEffectivePeriod } from '../page-period-context';
import { useEffectiveSource } from '../page-source-context';
import { usePersistedPeriodWithGlobal } from '../use-persisted-period';
import { usePersistedSourceWithGlobal } from '../use-persisted-source';
import { useDrillDown } from '../drill-down';
import {
  PeriodPicker,
  type PeriodPreset,
} from '@/components/blocks/period-picker';
import { SOURCE_LABELS } from '@/components/blocks/source-filter-chips';
import { StatCard, type StatCardDelta } from '@/components/blocks/stat-card';

const StatCustomConfig = z.object({
  metric: z.enum(['income', 'expense', 'balance', 'count']).default('income'),
  counterparty: z.string().optional(),
  /** @deprecated Используйте sourceOverride. Оставлено для backward-compat. */
  source: z.string().optional(),
  /**
   * Per-block source override:
   *   - omitted → блок слушает page-level source.
   *   - null → override "Все источники".
   *   - string → override конкретного source ('bank' / 'manual' / ...).
   */
  sourceOverride: z.string().nullable().optional(),
  categoryName: z.string().optional(),
  showKopecks: z.boolean().nullable().default(null),
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
});

type Cfg = z.infer<typeof StatCustomConfig>;

const METRIC_LABELS: Record<Cfg['metric'], string> = {
  income: 'Поступления',
  expense: 'Списания',
  balance: 'Чистый баланс',
  count: 'Количество операций',
};

const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  '7d': '7 дней',
  '14d': '14 дней',
  '30d': '30 дней',
  mtd: 'Этот месяц',
  custom: 'Произвольный',
};

type FetchResult = {
  current: number;
  previous: number;
  count: number;
  deltaPct: number | null;
  byDay: Array<{ date: string; value: number }>;
};

function useStatCustomKpi(
  metric: Cfg['metric'],
  period: { preset: PeriodPreset; customFrom: string | null; customTo: string | null },
  filters: { counterparty?: string; source?: string; categoryName?: string },
): { data: FetchResult | null; loading: boolean } {
  const [data, setData] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(true);

  const key = `${metric}|${period.preset}|${period.customFrom}|${period.customTo}|${filters.counterparty ?? ''}|${filters.source ?? ''}|${filters.categoryName ?? ''}`;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);

    // count метрика — берём из aggregate (не использует deltaPct sparkline)
    if (metric === 'count') {
      const params = new URLSearchParams({
        metric: 'count',
        period: 'all_time', // legacy; period передаётся раздельно
      });
      if (filters.counterparty) params.set('counterparty', filters.counterparty);
      if (filters.source) params.set('source', filters.source);
      // /aggregate не поддерживает new period объект — используем kpi для income+expense count
      // Здесь мы просто используем balance metric с counterparty filter для count
      fetch(`/api/cashflow/kpi?${new URLSearchParams({
        metric: 'balance',
        preset: period.preset,
        ...(period.customFrom ? { customFrom: period.customFrom } : {}),
        ...(period.customTo ? { customTo: period.customTo } : {}),
        ...(filters.counterparty ? { counterparty: filters.counterparty } : {}),
        ...(filters.source ? { source: filters.source } : {}),
        ...(filters.categoryName ? { categoryName: filters.categoryName } : {}),
      }).toString()}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return;
          if (json.ok) {
            setData({
              current: json.count ?? 0,
              previous: json.prevCount ?? 0,
              count: json.count ?? 0,
              deltaPct:
                json.prevCount > 0
                  ? ((json.count - json.prevCount) / json.prevCount) * 100
                  : null,
              byDay: [],
            });
          } else {
            setData(null);
          }
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled || err.name === 'AbortError') return;
          setData(null);
          setLoading(false);
        });
      return () => {
        cancelled = true;
        controller.abort();
      };
    }

    const params = new URLSearchParams({
      metric,
      preset: period.preset,
    });
    if (period.customFrom) params.set('customFrom', period.customFrom);
    if (period.customTo) params.set('customTo', period.customTo);
    if (filters.counterparty) params.set('counterparty', filters.counterparty);
    if (filters.source) params.set('source', filters.source);
    if (filters.categoryName) params.set('categoryName', filters.categoryName);

    fetch(`/api/cashflow/kpi?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.ok) {
          setData({
            current: json.current,
            previous: json.previous,
            count: json.count,
            deltaPct: json.deltaPct,
            byDay: json.byDay ?? [],
          });
        } else {
          setData(null);
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || err.name === 'AbortError') return;
        setData(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { data, loading };
}

function RenderStatCustom({ instance }: BlockRenderProps) {
  const cfg = StatCustomConfig.parse(instance.config ?? {});
  const density = useBlockDensity();
  const drill = useDrillDown();
  const { settings: globalSettings } = useFormatSettings();
  const showKopecks = cfg.showKopecks ?? globalSettings.showKopecks;

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
  const { value: period, source: periodSource } = useEffectivePeriod(instance.id, override);

  // Source: либо новый sourceOverride, либо deprecated cfg.source (для backward-compat).
  const initialSourceOverride =
    cfg.sourceOverride !== undefined
      ? { mode: 'override' as const, value: cfg.sourceOverride }
      : cfg.source
        ? { mode: 'override' as const, value: cfg.source }
        : { mode: 'global' as const };

  const { override: srcOverride, setOverride: setSrcOverride } = usePersistedSourceWithGlobal({
    instanceId: instance.id,
    initial: initialSourceOverride,
  });
  const { value: effectiveSource, source: sourceSource } = useEffectiveSource(
    instance.id,
    srcOverride,
  );

  const { data, loading } = useStatCustomKpi(
    cfg.metric,
    period,
    {
      counterparty: cfg.counterparty,
      source: effectiveSource ?? undefined,
      categoryName: cfg.categoryName,
    },
  );

  const titleParts: string[] = [METRIC_LABELS[cfg.metric]];
  if (cfg.counterparty) titleParts.push(cfg.counterparty);
  if (cfg.categoryName) titleParts.push(cfg.categoryName);
  const title = instance.appearance?.title ?? cfg.title ?? titleParts.join(' · ');

  const value = cfg.metric === 'count' ? (data?.current ?? 0) : (data?.current ?? 0) / 100;

  useBlockValuePublisher(instance.id, {
    value: data?.current ?? 0,
    valuePrev: data?.previous ?? 0,
    deltaPct: data?.deltaPct ?? 0,
    count: data?.count ?? 0,
    label: title,
    __money: cfg.metric === 'count' ? '' : 'value,valuePrev',
    __labels: 'value=Значение,valuePrev=Прошлый период,deltaPct=Изменение %,count=Кол-во',
  });

  const delta: StatCardDelta | null =
    data && data.deltaPct !== null && data.previous !== 0
      ? {
          value: data.deltaPct,
          label: 'vs прошлый период',
          goodDirection:
            cfg.metric === 'expense' ? 'down' : cfg.metric === 'income' ? 'up' : undefined,
        }
      : null;

  const sparkline =
    data?.byDay && data.byDay.length > 1
      ? data.byDay.map((d) => (cfg.metric === 'count' ? d.value : d.value / 100))
      : null;

  const accentColor = instance.appearance?.accentColor;
  const sourceMeta = effectiveSource ? SOURCE_LABELS[effectiveSource] : null;
  const isExpenseLike = cfg.metric === 'expense';

  function handleDrill(e?: React.MouseEvent) {
    e?.stopPropagation();
    drill.setFocus({
      blockType: 'cashflow.transactions',
      filter: {
        type:
          cfg.metric === 'income'
            ? 'income'
            : cfg.metric === 'expense'
              ? 'expense'
              : undefined,
        counterparty: cfg.counterparty,
        categoryName: cfg.categoryName,
        source: effectiveSource ?? undefined,
      },
    });
  }

  if (density === 'xs') {
    const fmt =
      cfg.metric === 'count'
        ? new Intl.NumberFormat('ru-RU').format(value)
        : formatRublesWithSettings(Math.abs(value * 100), showKopecks);
    return (
      <Card
        className="flex h-full cursor-pointer items-center justify-center p-2 transition hover:ring-1 hover:ring-primary/30"
        onClick={handleDrill}
      >
        <div className="flex items-center gap-1">
          <Sparkles className="h-3 w-3 shrink-0" style={accentColor ? { color: accentColor } : undefined} />
          <span
            className="truncate text-sm font-semibold tabular-nums"
            style={accentColor ? { color: accentColor } : undefined}
          >
            {loading ? '—' : fmt}
          </span>
        </div>
      </Card>
    );
  }

  const noDataInPeriod = !loading && data && data.current === 0 && data.previous === 0;

  return (
    <Card
      className="group/kpi relative flex h-full min-h-0 cursor-pointer flex-col p-3 transition hover:ring-1 hover:ring-primary/30"
      onClick={handleDrill}
    >
      {(periodSource === 'override' || sourceSource === 'override') && (
        <div className="absolute right-2 top-2 z-10 flex items-center gap-1">
          {periodSource === 'override' && (
            <button
              type="button"
              className="inline-flex h-4 items-center gap-0.5 rounded bg-amber-50 px-1 text-[9px] font-medium text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-400 dark:ring-amber-900"
              title={`Свой период: ${PRESET_LABELS[period.preset as PeriodPreset]}. Клик — вернуть глобальный.`}
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
              className="inline-flex h-4 items-center gap-0.5 rounded bg-sky-50 px-1 text-[9px] font-medium text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900"
              title="Клик — вернуть глобальный источник"
              onClick={(e) => {
                e.stopPropagation();
                setSrcOverride(undefined);
              }}
            >
              <Lock className="h-2.5 w-2.5" />
              {sourceMeta?.label ?? effectiveSource ?? 'Все'}
            </button>
          )}
        </div>
      )}

      <StatCard
        variant="inner"
        icon={Sparkles}
        iconColor={accentColor}
        label={title}
        value={value}
        format={cfg.metric === 'count' ? 'int' : 'rub'}
        delta={delta}
        sparkline={density === 'lg' ? sparkline : null}
        loading={loading}
        accent={isExpenseLike ? 'rose' : 'emerald'}
        tone={
          cfg.metric === 'balance' ? (value >= 0 ? 'positive' : 'negative') : 'default'
        }
        hint={
          data && density !== 'sm' && cfg.metric !== 'count' && !noDataInPeriod
            ? `${data.count} опер.${sourceMeta ? ' · ' + sourceMeta.label : ''}`
            : undefined
        }
      />

      {noDataInPeriod && (
        <div className="mt-1 flex shrink-0 items-center gap-1 rounded-md bg-muted/40 px-1.5 py-1 text-[10px] text-muted-foreground ring-1 ring-border/40">
          <Info className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">
            Нет данных за «{PRESET_LABELS[period.preset as PeriodPreset]}»
          </span>
        </div>
      )}
    </Card>
  );
}

function StatCustomSettings({ config, onChange }: BlockSettingsFormProps) {
  const cfg = StatCustomConfig.parse(config ?? {});
  const [meta, setMeta] = useState<{
    sources: string[];
    counterparties: { name: string | null; count: number }[];
  }>({ sources: [], counterparties: [] });

  useEffect(() => {
    fetch('/api/cashflow/meta')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) setMeta({ sources: d.sources, counterparties: d.counterparties });
      })
      .catch(() => {});
  }, []);

  function set<K extends keyof Cfg>(key: K, value: Cfg[K]) {
    onChange({ ...cfg, [key]: value });
  }

  function setOverride(next: Cfg['periodOverride']) {
    onChange({ ...cfg, periodOverride: next });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Заголовок</Label>
        <Input
          value={cfg.title ?? ''}
          onChange={(e) => set('title', e.target.value || undefined)}
          placeholder="Авто: «Поступления · Контрагент»"
        />
      </div>

      <div className="space-y-2">
        <Label>Что считаем</Label>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(METRIC_LABELS) as Cfg['metric'][]).map((m) => (
            <Button
              key={m}
              type="button"
              variant={cfg.metric === m ? 'default' : 'outline'}
              size="sm"
              onClick={() => set('metric', m)}
            >
              {METRIC_LABELS[m]}
            </Button>
          ))}
        </div>
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

      <div className="space-y-2">
        <Label htmlFor="counterparty-filter">Контрагент содержит</Label>
        <Input
          id="counterparty-filter"
          placeholder="например: ТБанк, Яндекс, ВБ"
          value={cfg.counterparty ?? ''}
          onChange={(e) => set('counterparty', e.target.value || undefined)}
          list="counterparties-suggest"
        />
        <datalist id="counterparties-suggest">
          {meta.counterparties.slice(0, 30).map((c, i) => (
            <option key={i} value={c.name ?? ''} />
          ))}
        </datalist>
      </div>

      <div className="space-y-2">
        <Label htmlFor="category-filter">Категория (точное имя)</Label>
        <Input
          id="category-filter"
          placeholder="например: Реклама"
          value={cfg.categoryName ?? ''}
          onChange={(e) => set('categoryName', e.target.value || undefined)}
        />
        <p className="text-xs text-muted-foreground">
          Имя категории целиком (не подстрока). Создаются автоматически при импорте.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Источник</Label>
        <div className="flex items-center justify-between rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs font-medium">Использовать источник страницы</div>
            <div className="text-[11px] text-muted-foreground">
              {cfg.sourceOverride === undefined
                ? 'Источник наследуется от страницы (Globe)'
                : cfg.sourceOverride === null
                  ? 'Свой: все источники'
                  : `Свой: ${SOURCE_LABELS[cfg.sourceOverride]?.label ?? cfg.sourceOverride}`}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Globe className="h-3 w-3 text-muted-foreground" />
            <Switch
              checked={cfg.sourceOverride === undefined}
              onCheckedChange={(v) => set('sourceOverride', v ? undefined : null)}
            />
          </div>
        </div>
        {cfg.sourceOverride !== undefined && (
          <div className="rounded-md border border-border/60 p-2">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant={cfg.sourceOverride === null ? 'default' : 'outline'}
                size="sm"
                onClick={() => set('sourceOverride', null)}
              >
                Все
              </Button>
              {meta.sources.map((s) => {
                const meta2 = SOURCE_LABELS[s];
                return (
                  <Button
                    key={s}
                    type="button"
                    variant={cfg.sourceOverride === s ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => set('sourceOverride', s)}
                  >
                    {meta2?.label ?? s}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {cfg.metric !== 'count' && (
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
                  onClick={() => set('showKopecks', null)}
                  className="text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Сбросить
                </button>
              )}
              <Switch
                checked={cfg.showKopecks ?? false}
                onCheckedChange={(v) => set('showKopecks', v)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export const StatCustomBlock: BlockDef = {
  type: 'stat.custom',
  displayName: 'KPI с фильтрами',
  description:
    'Сумма по гибким фильтрам (тип/контрагент/категория/источник) с trend и sparkline',
  category: 'stats',
  icon: Sparkles,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 1, h: 1 },
  minContentSize: { w: 80, h: 40 },
  pages: ['cashflow', 'dashboard'],
  configSchema: StatCustomConfig,
  defaultConfig: () => ({ metric: 'income', periodOverride: null }),
  SettingsForm: StatCustomSettings,
  Render: RenderStatCustom,
};
