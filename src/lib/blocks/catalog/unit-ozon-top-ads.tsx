// PURPOSE: Блок «Ozon · Топ рекламы» — таблица с SKU, расходом, CTR/CPC/CPO/ДРР.
// Если perf-данных нет — показывает CTA подключения Performance API.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Megaphone, ArrowUpDown, AlertCircle } from 'lucide-react';
import { Card } from '@/components/ui/card';
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
import type { OzonTopAdsResponse } from '@/app/api/marketplaces/ozon/top-ads/route';

export const OzonTopAdsBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
  periodPreset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('30d'),
  customFrom: z.string().nullable().default(null),
  customTo: z.string().nullable().default(null),
  limit: z.number().int().min(5).max(500).default(50),
});

export type OzonTopAdsBlockConfig = z.infer<typeof OzonTopAdsBlockConfigSchema>;

function parseConfig(raw: unknown): OzonTopAdsBlockConfig {
  return OzonTopAdsBlockConfigSchema.parse(raw ?? {});
}

type SortKey = 'expenseRub' | 'drrPct' | 'orders' | 'clicks' | 'ctrPct' | 'cpcRub' | 'cpoRub';

function fmtRub(v: number): string {
  return Math.round(v).toLocaleString('ru-RU') + ' ₽';
}
function fmtPct(v: number | null): string {
  return v === null ? '—' : v.toFixed(1) + '%';
}
function fmtRubOrDash(v: number | null): string {
  return v === null ? '—' : fmtRub(v);
}

function drrBadgeColor(drr: number | null): string {
  if (drr === null) return 'text-muted-foreground';
  if (drr > 30) return 'text-rose-700 dark:text-rose-400 font-semibold';
  if (drr > 20) return 'text-amber-700 dark:text-amber-400 font-medium';
  if (drr > 10) return 'text-sky-700 dark:text-sky-400';
  return 'text-emerald-700 dark:text-emerald-400 font-medium';
}

function RenderOzonTopAds({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const [period, setPeriod] = useState<PeriodValue>({
    preset: config.periodPreset as PeriodPreset,
    customFrom: config.customFrom,
    customTo: config.customTo,
  });
  const [data, setData] = useState<OzonTopAdsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'expenseRub',
    dir: 'desc',
  });
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
        limit: String(config.limit),
      });
      const res = await fetch(`/api/marketplaces/ozon/top-ads?${params}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      if (res.ok && json.ok) setData(json as OzonTopAdsResponse);
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
    config.limit,
    period.preset,
    period.customFrom,
    period.customTo,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const rows = useMemo(() => {
    if (!data) return [];
    const { key, dir } = sort;
    return [...data.rows].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      const an = av === null ? -Infinity : av;
      const bn = bv === null ? -Infinity : bv;
      return dir === 'asc' ? an - bn : bn - an;
    });
  }, [data, sort]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' },
    );
  }

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
        <PeriodPicker value={period} onChange={setPeriod} compact />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            {error}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-muted-foreground">
            <AlertCircle className="h-5 w-5" />
            {loading
              ? 'Загрузка…'
              : 'Нет рекламных данных. Подключите Performance API в '}
            {!loading && (
              <Link
                href="/settings/integrations"
                className="text-primary hover:underline"
              >
                Настройках → Интеграции
              </Link>
            )}
          </div>
        ) : (
          <table className="w-full min-w-[700px] text-[11px]">
            <thead className="sticky top-0 z-10 bg-muted/60 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Товар</th>
                <SortHeader
                  label="Расход"
                  sortKey="expenseRub"
                  active={sort}
                  onClick={() => toggleSort('expenseRub')}
                />
                <SortHeader
                  label="ДРР"
                  sortKey="drrPct"
                  active={sort}
                  onClick={() => toggleSort('drrPct')}
                />
                <SortHeader
                  label="Заказы"
                  sortKey="orders"
                  active={sort}
                  onClick={() => toggleSort('orders')}
                />
                <SortHeader
                  label="CTR"
                  sortKey="ctrPct"
                  active={sort}
                  onClick={() => toggleSort('ctrPct')}
                />
                <SortHeader
                  label="CPC"
                  sortKey="cpcRub"
                  active={sort}
                  onClick={() => toggleSort('cpcRub')}
                />
                <SortHeader
                  label="CPO"
                  sortKey="cpoRub"
                  active={sort}
                  onClick={() => toggleSort('cpoRub')}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((r) => (
                <tr key={r.sku} className="hover:bg-accent/20">
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{r.name ?? r.sku}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">
                      {r.article ?? r.sku}
                    </div>
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtRub(r.expenseRub)}</td>
                  <td className={'px-2 py-1.5 tabular-nums ' + drrBadgeColor(r.drrPct)}>
                    {fmtPct(r.drrPct)}
                  </td>
                  <td className="px-2 py-1.5 tabular-nums">{r.orders}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtPct(r.ctrPct)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtRubOrDash(r.cpcRub)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{fmtRubOrDash(r.cpoRub)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function SortHeader({
  label,
  sortKey,
  active,
  onClick,
}: {
  label: string;
  sortKey: SortKey;
  active: { key: SortKey; dir: 'asc' | 'desc' };
  onClick: () => void;
}) {
  const isActive = active.key === sortKey;
  return (
    <th
      className={
        'cursor-pointer px-2 py-1.5 font-medium hover:text-foreground ' +
        (isActive ? 'text-foreground' : '')
      }
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown
          className={
            'h-2.5 w-2.5 ' +
            (isActive ? 'text-primary' : 'text-muted-foreground/40')
          }
        />
      </span>
    </th>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  function patch(updates: Partial<OzonTopAdsBlockConfig>) {
    onChange({ ...parsed, ...updates } as unknown as Record<string, unknown>);
  }
  return (
    <div className="space-y-4">
      <OzonAccountSelector
        value={parsed.accountId}
        onChange={(id) => patch({ accountId: id })}
        showPerfStatus
      />
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
      <div className="space-y-1.5">
        <label className="text-[11px] text-muted-foreground">Топ N товаров</label>
        <input
          type="number"
          min={5}
          max={500}
          value={parsed.limit}
          onChange={(e) => patch({ limit: Number(e.target.value) || 50 })}
          className="h-8 w-24 rounded-md border border-input bg-background px-2 text-xs"
        />
      </div>
    </div>
  );
}

export const UnitOzonTopAdsBlock: BlockDef = {
  type: 'unit.ozon-top-ads',
  displayName: 'Ozon · Топ рекламы',
  description:
    'Топ товаров по рекламному расходу: расход/ДРР/заказы/CTR/CPC/CPO. Требует Performance API.',
  category: 'tables',
  icon: Megaphone,
  defaultSize: { w: 8, h: 6 },
  minSize: { w: 4, h: 4 },
  pages: ['marketplaces-ozon-dashboard', '*'],
  configSchema: OzonTopAdsBlockConfigSchema,
  defaultConfig: () => OzonTopAdsBlockConfigSchema.parse({}),
  SettingsForm,
  Render: RenderOzonTopAds,
};
