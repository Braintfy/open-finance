// PURPOSE: Computed-блоки — агрегируют значения других блоков (Excel-style cell references).
// Используют `dependencies` поле BlockInstance + reactive store useBlockDependencyResult.
// v0.19.0: расширенный SettingsForm (title/format/expression), breakdown popover,
// sparkline из byDay sources (если есть), новые aggregations.
'use client';

import { Calculator, Sigma, TrendingUp, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';
import { useBlockDensity } from '@/components/blocks/block-size';
import {
  useBlockDependencyResult,
  useBlockValue,
  useBlockValuePublisher,
} from '../values';
import { BlockValuesContext } from '../values';
import { useContext } from 'react';

function refFieldName(ref: string): string {
  const source = ref.includes(':') ? ref.slice(ref.lastIndexOf(':') + 1) : ref;
  const dot = source.lastIndexOf('.');
  return dot >= 0 ? source.slice(dot + 1) : 'value';
}

function refIsPlainNumber(ref: string): boolean {
  const field = refFieldName(ref);
  return /^[A-Z]+\d+$/.test(field) || ['count', 'raw', 'label'].includes(field);
}

function formatPlainNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(value / 100);
}

// ============================================================================
// computed.sum — агрегация значений N других блоков
// ============================================================================

const ComputedConfig = z.object({
  showKopecks: z.boolean().nullable().default(null),
  title: z.string().optional(),
  /** Формат вывода: auto = смотрим moneyFields у источников. */
  format: z.enum(['auto', 'rub', 'int', 'percent']).default('auto'),
  /** Выражение для aggregation='formula' (см. types.ts). */
  expression: z.string().optional(),
  /** Подзаголовок (опционально). */
  subtitle: z.string().optional(),
});

type Cfg = z.infer<typeof ComputedConfig>;

const AGG_LABEL: Record<string, string> = {
  sum: 'Сумма',
  avg: 'Среднее',
  min: 'Минимум',
  max: 'Максимум',
  count: 'Количество',
  median: 'Медиана',
  variance: 'Дисперсия',
  first: 'Первое',
  last: 'Последнее',
  formula: 'Формула',
  ai: 'AI',
};

/** Маленькая inline SVG-sparkline (без recharts — лёгкий). */
function MiniSpark({ values, color = '#3b82f6' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const w = 80;
  const h = 24;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth={1.5} points={pts} />
    </svg>
  );
}

