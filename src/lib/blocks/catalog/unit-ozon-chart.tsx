// PURPOSE: Блок «Ozon · Динамика» — time-series график (выручка/заказы/
// реклама/ДРР). Compare overlay прошлым периодом опционально.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { AlertTriangle, Info, LineChart as LineIcon, SlidersHorizontal } from 'lucide-react';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ChartShell, type ChartSeries, type ChartYAxis } from '@/components/blocks/chart-shell';
import {
  PeriodPicker,
  resolvePeriod,
  resolveOzonPeriod,
  ozonPeriodToSearchParams,
  type PeriodPreset,
  type PeriodValue,
} from '@/components/blocks/period-picker';
import { OzonAccountSelector } from '@/components/marketplaces/ozon-account-selector';
import { OzonSyncSection } from '@/components/unit-economics/ozon-sync-section';
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
  // ДРР % выведен из чарта в KPI-badge сверху, но даём опцию вернуть
  // его линией для тех, кому привычнее.
  drrPct: z.boolean().default(false),
  // AOV — узкий use-case, по умолчанию скрыт (мешает читать выручку).
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

type SeriesKey = keyof OzonChartBlockConfig['visibleSeries'];
// Axis IDs:
//   - rubLeft  : выручка (большой масштаб 100K-1M+)
//   - rubRight : расход (меньший масштаб 1K-10K) — собственная ось чтобы
//                линия расхода не сливалась с нулём на фоне выручки
//   - orders   : заказы (bars в нижней трети, скрытая ось — domain x3)
//   - pct      : ДРР % (опц. правая, поверх расхода)
//   - aov      : AOV ₽ (опц. левая, как выручка)
type AxisId = 'rubLeft' | 'rubRight' | 'orders' | 'pct';

const SERIES_DEFS: Record<
  SeriesKey,
  {
    label: string;
    color: string;
    yAxisId: AxisId;
    isMoney: boolean;
    type: 'line' | 'area' | 'bar';
  }
> = {
  revenueRub: { label: 'Выручка ₽', color: '#10b981', yAxisId: 'rubLeft', isMoney: true, type: 'area' },
  adsRub:     { label: 'Расход ₽',  color: '#ef4444', yAxisId: 'rubRight', isMoney: true, type: 'line' },
  orders:     { label: 'Заказы',    color: '#94a3b8', yAxisId: 'orders',   isMoney: false, type: 'bar' },
  drrPct:     { label: 'ДРР %',     color: '#f59e0b', yAxisId: 'pct',      isMoney: false, type: 'line' },
  aovRub:     { label: 'Средний чек ₽', color: '#8b5cf6', yAxisId: 'rubLeft', isMoney: true, type: 'line' },
};

function formatRubShort(value: number): string {
  if (Math.abs(value) >= 1_000_000) return (value / 1_000_000).toFixed(1) + 'M';
  if (Math.abs(value) >= 1_000) return (value / 1_000).toFixed(0) + 'K';
  return Math.round(value).toString();
}

function formatIntShort(value: number): string {
  if (Math.abs(value) >= 1_000) return (value / 1_000).toFixed(1) + 'K';
  return Math.round(value).toString();
}

