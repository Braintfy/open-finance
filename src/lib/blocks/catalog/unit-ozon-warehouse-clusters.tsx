// PURPOSE: Блок «Ozon · Остатки по кластерам» — географические кластеры
// (источник Performance API `/api/client/cluster/list` + Seller
// `/v1/analytics/stock_on_warehouses`). Опционально показывает заказы/
// выручку за период по кластерам (через сопоставление
// `ozon_orders.raw->>'warehouseName'` → ozon_warehouse_stocks.cluster).

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Map as MapIcon, RefreshCw, AlertCircle, ExternalLink, Lock } from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import {
  PeriodPicker,
  resolvePeriod,
  type PeriodPreset,
  type PeriodValue,
} from '@/components/blocks/period-picker';
import { OzonAccountSelector } from '@/components/marketplaces/ozon-account-selector';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { useBlockPeriod } from '@/lib/blocks/use-block-period';
import type {
  BlockDef,
  BlockRenderProps,
  BlockSettingsFormProps,
} from '../types';
import type {
  OzonClusterStocksResponse,
  OzonClusterStocksRow,
} from '@/app/api/marketplaces/ozon/cluster-stocks-v2/route';

const CLUSTER_COLUMN_KEYS = [
  'clusterName',
  'totalStock',
  'freeStock',
  'reservedStock',
  'promisedStock',
  'skuCount',
  'sharePct',
  'ordersInPeriod',
  'revenueInPeriod',
] as const;
export type ClusterColumnKey = (typeof CLUSTER_COLUMN_KEYS)[number];

export const OzonWarehouseClustersBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
  periodPreset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('30d'),
  customFrom: z.string().nullable().default(null),
  customTo: z.string().nullable().default(null),
  visibleColumns: z
    .array(z.enum(CLUSTER_COLUMN_KEYS))
    .default([
      'clusterName',
      'totalStock',
      'freeStock',
      'reservedStock',
      'sharePct',
      'ordersInPeriod',
      'revenueInPeriod',
    ]),
  showShareBar: z.boolean().default(true),
});
export type OzonWarehouseClustersBlockConfig = z.infer<
  typeof OzonWarehouseClustersBlockConfigSchema
>;

function parseConfig(raw: unknown): OzonWarehouseClustersBlockConfig {
  return OzonWarehouseClustersBlockConfigSchema.parse(raw ?? {});
}

const COLUMN_LABELS: Record<ClusterColumnKey, { label: string; right?: boolean }> = {
  clusterName: { label: 'Кластер' },
  totalStock: { label: 'Всего, шт', right: true },
  freeStock: { label: 'Свободно, шт', right: true },
  reservedStock: { label: 'В резерве, шт', right: true },
  promisedStock: { label: 'Ожидается, шт', right: true },
  skuCount: { label: 'SKU', right: true },
  sharePct: { label: 'Доля, %', right: true },
  ordersInPeriod: { label: 'Заказов / период', right: true },
  revenueInPeriod: { label: 'Выручка / период', right: true },
};

type Sort = { key: ClusterColumnKey; dir: 'asc' | 'desc' } | null;

function sortRows(rows: OzonClusterStocksRow[], sort: Sort): OzonClusterStocksRow[] {
  if (!sort) return rows;
  const out = [...rows];
  out.sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[sort.key];
    const bv = (b as unknown as Record<string, unknown>)[sort.key];
    if (typeof av === 'number' && typeof bv === 'number') {
      return sort.dir === 'asc' ? av - bv : bv - av;
    }
    const as = String(av ?? '');
    const bs = String(bv ?? '');
    return sort.dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
  });
  return out;
}

function fmtNum(v: number): string {
  return v.toLocaleString('ru-RU');
}

function fmtRub(v: number): string {
  return Math.round(v).toLocaleString('ru-RU') + ' ₽';
}

function formatCell(row: OzonClusterStocksRow, key: ClusterColumnKey): string {
  switch (key) {
    case 'clusterName':
      return row.clusterName;
    case 'totalStock':
      return fmtNum(row.totalStock);
    case 'freeStock':
      return fmtNum(row.freeStock);
    case 'reservedStock':
      return fmtNum(row.reservedStock);
    case 'promisedStock':
      return fmtNum(row.promisedStock);
    case 'skuCount':
      return fmtNum(row.skuCount);
    case 'sharePct':
      return row.sharePct.toFixed(1) + '%';
    case 'ordersInPeriod':
      return fmtNum(row.ordersInPeriod);
    case 'revenueInPeriod':
      return fmtRub(row.revenueInPeriod);
  }
}

/** Empty-state карточка: показываем когда rows = 0, со ссылкой на settings
 *  и подсказкой какие стейджи sync нужно запустить. */
