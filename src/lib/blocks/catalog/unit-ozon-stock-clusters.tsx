// PURPOSE: Блок «Ozon · Остатки по складам» — таблица распределения
// остатков по типу склада (FBO/FBS/CrossBorder).

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Warehouse } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { OzonAccountSelector } from '@/components/marketplaces/ozon-account-selector';
import type {
  BlockDef,
  BlockRenderProps,
  BlockSettingsFormProps,
} from '../types';
import type { OzonStockClustersResponse } from '@/app/api/marketplaces/ozon/stock-clusters/route';

export const OzonStockClustersBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
});
export type OzonStockClustersBlockConfig = z.infer<
  typeof OzonStockClustersBlockConfigSchema
>;

function parseConfig(raw: unknown): OzonStockClustersBlockConfig {
  return OzonStockClustersBlockConfigSchema.parse(raw ?? {});
}

function RenderOzonStockClusters({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const [data, setData] = useState<OzonStockClustersResponse | null>(null);
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
      const res = await fetch(
        `/api/marketplaces/ozon/stock-clusters?accountId=${config.accountId}`,
      );
      const json = await res.json();
      if (!mountedRef.current) return;
      if (res.ok && json.ok) setData(json as OzonStockClustersResponse);
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
  }, [config.accountId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <div className="border-b border-border/40 px-3 py-2 text-[11px] font-medium text-muted-foreground">
        Остатки по типу склада
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            {error}
          </div>
        ) : !data || data.rows.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            {loading ? 'Загрузка…' : 'Нет данных. Запустите стейдж stocks.'}
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Склад</th>
                <th className="px-2 py-1.5 text-right font-medium">Остаток</th>
                <th className="px-2 py-1.5 text-right font-medium">SKU</th>
                <th className="px-2 py-1.5 text-right font-medium">Доля</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.rows.map((r) => (
                <tr key={r.cluster}>
                  <td className="px-2 py-1.5 font-medium">{r.cluster}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.stock.toLocaleString('ru-RU')}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {r.productCount}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                    {r.sharePct.toFixed(1)}%
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
      />
    </div>
  );
}

export const UnitOzonStockClustersBlock: BlockDef = {
  type: 'unit.ozon-stock-clusters',
  displayName: 'Ozon · Остатки по складам',
  description:
    'Распределение текущих остатков по типу склада: FBO (Ozon), FBS (продавец), Cross-border.',
  category: 'tables',
  icon: Warehouse,
  defaultSize: { w: 6, h: 5 },
  minSize: { w: 4, h: 3 },
  pages: ['marketplaces-ozon-dashboard', '*'],
  configSchema: OzonStockClustersBlockConfigSchema,
  defaultConfig: () => OzonStockClustersBlockConfigSchema.parse({}),
  SettingsForm,
  Render: RenderOzonStockClusters,
};
