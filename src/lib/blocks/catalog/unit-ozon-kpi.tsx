// PURPOSE: Блок «Ozon · KPI» — 4-6 StatCard в горизонтальной сетке
// (Выручка/Заказы/Расход/ДРР/AOV/CPO). Поддерживает delta vs прошлый период
// и мини-sparkline.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Activity, AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useLastFetched } from '@/lib/blocks/use-last-fetched';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { StatCard } from '@/components/blocks/stat-card';
import {
  PeriodPicker,
  resolvePeriod,
  type PeriodPreset,
  type PeriodValue,
} from '@/components/blocks/period-picker';
import { OzonAccountSelector } from '@/components/marketplaces/ozon-account-selector';
import { OzonSyncSection } from '@/components/unit-economics/ozon-sync-section';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import type {
  BlockDef,
  BlockRenderProps,
  BlockSettingsFormProps,
} from '../types';
import type { OzonKpiResponse } from '@/app/api/marketplaces/ozon/kpi/route';

const VisibleCardsSchema = z.object({
  revenue: z.boolean().default(true),
  orders: z.boolean().default(true),
  ads: z.boolean().default(true),
  drr: z.boolean().default(true),
  aov: z.boolean().default(false),
  cpo: z.boolean().default(false),
});

export const OzonKpiBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
  periodPreset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('7d'),
  customFrom: z.string().nullable().default(null),
  customTo: z.string().nullable().default(null),
  /** Режим сравнения для delta-бейджей. previous = предыдущий период (default), week-ago = тот же период неделю назад. */
  compareMode: z.enum(['previous', 'week-ago']).default('previous'),
  visibleCards: VisibleCardsSchema.default({}),
});

export type OzonKpiBlockConfig = z.infer<typeof OzonKpiBlockConfigSchema>;

function parseConfig(raw: unknown): OzonKpiBlockConfig {
  return OzonKpiBlockConfigSchema.parse(raw ?? {});
}

function deltaPercent(current: number, previous: number): number {
  if (previous === 0) return current === 0 ? 0 : 100;
  return ((current - previous) / previous) * 100;
}

