// PURPOSE: Блок «Ozon · ABC-анализ» — распределение выручки по группам A/B/C.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { PieChart } from 'lucide-react';
import { Card } from '@/components/ui/card';
import {
  PeriodPicker,
  resolvePeriod,
  type PeriodPreset,
  type PeriodValue,
} from '@/components/blocks/period-picker';
import { OzonAccountSelector } from '@/components/marketplaces/ozon-account-selector';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { usePersistedPeriodValue } from '@/lib/blocks/use-persisted-period';
import type {
  BlockDef,
  BlockRenderProps,
  BlockSettingsFormProps,
} from '../types';
import type { OzonAbcResponse } from '@/app/api/marketplaces/ozon/abc/route';

export const OzonAbcBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
  periodPreset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('30d'),
  customFrom: z.string().nullable().default(null),
  customTo: z.string().nullable().default(null),
});

function parseConfig(raw: unknown) {
  return OzonAbcBlockConfigSchema.parse(raw ?? {});
}

const GROUP_COLORS = {
  A: { bg: 'bg-emerald-100 dark:bg-emerald-950', text: 'text-emerald-700 dark:text-emerald-300', stripe: '#10b981' },
  B: { bg: 'bg-amber-100 dark:bg-amber-950', text: 'text-amber-700 dark:text-amber-300', stripe: '#f59e0b' },
  C: { bg: 'bg-rose-100 dark:bg-rose-950', text: 'text-rose-700 dark:text-rose-300', stripe: '#f43f5e' },
};

function RenderOzonAbc({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const { value: period, setValue: setPeriod } = usePersistedPeriodValue({
    instanceId: instance.id,
    initial: {
      preset: config.periodPreset,
      customFrom: config.customFrom,
      customTo: config.customTo,
    },
  });
  const [data, setData] = useState<OzonAbcResponse | null>(null);
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
      setError('Подключите Ozon-магазин в настройках блока.');
      setData(null);
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
      const res = await fetch(`/api/marketplaces/ozon/abc?${params}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      if (res.ok && json.ok) setData(json as OzonAbcResponse);
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
  }, [config.accountId, period.preset, period.customFrom, period.customTo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Cell-binding source: A/B/C groups как primitives для биндинга в Excel-блоки.
  const aGroup = data?.groups.find((g) => g.label === 'A');
  const bGroup = data?.groups.find((g) => g.label === 'B');
  const cGroup = data?.groups.find((g) => g.label === 'C');
  useBlockValuePublisher(instance.id, {
    value: aGroup?.productCount ?? 0,
    aRevenue: aGroup?.revenueRub ?? 0,
    bRevenue: bGroup?.revenueRub ?? 0,
    cRevenue: cGroup?.revenueRub ?? 0,
    __labels:
      'value=Группа A (SKU),aRevenue=Выручка группы A,' +
      'bRevenue=Выручка группы B,cRevenue=Выручка группы C',
    __money: 'aRevenue,bRevenue,cRevenue',
  });

  return (
    <Card className="flex h-full flex-col overflow-hidden p-3">
      <div className="mb-2 flex items-center gap-2">
        <PeriodPicker value={period} onChange={setPeriod} compact />
      </div>
      {error ? (
        <div className="flex flex-1 items-center justify-center text-center text-[12px] text-muted-foreground">
          {error}
        </div>
      ) : !data || data.totalRevenueRub === 0 ? (
        <div className="flex flex-1 items-center justify-center text-center text-[12px] text-muted-foreground">
          {loading ? 'Загрузка…' : 'Нет данных за период.'}
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-3 overflow-hidden">
          <div className="grid grid-cols-3 gap-2">
            {data.groups.map((g) => {
              const c = GROUP_COLORS[g.label];
              return (
                <div
                  key={g.label}
                  className={'rounded-lg p-2 ' + c.bg}
                >
                  <div className={'text-[10px] uppercase tracking-wider ' + c.text}>
                    Группа {g.label}
                  </div>
                  <div className={'text-lg font-semibold tabular-nums ' + c.text}>
                    {g.sharePct.toFixed(1)}%
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {g.productCount} SKU ·{' '}
                    {Math.round(g.revenueRub).toLocaleString('ru-RU')} ₽
                  </div>
                </div>
              );
            })}
          </div>
          <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border/40">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                <tr className="text-left text-muted-foreground">
                  <th className="px-2 py-1.5 font-medium">Артикул / Товар</th>
                  <th className="px-2 py-1.5 text-right font-medium">Выручка</th>
                  <th className="px-2 py-1.5 text-right font-medium">% накоп.</th>
                  <th className="px-2 py-1.5 text-center font-medium">Группа</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {data.rows.slice(0, 100).map((r) => {
                  const c = GROUP_COLORS[r.group];
                  return (
                    <tr key={r.offerId} className="hover:bg-accent/20">
                      <td className="px-2 py-1.5">
                        <div className="font-medium">{r.name ?? r.offerId}</div>
                        <div className="font-mono text-[10px] text-muted-foreground">
                          {r.offerId}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {Math.round(r.revenueRub).toLocaleString('ru-RU')} ₽
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                        {r.cumulativeSharePct.toFixed(1)}%
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span
                          className={
                            'rounded-full px-2 py-0.5 text-[10px] font-semibold ' +
                            c.bg +
                            ' ' +
                            c.text
                          }
                        >
                          {r.group}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  return (
    <div className="space-y-4">
      <OzonAccountSelector
        value={parsed.accountId}
        onChange={(id) =>
          onChange({ ...parsed, accountId: id } as unknown as Record<string, unknown>)
        }
      />
      <PeriodPicker
        value={{
          preset: parsed.periodPreset as PeriodPreset,
          customFrom: parsed.customFrom,
          customTo: parsed.customTo,
        }}
        onChange={(v) =>
          onChange({
            ...parsed,
            periodPreset: v.preset,
            customFrom: v.customFrom ?? null,
            customTo: v.customTo ?? null,
          } as unknown as Record<string, unknown>)
        }
      />
    </div>
  );
}

export const UnitOzonAbcBlock: BlockDef = {
  type: 'unit.ozon-abc',
  displayName: 'Ozon · ABC-анализ',
  description: 'ABC-распределение товаров: 80/15/5% выручки (Pareto).',
  category: 'tables',
  icon: PieChart,
  defaultSize: { w: 8, h: 7 },
  minSize: { w: 4, h: 5 },
  pages: ['marketplaces-ozon-dashboard', '*'],
  configSchema: OzonAbcBlockConfigSchema,
  defaultConfig: () => OzonAbcBlockConfigSchema.parse({}),
  SettingsForm,
  Render: RenderOzonAbc,
};
