// PURPOSE: Блок «Ozon · Поисковые фразы».

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Search, AlertCircle } from 'lucide-react';
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
import type { OzonSearchPhrasesResponse } from '@/app/api/marketplaces/ozon/search-phrases/route';

export const OzonSearchPhrasesBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
  periodPreset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('30d'),
  customFrom: z.string().nullable().default(null),
  customTo: z.string().nullable().default(null),
  limit: z.number().int().min(10).max(500).default(100),
});

function parseConfig(raw: unknown) {
  return OzonSearchPhrasesBlockConfigSchema.parse(raw ?? {});
}

function RenderOzonSearchPhrases({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const [period, setPeriod] = useState<PeriodValue>({
    preset: config.periodPreset as PeriodPreset,
    customFrom: config.customFrom,
    customTo: config.customTo,
  });
  const [data, setData] = useState<OzonSearchPhrasesResponse | null>(null);
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
        limit: String(config.limit),
      });
      const res = await fetch(`/api/marketplaces/ozon/search-phrases?${params}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      if (res.ok && json.ok) setData(json as OzonSearchPhrasesResponse);
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
            {loading ? 'Загрузка…' : 'Нет данных. Поисковые фразы требуют Performance API.'}
            <Link
              href="/settings/integrations"
              className="text-[11px] text-primary hover:underline"
            >
              Подключить Performance API →
            </Link>
          </div>
        ) : (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                <th className="px-2 py-1.5 font-medium">Фраза</th>
                <th className="px-2 py-1.5 text-right font-medium">Показы</th>
                <th className="px-2 py-1.5 text-right font-medium">Клики</th>
                <th className="px-2 py-1.5 text-right font-medium">CTR</th>
                <th className="px-2 py-1.5 text-right font-medium">Заказы</th>
                <th className="px-2 py-1.5 text-right font-medium">Расход</th>
                <th className="px-2 py-1.5 text-right font-medium">CPO</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.rows.map((r, i) => (
                <tr key={`${r.phrase}_${i}`} className="hover:bg-accent/20">
                  <td className="px-2 py-1.5 font-medium" title={r.phrase}>
                    <span className="line-clamp-1">{r.phrase}</span>
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.views.toLocaleString('ru-RU')}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.clicks.toLocaleString('ru-RU')}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {r.ctrPct !== null ? r.ctrPct.toFixed(1) + '%' : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.orders}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {Math.round(r.expenseRub).toLocaleString('ru-RU')} ₽
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {r.cpoRub !== null ? Math.round(r.cpoRub) + ' ₽' : '—'}
                  </td>
                </tr>
              ))}
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

export const UnitOzonSearchPhrasesBlock: BlockDef = {
  type: 'unit.ozon-search-phrases',
  displayName: 'Ozon · Поисковые фразы',
  description: 'Топ поисковых запросов: показы, клики, CTR, расход, CPO. Требует Performance API.',
  category: 'tables',
  icon: Search,
  defaultSize: { w: 8, h: 6 },
  minSize: { w: 4, h: 4 },
  pages: ['marketplaces-ozon-dashboard', '*'],
  configSchema: OzonSearchPhrasesBlockConfigSchema,
  defaultConfig: () => OzonSearchPhrasesBlockConfigSchema.parse({}),
  SettingsForm,
  Render: RenderOzonSearchPhrases,
};