function ClusterEmptyState({
  meta,
}: {
  meta: OzonClusterStocksResponse['meta'];
}) {
  const needsStocks = meta.warehouseStocksCount === 0;
  const needsClusters = meta.clustersCount === 0;
  const lastFetch = meta.lastWarehouseStocksFetchAt
    ? new Date(meta.lastWarehouseStocksFetchAt).toLocaleString('ru-RU')
    : null;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-[12px] text-muted-foreground">
      <AlertCircle className="h-6 w-6 opacity-50" />
      <div className="space-y-1">
        <div className="font-medium text-foreground">Нет данных для отображения</div>
        <div className="max-w-md">
          Для блока «Остатки по кластерам» нужно запустить два стейджа
          синхронизации:
        </div>
      </div>
      <ul className="space-y-1 text-left text-[11px]">
        <li className={needsStocks ? 'text-rose-700 dark:text-rose-300' : 'opacity-60 line-through'}>
          • «Остатки по складам» (Seller API <code>/v1/analytics/stock_on_warehouses</code>):
          {' '}
          <span className="tabular-nums">{meta.warehouseStocksCount} строк</span>
        </li>
        <li className={needsClusters ? 'text-amber-700 dark:text-amber-300' : 'opacity-60 line-through'}>
          • «Кластеры» (Performance API <code>/api/client/cluster/list</code>):
          {' '}
          <span className="tabular-nums">{meta.clustersCount} кластеров</span>
        </li>
      </ul>
      {lastFetch && (
        <div className="text-[10px] opacity-60">
          Последний fetch warehouse_stocks: {lastFetch}
        </div>
      )}
      <Link
        href="/settings/integrations"
        className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent"
      >
        Перейти в настройки синхронизации
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

function RenderOzonWarehouseClusters({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const {
    period,
    setOverride: setPeriodOverride,
    resetToGlobal: resetPeriodToGlobal,
    isOverride: isPeriodOverride,
  } = useBlockPeriod({
    instanceId: instance.id,
    configOverride:
      config.periodPreset !== '30d' || config.customFrom || config.customTo
        ? {
            preset: config.periodPreset,
            customFrom: config.customFrom,
            customTo: config.customTo,
          }
        : null,
    defaultMode: 'global',
  });
  const setPeriod = useCallback(
    (next: PeriodValue) =>
      setPeriodOverride({
        preset: next.preset,
        customFrom: next.customFrom ?? null,
        customTo: next.customTo ?? null,
      }),
    [setPeriodOverride],
  );
  const [data, setData] = useState<OzonClusterStocksResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ key: 'totalStock', dir: 'desc' });
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
      const res = await fetch(
        `/api/marketplaces/ozon/cluster-stocks-v2?${params}`,
      );
      const json = await res.json();
      if (!mountedRef.current) return;
      if (res.ok && json.ok) setData(json as OzonClusterStocksResponse);
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

  const rows = useMemo(() => sortRows(data?.rows ?? [], sort), [data, sort]);
  const totals = data?.totals ?? null;

  const cycleSort = (key: ClusterColumnKey) => {
    setSort((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return null;
    });
  };

  useBlockValuePublisher(instance.id, {
    value: totals?.totalStock ?? 0,
    totalStock: totals?.totalStock ?? 0,
    freeStock: totals?.freeStock ?? 0,
    reservedStock: totals?.reservedStock ?? 0,
    promisedStock: totals?.promisedStock ?? 0,
    skuCount: totals?.skuCount ?? 0,
    ordersInPeriod: totals?.ordersInPeriod ?? 0,
    revenueInPeriod: totals?.revenueInPeriod ?? 0,
    clustersCount: rows.length,
    label: instance.appearance?.title ?? 'Ozon · Остатки по кластерам',
    __money: 'revenueInPeriod',
    __labels:
      'value=Всего остатков (шт),totalStock=Всего остатков (шт),' +
      'freeStock=Свободно (шт),reservedStock=В резерве (шт),' +
      'promisedStock=Ожидается (шт),skuCount=SKU,' +
      'ordersInPeriod=Заказов / период,revenueInPeriod=Выручка / период,' +
      'clustersCount=Кластеров',
  });

  const visibleCols: ClusterColumnKey[] =
    config.visibleColumns.length > 0 ? config.visibleColumns : ['clusterName', 'totalStock'];

  // Когда стоки есть, но справочник кластеров пуст — все ряды идут в
  // «Без кластера». Показываем banner, чтобы пользователь понял почему.
  const showClustersBanner =
    !!data &&
    data.meta.warehouseStocksCount > 0 &&
    data.meta.clustersCount === 0;

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
        <PeriodPicker
          value={{ preset: period.preset as PeriodPreset, customFrom: period.customFrom, customTo: period.customTo }}
          onChange={setPeriod}
          compact
          collapsed
        />
        {isPeriodOverride && (
          <button
            type="button"
            onClick={resetPeriodToGlobal}
            className="inline-flex h-5 shrink-0 items-center gap-0.5 rounded bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900"
            title="Локальный период этого блока. Клик — вернуться к периоду страницы."
          >
            <Lock className="h-2.5 w-2.5" />
            свой
          </button>
        )}
        <button
          type="button"
          onClick={() => fetchData()}
          disabled={loading}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          title="Обновить данные"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {showClustersBanner && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>
            Справочник кластеров пуст (Performance API). Остатки сгруппированы
            «Без кластера» — запустите стейдж «Кластеры» для геогруппировки.
          </span>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-rose-700 dark:text-rose-300">
            <AlertCircle className="h-5 w-5" />
            {error}
          </div>
        ) : !data ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            {loading ? 'Загрузка…' : 'Нет данных'}
          </div>
        ) : rows.length === 0 ? (
          <ClusterEmptyState meta={data.meta} />
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-[1] bg-muted/40 text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr>
                {visibleCols.map((key) => {
                  const def = COLUMN_LABELS[key];
                  const isSorted = sort?.key === key;
                  const indicator = isSorted ? (sort.dir === 'asc' ? '↑' : '↓') : '';
                  return (
                    <th
                      key={key}
                      onClick={() => cycleSort(key)}
                      className={
                        'select-none cursor-pointer px-2 py-1.5 font-medium hover:bg-muted/70 ' +
                        (def.right ? 'text-right' : 'text-left')
                      }
                      title="Клик: сортировка (↓ → ↑ → сброс)"
                    >
                      {def.label}
                      {isSorted && <span className="ml-1 opacity-60">{indicator}</span>}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {rows.map((row) => (
                <tr key={(row.clusterId ?? row.clusterName) + ':row'} className="hover:bg-accent/20">
                  {visibleCols.map((key) => {
                    const def = COLUMN_LABELS[key];
                    if (key === 'clusterName') {
                      return (
                        <td key={key} className="px-2 py-1.5 font-medium">
                          <div>{row.clusterName}</div>
                          {row.clusterType && (
                            <div className="text-[10px] text-muted-foreground">
                              {row.clusterType}
                            </div>
                          )}
                        </td>
                      );
                    }
                    if (key === 'sharePct' && config.showShareBar) {
                      return (
                        <td key={key} className="px-2 py-1.5 text-right tabular-nums">
                          <div className="flex items-center justify-end gap-2">
                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                              <div
                                className="h-full rounded-full bg-primary/60"
                                style={{ width: `${Math.min(row.sharePct, 100)}%` }}
                              />
                            </div>
                            <span>{row.sharePct.toFixed(1)}%</span>
                          </div>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={key}
                        className={
                          'px-2 py-1.5 tabular-nums ' +
                          (def.right ? 'text-right' : 'text-left')
                        }
                      >
                        {formatCell(row, key)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {totals && (
                <tr className="bg-muted/30 font-medium">
                  {visibleCols.map((key) => {
                    const def = COLUMN_LABELS[key];
                    let content: string = '';
                    if (key === 'clusterName') content = 'Итого';
                    else if (key === 'totalStock') content = fmtNum(totals.totalStock);
                    else if (key === 'freeStock') content = fmtNum(totals.freeStock);
                    else if (key === 'reservedStock') content = fmtNum(totals.reservedStock);
                    else if (key === 'promisedStock') content = fmtNum(totals.promisedStock);
                    else if (key === 'skuCount') content = fmtNum(totals.skuCount);
                    else if (key === 'sharePct') content = '100%';
                    else if (key === 'ordersInPeriod') content = fmtNum(totals.ordersInPeriod);
                    else if (key === 'revenueInPeriod') content = fmtRub(totals.revenueInPeriod);
                    return (
                      <td
                        key={key}
                        className={
                          'px-2 py-1.5 tabular-nums ' +
                          (def.right ? 'text-right' : 'text-left')
                        }
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);

  const toggleColumn = (key: ClusterColumnKey) => {
    const isOn = parsed.visibleColumns.includes(key);
    const next = isOn
      ? parsed.visibleColumns.filter((k) => k !== key)
      : [...parsed.visibleColumns, key];
    onChange({ ...parsed, visibleColumns: next } as unknown as Record<string, unknown>);
  };

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
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">
          Колонки
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {CLUSTER_COLUMN_KEYS.map((key) => {
            const def = COLUMN_LABELS[key];
            const checked = parsed.visibleColumns.includes(key);
            return (
              <label
                key={key}
                className="inline-flex cursor-pointer items-center gap-2 text-[12px]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleColumn(key)}
                />
                {def.label}
              </label>
            );
          })}
        </div>
      </div>
      <div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            checked={parsed.showShareBar}
            onChange={(e) =>
              onChange({
                ...parsed,
                showShareBar: e.target.checked,
              } as unknown as Record<string, unknown>)
            }
          />
          Показывать прогресс-бар «Доля, %»
        </label>
      </div>
    </div>
  );
}

export const UnitOzonWarehouseClustersBlock: BlockDef = {
  type: 'unit.ozon-warehouse-clusters',
  displayName: 'Ozon · Остатки по кластерам',
  description:
    'Географические кластеры Ozon: остатки (свободно/резерв/ожидается), доля, заказы и выручка за период.',
  category: 'tables',
  icon: MapIcon,
  defaultSize: { w: 12, h: 6 },
  minSize: { w: 6, h: 4 },
  pages: ['marketplaces-ozon-dashboard', '*'],
  configSchema: OzonWarehouseClustersBlockConfigSchema,
  defaultConfig: () => OzonWarehouseClustersBlockConfigSchema.parse({}),
  SettingsForm,
  Render: RenderOzonWarehouseClusters,
};