function formatForTooltip(value: number, kind: 'rub' | 'int' | 'pct'): string {
  if (!Number.isFinite(value)) return '—';
  if (kind === 'rub') {
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (kind === 'pct') {
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + '%';
  }
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
}

function buildDeltaTooltip(
  metric: string,
  current: number,
  previous: number,
  baselineLabel: string,
  kind: 'rub' | 'int' | 'pct',
): string {
  const diff = current - previous;
  const sign = diff > 0 ? '+' : '';
  return (
    `${metric}: ${formatForTooltip(current, kind)} ` +
    `(vs ${baselineLabel.toLowerCase()}: ${formatForTooltip(previous, kind)}, ` +
    `разница ${sign}${formatForTooltip(diff, kind)})`
  );
}

type CompareMode = 'previous' | 'week-ago';

const COMPARE_OPTIONS: Array<{ value: CompareMode; label: string; description: string }> = [
  {
    value: 'previous',
    label: 'Прошлый период',
    description: 'Сравнение с предыдущим отрезком той же длины (напр. 7д ↔ предыдущие 7д).',
  },
  {
    value: 'week-ago',
    label: 'Неделя назад',
    description: 'Сравнение с той же датой неделю назад (день-к-дню, учитывает weekly seasonality).',
  },
];

function RenderOzonKpi({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const [period, setPeriod] = useState<PeriodValue>({
    preset: config.periodPreset as PeriodPreset,
    customFrom: config.customFrom,
    customTo: config.customTo,
  });
  const [compareMode, setCompareMode] = useState<CompareMode>(config.compareMode);
  const [data, setData] = useState<OzonKpiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const { markFetched, label: lastFetchedLabel, justUpdated } = useLastFetched();

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
        compareMode,
      });
      const res = await fetch(`/api/marketplaces/ozon/kpi?${params}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      if (res.ok && json.ok) {
        setData(json as OzonKpiResponse);
        markFetched();
      } else {
        setError(json.error ?? `HTTP ${res.status}`);
        setData(null);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [config.accountId, period.preset, period.customFrom, period.customTo, compareMode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sparklineRevenue = useMemo(
    () => (data?.byDay ?? []).map((d) => d.revenueRub),
    [data],
  );
  const sparklineOrders = useMemo(
    () => (data?.byDay ?? []).map((d) => d.orders),
    [data],
  );
  const sparklineAds = useMemo(() => (data?.byDay ?? []).map((d) => d.adsRub), [data]);

  // Публикуем KPI как источники для cell-binding (модалка «Связать ячейку»).
  // Ключи и лейблы match'атся с /api/blocks/sources fieldsForBlock.
  // Previous-period поля и delta% — для цельной модалки связей и hero-блоков.
  const prevRevenue = data?.previous.revenueRub ?? 0;
  const prevOrders = data?.previous.orders ?? 0;
  const prevAds = data?.previous.adsRub ?? 0;
  const currRevenue = data?.current.revenueRub ?? 0;
  const currOrders = data?.current.orders ?? 0;
  const currAds = data?.current.adsRub ?? 0;
  const deltaRevenuePct =
    prevRevenue > 0 ? Math.round(((currRevenue - prevRevenue) / prevRevenue) * 1000) / 10 : 0;
  const deltaOrdersPct =
    prevOrders > 0 ? Math.round(((currOrders - prevOrders) / prevOrders) * 1000) / 10 : 0;
  const deltaAdsPct =
    prevAds > 0 ? Math.round(((currAds - prevAds) / prevAds) * 1000) / 10 : 0;

  useBlockValuePublisher(instance.id, {
    value: currRevenue,
    revenue: currRevenue,
    orders: currOrders,
    ads: currAds,
    drr: data?.current.drrPct ?? 0,
    aov: data?.current.aovRub ?? 0,
    cpo: data?.current.cpoRub ?? 0,
    revenuePrev: prevRevenue,
    ordersPrev: prevOrders,
    adsPrev: prevAds,
    deltaRevenuePct,
    deltaOrdersPct,
    deltaAdsPct,
    __labels:
      'value=Выручка / период,revenue=Выручка / период,orders=Заказы / период,' +
      'ads=Расход на рекламу,drr=ДРР %,aov=Средний чек,cpo=Средний CPO,' +
      'revenuePrev=Выручка / прошлый период,ordersPrev=Заказы / прошлый период,' +
      'adsPrev=Реклама / прошлый период,deltaRevenuePct=Δ Выручка %,' +
      'deltaOrdersPct=Δ Заказы %,deltaAdsPct=Δ Реклама %',
    __money: 'value,revenue,ads,aov,cpo,revenuePrev,adsPrev',
  });

  return (
    <Card className="flex h-full flex-col overflow-hidden p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={setPeriod} compact />
        <div
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
          title="Бейджи ↗/↘ справа от каждой метрики показывают изменение относительно этого baseline'а."
        >
          <span className="hidden sm:inline">Сравнить с:</span>
          <select
            value={compareMode}
            onChange={(e) => setCompareMode(e.target.value as CompareMode)}
            className="rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[11px] hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
          >
            {COMPARE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value} title={opt.description}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
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
            title="Performance API не подключён — расход взят по эвристике из транзакций"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            Реклама ≈
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {lastFetchedLabel && (
            <span
              className={
                'flex items-center gap-1 text-[10px] transition-colors ' +
                (justUpdated ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')
              }
              title={`Последнее обновление: ${lastFetchedLabel}`}
            >
              {justUpdated && <Check className="h-2.5 w-2.5" />}
              {lastFetchedLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => fetchData()}
            disabled={loading}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Обновить данные"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
      {error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-[12px] text-muted-foreground">
          {error}
          <button
            type="button"
            onClick={() => fetchData()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent"
          >
            <RefreshCw className="h-3 w-3" /> Обновить
          </button>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
          {config.visibleCards.revenue && (
            <StatCard
              label="Выручка"
              value={data?.current.revenueRub ?? 0}
              format="rub"
              delta={
                data && {
                  value: deltaPercent(data.current.revenueRub, data.previous.revenueRub),
                  label: `vs ${data.compareLabel}`,
                  tooltip: buildDeltaTooltip(
                    'Выручка',
                    data.current.revenueRub,
                    data.previous.revenueRub,
                    data.compareLabel,
                    'rub',
                  ),
                  goodDirection: 'up',
                }
              }
              sparkline={sparklineRevenue.length > 1 ? sparklineRevenue : null}
              accent="emerald"
              loading={loading && !data}
            />
          )}
          {config.visibleCards.orders && (
            <StatCard
              label="Заказы"
              value={data?.current.orders ?? 0}
              format="int"
              delta={
                data && {
                  value: deltaPercent(data.current.orders, data.previous.orders),
                  label: `vs ${data.compareLabel}`,
                  tooltip: buildDeltaTooltip(
                    'Заказы',
                    data.current.orders,
                    data.previous.orders,
                    data.compareLabel,
                    'int',
                  ),
                  goodDirection: 'up',
                }
              }
              sparkline={sparklineOrders.length > 1 ? sparklineOrders : null}
              accent="sky"
              loading={loading && !data}
            />
          )}
          {config.visibleCards.ads && (
            <StatCard
              label="Расход на рекламу"
              value={data?.current.adsRub ?? 0}
              format="rub"
              delta={
                data && {
                  value: deltaPercent(data.current.adsRub, data.previous.adsRub),
                  label: `vs ${data.compareLabel}`,
                  tooltip: buildDeltaTooltip(
                    'Расход на рекламу',
                    data.current.adsRub,
                    data.previous.adsRub,
                    data.compareLabel,
                    'rub',
                  ),
                  goodDirection: 'down',
                }
              }
              sparkline={sparklineAds.length > 1 ? sparklineAds : null}
              hint={
                data?.current.cpoRub != null
                  ? `Средний CPO: ${Math.round(data.current.cpoRub)} ₽ · CPC + CPO`
                  : 'CPC/CPM (per-SKU) + CPO (агрегат)'
              }
              accent="rose"
              loading={loading && !data}
            />
          )}
          {config.visibleCards.drr && (
            <StatCard
              label="ДРР"
              value={data?.current.drrPct ?? 0}
              format="pct"
              tone={
                data?.current.drrPct !== null &&
                data?.current.drrPct !== undefined &&
                data.current.drrPct > 20
                  ? 'warning'
                  : 'default'
              }
              delta={
                data && data.current.drrPct !== null && data.previous.drrPct !== null
                  ? {
                      value: data.current.drrPct - data.previous.drrPct,
                      suffix: 'п.п.',
                      label: `vs ${data.compareLabel}`,
                      tooltip: buildDeltaTooltip(
                        'ДРР',
                        data.current.drrPct,
                        data.previous.drrPct,
                        data.compareLabel,
                        'pct',
                      ),
                      goodDirection: 'down',
                    }
                  : null
              }
              hint="Цель: ≤ 20%"
              accent="amber"
              loading={loading && !data}
            />
          )}
          {config.visibleCards.aov && (
            <StatCard
              label="Средний чек"
              value={data?.current.aovRub ?? 0}
              format="rub"
              delta={
                data && data.current.aovRub !== null && data.previous.aovRub !== null
                  ? {
                      value: deltaPercent(data.current.aovRub, data.previous.aovRub),
                      label: `vs ${data.compareLabel}`,
                      tooltip: buildDeltaTooltip(
                        'Средний чек',
                        data.current.aovRub,
                        data.previous.aovRub,
                        data.compareLabel,
                        'rub',
                      ),
                      goodDirection: 'up',
                    }
                  : null
              }
              accent="violet"
              loading={loading && !data}
            />
          )}
          {config.visibleCards.cpo && (
            <StatCard
              label="Средний CPO"
              value={data?.current.cpoRub ?? 0}
              format="rub"
              delta={
                data && data.current.cpoRub !== null && data.previous.cpoRub !== null
                  ? {
                      value: deltaPercent(data.current.cpoRub, data.previous.cpoRub),
                      label: `vs ${data.compareLabel}`,
                      tooltip: buildDeltaTooltip(
                        'Средний CPO',
                        data.current.cpoRub,
                        data.previous.cpoRub,
                        data.compareLabel,
                        'rub',
                      ),
                      goodDirection: 'down',
                    }
                  : null
              }
              accent="rose"
              loading={loading && !data}
            />
          )}
        </div>
      )}
    </Card>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  function patch(updates: Partial<OzonKpiBlockConfig>) {
    const next = { ...parsed, ...updates };
    onChange(next as unknown as Record<string, unknown>);
  }
  return (
    <div className="space-y-4">
      <OzonAccountSelector
        value={parsed.accountId}
        onChange={(id) => patch({ accountId: id })}
        showPerfStatus
      />
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">Дефолтный период</Label>
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
        <Label className="text-[11px] text-muted-foreground">Сравнение по умолчанию</Label>
        <select
          value={parsed.compareMode}
          onChange={(e) => patch({ compareMode: e.target.value as 'previous' | 'week-ago' })}
          className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-[12px] hover:bg-accent focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {COMPARE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label} — {opt.description}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label className="text-[11px] text-muted-foreground">Видимые карточки</Label>
        <div className="space-y-2">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Основные
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {(
                [
                  ['revenue', 'Выручка'],
                  ['orders', 'Заказы'],
                  ['ads', 'Расход'],
                  ['drr', 'ДРР'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between rounded-md border border-border/60 px-2 py-1.5 text-[12px]"
                >
                  <span>{label}</span>
                  <Switch
                    checked={parsed.visibleCards[key]}
                    onCheckedChange={(on) =>
                      patch({
                        visibleCards: { ...parsed.visibleCards, [key]: on },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Дополнительные
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ['aov', 'Средний чек'],
                  ['cpo', 'Средний CPO'],
                ] as const
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex items-center justify-between rounded-md border border-dashed border-border/60 px-2 py-1.5 text-[12px]"
                >
                  <span>{label}</span>
                  <Switch
                    checked={parsed.visibleCards[key]}
                    onCheckedChange={(on) =>
                      patch({
                        visibleCards: { ...parsed.visibleCards, [key]: on },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
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

export const UnitOzonKpiBlock: BlockDef = {
  type: 'unit.ozon-kpi',
  displayName: 'Ozon · KPI',
  description:
    'Ключевые метрики Ozon: выручка, заказы, реклама, ДРР, AOV, CPO. Сравнение с предыдущим периодом + sparkline.',
  category: 'stats',
  icon: Activity,
  defaultSize: { w: 12, h: 4 },
  minSize: { w: 4, h: 3 },
  pages: ['marketplaces-ozon-dashboard', '*'],
  configSchema: OzonKpiBlockConfigSchema,
  defaultConfig: () => OzonKpiBlockConfigSchema.parse({}),
  SettingsForm,
  Render: RenderOzonKpi,
};
