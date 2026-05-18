// PURPOSE: Блок «Ozon · KPI» — 4-6 StatCard в горизонтальной сетке
// (Выручка/Заказы/Расход/ДРР/AOV/CPO). Поддерживает delta vs прошлый период
// и мини-sparkline.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Activity, AlertTriangle } from 'lucide-react';
import { Card } from '@/components/ui/card';
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

function RenderOzonKpi({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const [period, setPeriod] = useState<PeriodValue>({
    preset: config.periodPreset as PeriodPreset,
    customFrom: config.customFrom,
    customTo: config.customTo,
  });
  const [data, setData] = useState<OzonKpiResponse | null>(null);
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
      });
      const res = await fetch(`/api/marketplaces/ozon/kpi?${params}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      if (res.ok && json.ok) {
        setData(json as OzonKpiResponse);
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
  }, [config.accountId, period.preset, period.customFrom, period.customTo]);

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

  return (
    <Card className="flex h-full flex-col overflow-hidden p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <PeriodPicker value={period} onChange={setPeriod} compact />
        {data?.adsSource === 'transactions-heuristic' && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            title="Performance API не подключён — расход взят по эвристике из транзакций"
          >
            <AlertTriangle className="h-2.5 w-2.5" />
            Реклама ≈
          </span>
        )}
      </div>
      {error ? (
        <div className="flex flex-1 items-center justify-center text-center text-[12px] text-muted-foreground">
          {error}
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
                  label: 'vs прошлый период',
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
                  label: 'vs прошлый период',
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
                  label: 'vs прошлый период',
                  goodDirection: 'down',
                }
              }
              sparkline={sparklineAds.length > 1 ? sparklineAds : null}
              hint={
                data?.current.cpoRub != null
                  ? `Средний CPO: ${Math.round(data.current.cpoRub)} ₽`
                  : undefined
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
                      label: 'vs прошлый',
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
                      label: 'vs прошлый',
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
                      label: 'vs прошлый',
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
        <Label className="text-[11px] text-muted-foreground">Видимые карточки</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {(
            [
              ['revenue', 'Выручка'],
              ['orders', 'Заказы'],
              ['ads', 'Расход'],
              ['drr', 'ДРР'],
              ['aov', 'Средний чек'],
              ['cpo', 'CPO'],
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
