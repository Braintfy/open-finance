// PURPOSE: Блок «Ozon · Кампании» — таблица кампаний с расходом и заказами.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Megaphone } from 'lucide-react';
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
import type { OzonCampaignsResponse } from '@/app/api/marketplaces/ozon/campaigns/route';

export const OzonCampaignsBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
  periodPreset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('30d'),
  customFrom: z.string().nullable().default(null),
  customTo: z.string().nullable().default(null),
});

function parseConfig(raw: unknown) {
  return OzonCampaignsBlockConfigSchema.parse(raw ?? {});
}

function stateBadge(state: string | null): { label: string; cls: string } {
  if (!state) return { label: '—', cls: 'bg-muted text-muted-foreground' };
  if (state.includes('RUNNING'))
    return {
      label: 'Активна',
      cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
    };
  if (state.includes('PAUSED'))
    return {
      label: 'Пауза',
      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
    };
  if (state.includes('FINISHED'))
    return {
      label: 'Завершена',
      cls: 'bg-muted text-muted-foreground',
    };
  return { label: state, cls: 'bg-muted text-muted-foreground' };
}

function RenderOzonCampaigns({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const [period, setPeriod] = useState<PeriodValue>({
    preset: config.periodPreset as PeriodPreset,
    customFrom: config.customFrom,
    customTo: config.customTo,
  });
  const [data, setData] = useState<OzonCampaignsResponse | null>(null);
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
      const res = await fetch(`/api/marketplaces/ozon/campaigns?${params}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      if (res.ok && json.ok) setData(json as OzonCampaignsResponse);
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
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            {loading
              ? 'Загрузка…'
              : 'Нет рекламных кампаний. Подключите Performance API и запустите sync.'}
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Кампания</th>
                <th className="px-2 py-1.5 font-medium">Тип</th>
                <th className="px-2 py-1.5 font-medium">Статус</th>
                <th className="px-2 py-1.5 text-right font-medium">Бюджет/день</th>
                <th className="px-2 py-1.5 text-right font-medium">Расход</th>
                <th className="px-2 py-1.5 text-right font-medium">Заказы</th>
                <th className="px-2 py-1.5 text-right font-medium">ДРР</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.rows.map((c) => {
                const badge = stateBadge(c.state);
                return (
                  <tr key={c.campaignId} className="hover:bg-accent/20">
                    <td className="px-2 py-1.5">
                      <div className="font-medium">{c.title ?? c.campaignId}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {c.campaignId}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-[11px]">
                      {c.paymentType ?? '—'}
                      {c.advObjectType ? ` · ${c.advObjectType}` : ''}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={'rounded-full px-1.5 py-0.5 text-[10px] ' + badge.cls}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {c.dailyBudgetRub
                        ? Math.round(c.dailyBudgetRub).toLocaleString('ru-RU') + ' ₽'
                        : '—'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {Math.round(c.expenseRub).toLocaleString('ru-RU')} ₽
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.orders}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {c.drrPct !== null ? c.drrPct.toFixed(1) + '%' : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
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
        showPerfStatus
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

export const UnitOzonCampaignsBlock: BlockDef = {
  type: 'unit.ozon-campaigns',
  displayName: 'Ozon · Кампании',
  description:
    'Список рекламных кампаний Ozon с расходом, заказами и ДРР за период.',
  category: 'tables',
  icon: Megaphone,
  defaultSize: { w: 8, h: 6 },
  minSize: { w: 4, h: 4 },
  pages: ['marketplaces-ozon-dashboard', '*'],
  configSchema: OzonCampaignsBlockConfigSchema,
  defaultConfig: () => OzonCampaignsBlockConfigSchema.parse({}),
  SettingsForm,
  Render: RenderOzonCampaigns,
};