function RenderComputedSum({ instance }: BlockRenderProps) {
  const density = useBlockDensity();
  const cfg = ComputedConfig.parse(instance.config ?? {});
  const { settings } = useFormatSettings();
  const showKopecks = cfg.showKopecks ?? settings.showKopecks;
  const accent = instance.appearance?.accentColor;
  const title = instance.appearance?.title ?? cfg.title ?? 'Агрегация';
  const noSources = !instance.dependencies || instance.dependencies.sources.length === 0;
  const aggregation = instance.dependencies?.aggregation ?? 'sum';

  const moneyAggregation = useMemo(
    () =>
      (instance.dependencies?.sources ?? []).some(
        (src) => !refIsPlainNumber(`${src.blockId}.${src.field ?? 'value'}`),
      ),
    [instance.dependencies?.sources],
  );

  // Wire config.expression → formulaExpression: SettingsForm writes config.expression,
  // but useBlockDependencyResult reads deps.formulaExpression — bridge them here.
  const effectiveDeps = useMemo(() => {
    if (!instance.dependencies) return undefined;
    return {
      ...instance.dependencies,
      formulaExpression: instance.dependencies.formulaExpression ?? cfg.expression,
    };
  }, [instance.dependencies, cfg.expression]);

  const { value, sourceValues, missing } = useBlockDependencyResult(effectiveDeps);

  // Format selection
  const effectiveFormat: 'rub' | 'int' | 'percent' =
    cfg.format === 'auto'
      ? aggregation === 'count'
        ? 'int'
        : moneyAggregation
          ? 'rub'
          : 'int'
      : cfg.format;
  const fmt = (v: number) => {
    if (effectiveFormat === 'rub') return formatRublesWithSettings(v, showKopecks);
    if (effectiveFormat === 'percent') return formatPercent(v);
    return formatPlainNumber(v);
  };

  // Publish для downstream computed
  useBlockValuePublisher(instance.id, {
    value: value ?? 0,
    label: title,
    count: sourceValues.length,
    missing,
    __money: effectiveFormat === 'rub' ? 'value' : '',
    __labels: 'value=Результат,count=Источников,missing=Не доступны',
  });

  // XS — только результат
  if (density === 'xs') {
    return (
      <Card className="flex h-full flex-col justify-center p-1">
        <div
          className="truncate text-center text-sm font-semibold tabular-nums tracking-tight"
          style={accent ? { color: accent } : undefined}
        >
          {value !== null ? fmt(value) : '—'}
        </div>
      </Card>
    );
  }

  // SM — заголовок + результат
  if (density === 'sm') {
    return (
      <Card className="flex h-full flex-col justify-center p-2.5">
        <div className="flex items-center gap-1">
          <Sigma className="h-3.5 w-3.5 shrink-0" style={accent ? { color: accent } : undefined} />
          <span className="truncate text-[11px] font-medium text-muted-foreground">{title}</span>
        </div>
        <div
          className="mt-0.5 truncate text-base font-semibold tabular-nums tracking-tight"
          style={accent ? { color: accent } : undefined}
          title={value !== null ? fmt(value) : undefined}
        >
          {value !== null ? fmt(value) : '—'}
        </div>
      </Card>
    );
  }

  // MD/LG — полный вид + breakdown popover
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="flex shrink-0 flex-row items-center justify-between pb-1.5">
        <CardTitle className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          <Sigma className="h-4 w-4 shrink-0" style={accent ? { color: accent } : undefined} />
          <span className="line-clamp-1">{title}</span>
        </CardTitle>
        {!noSources && density === 'lg' && (
          <BreakdownPopover
            instance={instance}
            value={value}
            sourceValues={sourceValues}
            fmt={fmt}
          />
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col justify-center gap-1">
        {noSources ? (
          <div className="rounded-md border border-dashed border-border/60 bg-muted/30 p-3 text-center text-xs text-muted-foreground">
            <Calculator className="mx-auto mb-1 h-4 w-4" />
            Нет источников. Откройте «Настройки → Связи» и выберите блоки для агрегации.
          </div>
        ) : (
          <>
            <div className="flex items-end justify-between gap-2">
              <div
                className={`truncate ${density === 'lg' ? 'text-2xl' : 'text-xl'} font-semibold tabular-nums tracking-tight`}
                style={accent ? { color: accent } : undefined}
              >
                {value !== null ? fmt(value) : '—'}
              </div>
              {density === 'lg' && (
                <ComputedSparkline instance={instance} color={accent ?? '#3b82f6'} />
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {AGG_LABEL[aggregation]} из {sourceValues.length}{' '}
              {sourceValues.length === 1 ? 'источника' : 'источников'}
              {missing > 0 && (
                <span className="ml-1 text-amber-600">
                  ({missing} {missing === 1 ? 'недоступен' : 'недоступны'})
                </span>
              )}
              {cfg.subtitle && <span className="ml-1">· {cfg.subtitle}</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Sparkline из byDay sources (если есть)
// ============================================================================

function ComputedSparkline({
  instance,
  color,
}: {
  instance: BlockRenderProps['instance'];
  color: string;
}) {
  const api = useContext(BlockValuesContext);
  if (!api || !instance.dependencies) return null;
  const store = api.get();
  // Собираем sparkline только если ВСЕ источники публикуют byDay поле формата
  // 'd0,d1,d2,...' (CSV числа). Иначе показываем badge.
  const series: number[][] = [];
  for (const src of instance.dependencies.sources) {
    const out = store.values.get(src.blockId);
    if (!out) continue;
    const byDay = out.byDay;
    if (typeof byDay === 'string' && byDay) {
      const arr = byDay
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n));
      if (arr.length > 1) series.push(arr);
    }
  }
  if (series.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
        <TrendingUp className="h-2.5 w-2.5" />
        {instance.dependencies.sources.length}
      </span>
    );
  }
  // Суммируем по-точечно. Длина — min length.
  const minLen = Math.min(...series.map((s) => s.length));
  const summed: number[] = Array(minLen)
    .fill(0)
    .map((_, i) => series.reduce((sum, s) => sum + s[i], 0));
  return <MiniSpark values={summed} color={color} />;
}

// ============================================================================
// Breakdown popover — список источников + контрибуция
// ============================================================================

function BreakdownPopover({
  instance,
  value,
  sourceValues,
  fmt,
}: {
  instance: BlockRenderProps['instance'];
  value: number | null;
  sourceValues: Array<number | null>;
  fmt: (v: number) => string;
}) {
  const api = useContext(BlockValuesContext);
  const sources = instance.dependencies?.sources ?? [];
  const totalAbs = sourceValues
    .filter((v): v is number => v !== null)
    .reduce((s, n) => s + Math.abs(n), 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[10px] text-muted-foreground"
          title="Разложение по источникам"
        >
          breakdown
          <ChevronDown className="ml-0.5 h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="mb-2 flex items-center justify-between text-[11px]">
          <span className="font-medium">Источники</span>
          <span className="text-muted-foreground">
            Σ: {value !== null ? fmt(value) : '—'}
          </span>
        </div>
        <div className="space-y-1">
          {sources.map((src, i) => {
            const v = sourceValues[i];
            const pct = v !== null && totalAbs > 0 ? (Math.abs(v) / totalAbs) * 100 : 0;
            const out = api?.get().values.get(src.blockId);
            const label = (out?.label as string) ?? src.blockId.slice(0, 8);
            const field = src.field ?? 'value';
            return (
              <div key={`${src.blockId}-${i}`} className="rounded p-1 hover:bg-muted/50">
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="truncate">
                    {label}
                    <span className="ml-1 text-muted-foreground">.{field}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">
                    {v !== null ? fmt(v) : '—'}
                  </span>
                </div>
                {v !== null && (
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary/60"
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ============================================================================
// SettingsForm
// ============================================================================

function ComputedSettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const cfg = ComputedConfig.parse(config ?? {});

  function set<K extends keyof Cfg>(key: K, value: Cfg[K]) {
    onChange({ ...cfg, [key]: value });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Заголовок</Label>
        <Input
          value={cfg.title ?? ''}
          onChange={(e) => set('title', e.target.value || undefined)}
          placeholder="Авто: «Агрегация»"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Подзаголовок (опц.)</Label>
        <Input
          value={cfg.subtitle ?? ''}
          onChange={(e) => set('subtitle', e.target.value || undefined)}
          placeholder="например: за этот месяц"
        />
      </div>

      <div className="space-y-1.5">
        <Label>Формат вывода</Label>
        <div className="grid grid-cols-4 gap-1">
          {(['auto', 'rub', 'int', 'percent'] as const).map((f) => (
            <Button
              key={f}
              type="button"
              size="sm"
              variant={cfg.format === f ? 'default' : 'outline'}
              onClick={() => set('format', f)}
            >
              {f === 'auto' ? 'Авто' : f === 'rub' ? '₽' : f === 'int' ? '123' : '%'}
            </Button>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          «Авто» — определяется по типу источников (money/число) и aggregation.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Формула (для aggregation = formula)</Label>
        <Input
          value={cfg.expression ?? ''}
          onChange={(e) => set('expression', e.target.value || undefined)}
          placeholder="например: (a + b) * 0.13"
          spellCheck={false}
        />
        <p className="text-[11px] text-muted-foreground">
          Переменные: <code>a</code> = источник 1, <code>b</code> = источник 2, …
          Операторы: + - * / ( ) %. Используйте aggregation = «formula» во вкладке Связи.
        </p>
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
    </div>
  );
}

export const ComputedSumBlock: BlockDef = {
  type: 'computed.sum',
  displayName: 'Агрегация (формула)',
  description:
    'Считает sum/avg/min/max/median/variance/first/last/formula из значений других блоков. Excel-style ссылки между блоками.',
  category: 'custom',
  icon: Sigma,
  defaultSize: { w: 4, h: 2 },
  minSize: { w: 2, h: 1 },
  minContentSize: { w: 100, h: 60 },
  pages: ['*'],
  configSchema: ComputedConfig,
  defaultConfig: () => ({ showKopecks: null, format: 'auto' }),
  supportsDependencies: true,
  SettingsForm: ComputedSettingsForm,
  Render: RenderComputedSum,
};
