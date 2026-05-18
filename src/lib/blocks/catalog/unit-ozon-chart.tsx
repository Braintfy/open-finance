// PURPOSE: Блок «Ozon · Динамика» — time-series график (выручка/заказы/
// реклама/ДРР). Compare overlay прошлым периодом опционально.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { LineChart as LineIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ChartShell, type ChartSeries } from '@/components/blocks/chart-shell';
import {
  PeriodPicker,
  resolvePeriod,
  type PeriodPreset,
  type PeriodValue,
} from '@/components/blocks/period-picker';
import { OzonAccountSelector } from '@/components/marketplaces/ozon-account-selector';
import type {
  BlockDef,
  BlockRenderProps,
  BlockSettingsFormProps,
} from '../types';
import type { OzonTimeseriesResponse } from '@/app/api/marketplaces/ozon/timeseries/route';

const VisibleSeriesSchema = z.object({
  revenueRub: z.boolean().default(true),
  orders: z.boolean().default(true),
  adsRub: z.boolean().default(true),
  drrPct: z.boolean().default(false),
  aovRub: z.boolean().default(false),
});

export const OzonChartBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
  periodPreset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('30d'),
  customFrom: z.string().nullable().default(null),
  customTo: z.string().nullable().default(null),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
  visibleSeries: VisibleSeriesSchema.default({}),
  chartType: z.enum(['line', 'area', 'bar']).default('line'),
});

export type OzonChartBlockConfig = z.infer<typeof OzonChartBlockConfigSchema>;

function parseConfig(raw: unknown): OzonChartBlockConfig {
  return OzonChartBlockConfigSchema.parse(raw ?? {});
}

const SERIES_DEFS: Record<keyof OzonChartBlockConfig['visibleSeries'], { label: string; color: string; yAxisId?: 'left' | 'right' }> = {
  revenueRub: { label: 'Выручка ₽', color: '#10b981' },
  orders: { label: 'Заказы', color: '#0ea5e9' },
  adsRub: { label: 'Расход ₽', color: '#f43f5e' },
  drrPct: { label: 'ДРР %', color: '#f59e0b', yAxisId: 'right' },
  aovRub: { label: 'Средний чек ₽', color: '#8b5cf6' },
};

function formatRubShort(value: number): string {
  if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(value) >= 1_000) return (value / 1_000).toFixed(0) + 'K';
  return Math.round(value).toString();
}