/** Текущая дата в TZ браузера, формат YYYY-MM-DD (для сравнения с p.date). */
function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function RenderOzonChart({ instance, onConfigChange }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const [metricsOpen, setMetricsOpen] = useState(false);
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
      const msc = resolveOzonPeriod(period.preset, period.customFrom, period.customTo, {
        excludeToday: true,
      });
      const params = ozonPeriodToSearchParams(msc, {
        accountId: config.accountId,
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
    for (const key of Object.keys(config.visibleSeries) as SeriesKey[]) {
      if (!config.visibleSeries[key]) continue;
      const def = SERIES_DEFS[key];
      // Тип берётся из SERIES_DEFS (revenue=area, ads/aov/drr=line, orders=bar).
      // config.chartType сохраняется как override только для revenue
      // (на случай если юзер хочет bar/line вместо area).
      const type =
        key === 'revenueRub' && config.chartType !== 'line'
          ? config.chartType
          : def.type;
      out.push({
        key,
        label: def.label,
        color: def.color,
        type,
        yAxisId: def.yAxisId,
        // adsRub — тонкая линия 2.5px, чтобы выделяться на фоне area.
        strokeWidth: key === 'adsRub' ? 2.5 : key === 'aovRub' ? 1.5 : 2,
        // aovRub — пунктир (вторичная метрика).
        strokeDasharray: key === 'aovRub' ? '4 3' : undefined,
        // Bars для orders — узкие и полупрозрачные, как фон.
        barSize: key === 'orders' ? 6 : undefined,
        fillOpacity: key === 'orders' ? 0.5 : undefined,
      });
    }
    return out;
  }, [config.visibleSeries, config.chartType]);

  // v0.18.22: Исключаем текущий день из графика.
  // Причина: данные «сегодня» неполные — выручка / реклама обнуляются к
  // концу дня по мере прихода новых заказов, шкала и тренды визуально
  // ломаются. Точка ещё «дозревает», поэтому до завтрашней синхронизации
  // правильнее её скрыть.
  // Сравнение делается по локальной TZ браузера, точка трактуется как
  // «сегодня» если её date >= today (учитываем недельную/месячную
  // гранулярность — там бакет начинается с понедельника/1-го числа и
  // тоже содержит «сегодня»).
  const visiblePoints = useMemo(() => {
    if (!data?.points) return [];
    const today = todayLocalISO();
    return data.points.filter((p) => {
      const d = (p.date ?? '').slice(0, 10);
      return d.length === 10 ? d < today : true;
    });
  }, [data]);

  const hiddenTodayPoint = useMemo(() => {
    if (!data?.points) return false;
    const today = todayLocalISO();
    return data.points.some((p) => (p.date ?? '').slice(0, 10) >= today);
  }, [data]);

  // Считаем dataMax заказов отдельно, чтобы прижать bars к нижней четверти.
  const ordersMax = useMemo(() => {
    let m = 0;
    for (const p of visiblePoints) {
      const v = Number(p.orders ?? 0);
      if (v > m) m = v;
    }
    return m;
  }, [visiblePoints]);

  // Y-оси: нейтральные ticks (muted-foreground), без копирования цвета серий.
  // rubLeft (revenue/aov) — main левая ось, rubRight (ads) — собственный
  // масштаб справа (чтобы ads не сливался с нулём), orders — скрытая
  // ось с domain [0, ordersMax × 4] прижимает bars к нижней четверти.
  const yAxes: ChartYAxis[] = useMemo(() => {
    const used = new Set(series.map((s) => s.yAxisId));
    const axes: ChartYAxis[] = [];
    if (used.has('rubLeft')) {
      axes.push({
        id: 'rubLeft',
        color: 'hsl(var(--muted-foreground))',
        orientation: 'left',
        colored: false,
        domain: ['auto', 'dataMax'],
        formatter: (v) => formatRubShort(v),
        width: 48,
      });
    }
    if (used.has('rubRight')) {
      axes.push({
        id: 'rubRight',
        color: 'hsl(var(--muted-foreground))',
        orientation: 'right',
        colored: false,
        domain: ['auto', 'dataMax'],
        formatter: (v) => formatRubShort(v),
        width: 48,
      });
    }
    if (used.has('orders')) {
      // Скрытая ось — bars видны, но шкала не загромождает чарт.
      // Чтобы bars занимали только нижнюю ~25% графика, считаем dataMax
      // по data и умножаем на 4. Recharts не умеет 'dataMax * N' строкой,
      // поэтому считаем число явно ниже (см. ordersMax).
      axes.push({
        id: 'orders',
        color: 'hsl(var(--muted-foreground))',
        orientation: 'right',
        hide: true,
        domain: [0, ordersMax > 0 ? ordersMax * 4 : 1],
        formatter: (v) => formatIntShort(v),
      });
    }
    if (used.has('pct')) {
      axes.push({
        id: 'pct',
        color: 'hsl(var(--muted-foreground))',
        orientation: 'right',
        colored: false,
        domain: [0, 'dataMax'],
        formatter: (v) => `${v.toFixed(0)}%`,
        width: 36,
      });
    }
    return axes;
  }, [series, ordersMax]);

  const totals = useMemo(() => {
    let revenue = 0;
    let orders = 0;
    let ads = 0;
    // Тоталы считаем по visiblePoints (без «сегодня») — иначе badge
    // вверху будет показывать одно число, а сумма по чарту — другое.
    for (const p of visiblePoints) {
      revenue += p.revenueRub ?? 0;
      orders += p.orders ?? 0;
      ads += p.adsRub ?? 0;
    }
    return { revenue, orders, ads };
  }, [visiblePoints]);

  useBlockValuePublisher(instance.id, {
    value: totals.revenue * 100,
    revenue: totals.revenue * 100,
    ads: totals.ads * 100,
    orders: totals.orders,
    drr: totals.revenue > 0 ? (totals.ads / totals.revenue) * 100 : 0,
    label: instance.appearance?.title ?? 'Ozon · Динамика',
    __money: 'value,revenue,ads',
    __labels:
      'value=Выручка / период,revenue=Выручка / период,ads=Реклама / период,' +
      'orders=Заказы / период,drr=ДРР %',
  });

  const enabledCount = Object.values(config.visibleSeries).filter(Boolean).length;
  const totalCount = Object.keys(SERIES_DEFS).length;

  function patchSeries(key: SeriesKey, on: boolean) {
    onConfigChange?.({
      ...config,
      visibleSeries: { ...config.visibleSeries, [key]: on },
    } as unknown as Record<string, unknown>);
  }

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
        <div className="relative">
          <button
            type="button"
            onClick={() => setMetricsOpen((v) => !v)}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-[11px] text-foreground hover:border-primary/40"
          >
            <SlidersHorizontal className="h-3 w-3" />
            Метрики ({enabledCount}/{totalCount})
          </button>
          {metricsOpen && (
            <>
              <button
                aria-hidden
                tabIndex={-1}
                className="fixed inset-0 z-10 cursor-default"
                onClick={() => setMetricsOpen(false)}
              />
              <div className="absolute left-0 top-full z-20 mt-1 w-60 rounded-md border border-border/60 bg-card p-2 shadow-lg">
                <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  Видимые серии
                </div>
                <div className="space-y-1">
                  {(Object.keys(SERIES_DEFS) as SeriesKey[]).map((key) => {
                    const def = SERIES_DEFS[key];
                    const on = config.visibleSeries[key];
                    return (
                      <label
                        key={key}
                        className="flex cursor-pointer items-center justify-between gap-2 rounded px-1 py-1 text-[11px] hover:bg-accent"
                      >
                        <span className="flex items-center gap-1.5">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: def.color }}
                          />
                          {def.label}
                        </span>
                        <Switch
                          checked={on}
                          onCheckedChange={(next) => patchSeries(key, next)}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
        {hiddenTodayPoint && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            title="Текущий день скрыт — данные не полные. Точка «сегодня» дозревает в течение суток, поэтому исключена из графика и тоталов."
          >
            <Info className="h-2.5 w-2.5" />
            Сегодня скрыт
          </span>
        )}
        {data?.adsSource === 'expense' && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
            title="Расход — эталон Performance API /statistics/expense (все типы кампаний + бонусы)."
          >
            Эталон Ads
          </span>
        )}
        {data?.ordersSource === 'orders-fallback' && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            title="Цифры считаются по postings (legacy). Запустите sync «Аналитика продаж (Seller API)» — без него возможно расхождение с кабинетом Ozon на 20-60%."
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            Postings (legacy)
          </span>
        )}
        {data?.adsSource === 'transactions-heuristic' && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            title="Расход на рекламу взят из транзакций (эвристика). Подключите Performance API для точных цифр."
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            Реклама ≈
          </span>
        )}
        {/* KPI-badges по сводным метрикам периода. ДРР вынесен из чарта
            (был «третьей осью %», не помещался без шума). */}
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          {totals.revenue > 0 && (
            <span className="rounded-md bg-emerald-50 px-2 py-1 dark:bg-emerald-950/40">
              <span className="text-muted-foreground">Выручка </span>
              <span className="font-semibold text-emerald-700 tabular-nums dark:text-emerald-300">
                {formatRubShort(totals.revenue)} ₽
              </span>
            </span>
          )}
          {totals.ads > 0 && (
            <span className="rounded-md bg-rose-50 px-2 py-1 dark:bg-rose-950/40">
              <span className="text-muted-foreground">Расход </span>
              <span className="font-semibold text-rose-700 tabular-nums dark:text-rose-300">
                {formatRubShort(totals.ads)} ₽
              </span>
            </span>
          )}
          {totals.revenue > 0 && totals.ads > 0 && (
            <span className="rounded-md bg-amber-50 px-2 py-1 dark:bg-amber-950/40">
              <span className="text-muted-foreground">ДРР </span>
              <span className="font-semibold text-amber-700 tabular-nums dark:text-amber-300">
                {((totals.ads / totals.revenue) * 100).toFixed(1)}%
              </span>
            </span>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {error ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            {error}
          </div>
        ) : !data || visiblePoints.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            {loading ? 'Загрузка…' : 'Нет данных для отображения'}
          </div>
        ) : (
          <ChartShell
            data={visiblePoints}
            series={series}
            xKey="date"
            height={260}
            variant="rich"
            yAxes={yAxes}
            formatTooltipLabel={(label) => {
              if (typeof label !== 'string') return String(label ?? '');
              const d = new Date(label);
              if (Number.isNaN(d.getTime())) return label;
              return d.toLocaleDateString('ru-RU', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              });
            }}
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
      <OzonSyncSection
        accountId={parsed.accountId}
        showPreflightWarning={false}
        title="Синхронизация данных"
      />
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