function RenderOzonChart({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const [period, setPeriod] = useState<PeriodValue>({
    preset: config.periodPreset as PeriodPreset,
    customFrom: config.customFrom,
    customTo: config.customTo,
  });
  // Локальное (session-only) переключение granularity без записи в config.
  // Перенастроить дефолт можно в Settings блока → таб «Параметры».
  const [granularity, setGranularity] = useState<OzonChartBlockConfig['granularity']>(
    config.granularity,
  );
  useEffect(() => {
    setGranularity(config.granularity);
  }, [config.granularity]);
  const [data, setData] = useState<OzonTimeseriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async () => {
    if (!config.accountId) {
      setData(null);
      setError('Подключите Ozon-магазин в настройках блока.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const range = resolvePeriod(period.preset, period.customFrom, period.customTo);
      const params = new URLSearchParams({
        accountId: config.accountId,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        granularity,
      });
      const res = await fetch(`/api/marketplaces/ozon/timeseries?${params}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      if (res.ok && json.ok) setData(json as OzonTimeseriesResponse);
      else {
        setError(json.error ?? `HTTP ${res.status}`);
        setData(null);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [
    config.accountId,
    period.preset,
    period.customFrom,
    period.customTo,
    granularity,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const series: ChartSeries[] = useMemo(() => {
    const out: ChartSeries[] = [];
    for (const key of Object.keys(config.visibleSeries) as Array<
      keyof OzonChartBlockConfig['visibleSeries']
    >) {
      if (!config.visibleSeries[key]) continue;
      const def = SERIES_DEFS[key];
      out.push({
        key,
        label: def.label,
        color: def.color,
        type: config.chartType,
        yAxisId: def.yAxisId,
      });
    }
    return out;
  }, [config.visibleSeries, config.chartType]);

  const showRight = useMemo(() => series.some((s) => s.yAxisId === 'right'), [series]);

  return (
    <Card className="flex h-full flex-col overflow-hidden p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={setPeriod} compact />
        <select
          value={granularity}
          onChange={(e) =>
            setGranularity(e.target.value as OzonChartBlockConfig['granularity'])
          }
          className="h-7 rounded-md border border-input bg-background px-2 text-[11px] text-foreground hover:border-primary/40 focus:border-primary focus:outline-none"
        >
          <option value="day">по дням</option>
          <option value="week">по неделям</option>
          <option value="month">по месяцам</option>
        </select>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            {error}
          </div>
        ) : !data || data.points.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            {loading ? 'Загрузка…' : 'Нет данных для отображения'}
          </div>
        ) : (
          <ChartShell
            data={data.points}
            series={series}
            xKey="date"
            height={260}
            showRightAxis={showRight}
            formatY={(v) => formatRubShort(v)}
            formatYRight={(v) => v.toFixed(0) + '%'}
            formatTooltipValue={(v, name) => {
              const num = Number(v);
              if (!Number.isFinite(num)) return String(v);
              if (typeof name === 'string' && name.includes('%'))
                return num.toFixed(1) + '%';
              if (typeof name === 'string' && name.includes('₽'))
                return (
                  new Intl.NumberFormat('ru-RU', {
                    maximumFractionDigits: 0,
                  }).format(num) + ' ₽'
                );
              return new Intl.NumberFormat('ru-RU', {
                maximumFractionDigits: 0,
              }).format(num);
            }}
          />
        )}
      </div>
    </Card>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  function patch(updates: Partial<OzonChartBlockConfig>) {
    onChange({ ...parsed, ...updates } as unknown as Record<string, unknown>);
  }
  return (
    <div className="space-y-4">
      <OzonAccountSelector
        value={parsed.accountId}
        onChange={(id) => patch({ accountId: id })}
        showPerfStatus
      />
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">Период</Label>
        <PeriodPicker
          value={{
            preset: parsed.periodPreset as PeriodPreset,
            customFrom: parsed.customFrom,
            customTo: parsed.customTo,
          }}
          onChange={(v) =>
            patch({
              periodPreset: v.preset,
              customFrom: v.customFrom ?? null,
              customTo: v.customTo ?? null,
            })
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">Гранулярность</Label>
        <select
          value={parsed.granularity}
          onChange={(e) =>
            patch({
              granularity: e.target.value as OzonChartBlockConfig['granularity'],
            })
          }
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="day">По дням</option>
          <option value="week">По неделям</option>
          <option value="month">По месяцам</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">Тип графика</Label>
        <select
          value={parsed.chartType}
          onChange={(e) =>
            patch({ chartType: e.target.value as OzonChartBlockConfig['chartType'] })
          }
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="line">Линейный</option>
          <option value="area">Area</option>
          <option value="bar">Столбцы</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">Видимые серии</Label>
        <div className="grid grid-cols-2 gap-2">
          {(
            Object.keys(SERIES_DEFS) as Array<keyof OzonChartBlockConfig['visibleSeries']>
          ).map((key) => (
            <label
              key={key}
              className="flex items-center justify-between rounded-md border border-border/60 px-2 py-1.5 text-[12px]"
            >
              <span style={{ color: SERIES_DEFS[key].color }} className="font-medium">
                {SERIES_DEFS[key].label}
              </span>
              <Switch
                checked={parsed.visibleSeries[key]}
                onCheckedChange={(on) =>
                  patch({
                    visibleSeries: { ...parsed.visibleSeries, [key]: on },
                  })
                }
              />
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

export const UnitOzonChartBlock: BlockDef = {
  type: 'unit.ozon-chart',
  displayName: 'Ozon · Динамика',
  description: 'Time-series график выручки, заказов, рекламы и ДРР по дням/неделям/месяцам.',
  category: 'charts',
  icon: LineIcon,
  defaultSize: { w: 12, h: 6 },
  minSize: { w: 6, h: 4 },
  pages: ['marketplaces-ozon-dashboard', '*'],
  configSchema: OzonChartBlockConfigSchema,
  defaultConfig: () => OzonChartBlockConfigSchema.parse({}),
  SettingsForm,
  Render: RenderOzonChart,
};
