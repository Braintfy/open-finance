// PURPOSE: Блок «Ozon · Остатки по кластерам» — географические кластеры
// (источник Performance API `/api/client/cluster/list` + Seller
// `/v1/analytics/stock_on_warehouses`). Опционально показывает заказы/
// выручку за период по кластерам (через сопоставление
// `ozon_orders.raw->>'warehouseName'` → ozon_warehouse_stocks.cluster).

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import { Map as MapIcon, RefreshCw, AlertCircle, ExternalLink, Lock, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
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
import { useOzonSyncListener } from '@/lib/blocks/use-ozon-sync-listener';
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
  'dsiDays',
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
      'dsiDays',
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
  dsiDays: { label: 'Дни запаса', right: true },
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
    case 'dsiDays':
      return '—';
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
        href="/app/settings/integrations"
        className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent"
      >
        Перейти в настройки синхронизации
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

function ClusterKpiStrip({
  totals,
}: {
  totals: OzonClusterStocksResponse['totals'];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/40 bg-muted/20 px-3 py-2">
      <div className="flex flex-col">
        <span className="text-[10px] text-muted-foreground">Всего, шт</span>
        <span className="text-[13px] font-semibold tabular-nums leading-tight">{fmtNum(totals.totalStock)}</span>
      </div>
      <div className="h-6 w-px bg-border/40" />
      <div className="flex flex-col">
        <span className="text-[10px] text-muted-foreground">Свободно</span>
        <span className="text-[13px] font-semibold tabular-nums leading-tight text-emerald-600 dark:text-emerald-400">{fmtNum(totals.freeStock)}</span>
      </div>
      <div className="h-6 w-px bg-border/40" />
      <div className="flex flex-col">
        <span className="text-[10px] text-muted-foreground">Резерв</span>
        <span className="text-[13px] font-semibold tabular-nums leading-tight text-amber-600 dark:text-amber-400">{fmtNum(totals.reservedStock)}</span>
      </div>
      {totals.skuCount > 0 && (
        <>
          <div className="h-6 w-px bg-border/40" />
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground">SKU</span>
            <span className="text-[13px] font-semibold tabular-nums leading-tight">{fmtNum(totals.skuCount)}</span>
          </div>
        </>
      )}
      {totals.revenueInPeriod > 0 && (
        <>
          <div className="h-6 w-px bg-border/40" />
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground">Выручка / период</span>
            <span className="text-[13px] font-semibold tabular-nums leading-tight">{fmtRub(totals.revenueInPeriod)}</span>
          </div>
        </>
      )}
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
    ready: periodReady,
  } = useBlockPeriod({
    instanceId: instance.id,
    configOverride: {
      preset: config.periodPreset,
      customFrom: config.customFrom ?? null,
      customTo: config.customTo ?? null,
    },
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
    if (!periodReady) return;
    fetchData();
  }, [fetchData, periodReady]);

  useOzonSyncListener(fetchData);

  const rows = useMemo(() => sortRows(data?.rows ?? [], sort), [data, sort]);
  const totals = data?.totals ?? null;

  const periodDays = useMemo(() => {
    const range = resolvePeriod(period.preset, period.customFrom, period.customTo);
    return Math.max(1, Math.round((range.to.getTime() - range.from.getTime()) / (1000 * 60 * 60 * 24)));
  }, [period.preset, period.customFrom, period.customTo]);

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
        <div className="ml-auto flex items-center gap-1.5">
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
      {data?.totals && rows.length > 0 && <ClusterKpiStrip totals={data.totals} />}
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
            <thead className="sticky top-0 z-[1] bg-muted/60 backdrop-blur text-[10px] text-muted-foreground">
              <tr>
                {visibleCols.map((key) => {
                  const def = COLUMN_LABELS[key];
                  const isSorted = sort?.key === key;
                  const SortIcon = !isSorted ? ArrowUpDown : sort!.dir === 'asc' ? ArrowUp : ArrowDown;
                  return (
                    <th
                      key={key}
                      onClick={() => cycleSort(key)}
                      className={
                        'group select-none cursor-pointer px-2 py-1.5 font-medium hover:text-foreground ' +
                        (def.right ? 'text-right' : 'text-left')
                      }
                      title="Клик: сортировка (↓ → ↑ → сброс)"
                    >
                      <span className={'inline-flex items-center gap-1 ' + (def.right ? 'flex-row-reverse' : '')}>
                        <span>{def.label}</span>
                        <SortIcon className={'h-2.5 w-2.5 shrink-0 ' + (isSorted ? 'text-foreground' : 'text-muted-foreground/40 group-hover:text-muted-foreground')} />
                      </span>
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
                      const isNoCluster = !row.clusterId;
                      return (
                        <td key={key} className="px-2 py-1.5 font-medium">
                          <div
                            title={
                              isNoCluster
                                ? 'Включает заказы из складов, чьи названия не совпали ни с одним кластером в справочнике. Для корректной разбивки запустите стейдж «Кластеры».'
                                : undefined
                            }
                          >
                            {row.clusterName}
                            {isNoCluster && (
                              <span className="ml-1 text-[9px] text-muted-foreground/60">ⓘ</span>
                            )}
                          </div>
                          {row.clusterType && (
                            <div className="text-[10px] text-muted-foreground">
                              {row.clusterType}
                            </div>
                          )}
                        </td>
                      );
                    }
                    if (key === 'totalStock') {
                      const total = row.totalStock;
                      const freePct = total > 0 ? (row.freeStock / total) * 100 : 0;
                      const resPct = total > 0 ? (row.reservedStock / total) * 100 : 0;
                      const promPct = total > 0 ? (row.promisedStock / total) * 100 : 0;
                      return (
                        <td key={key} className="px-2 py-1.5 text-right tabular-nums">
                          <div className="flex flex-col items-end gap-0.5">
                            <span>{fmtNum(total)}</span>
                            {total > 0 && (
                              <div
                                className="flex h-[3px] w-full max-w-[56px] overflow-hidden rounded-full"
                                title={`Свободно: ${fmtNum(row.freeStock)} · Резерв: ${fmtNum(row.reservedStock)} · Ожидается: ${fmtNum(row.promisedStock)}`}
                              >
                                <div className="h-full bg-emerald-500" style={{ width: `${freePct}%` }} />
                                <div className="h-full bg-amber-400" style={{ width: `${resPct}%` }} />
                                <div className="h-full bg-sky-400" style={{ width: `${promPct}%` }} />
                              </div>
                            )}
                          </div>
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
                    if (key === 'dsiDays') {
                      const dsi = row.ordersInPeriod > 0
                        ? Math.round(row.totalStock / (row.ordersInPeriod / periodDays))
                        : null;
                      const dsiCls = dsi === null
                        ? 'text-muted-foreground'
                        : dsi < 7
                          ? 'text-red-600 dark:text-red-400 font-medium'
                          : dsi < 14
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400';
                      return (
                        <td
                          key={key}
                          className={'px-2 py-1.5 text-right tabular-nums ' + dsiCls}
                          title={dsi !== null ? `${dsi} дн. запаса при текущем темпе продаж` : 'Нет данных о продажах за период'}
                        >
                          {dsi !== null ? `${dsi} дн.` : '—'}
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
            </tbody>
            {totals && (
              <tfoot className="sticky bottom-0 border-t border-border/60 bg-muted/80 backdrop-blur text-[10px] font-medium text-muted-foreground">
                <tr>
                  {visibleCols.map((key) => {
                    const def = COLUMN_LABELS[key];
                    let content: React.ReactNode = '';
                    if (key === 'clusterName') content = <span className="font-semibold text-foreground text-[10px]">Итого</span>;
                    else if (key === 'totalStock') content = fmtNum(totals.totalStock);
                    else if (key === 'freeStock') content = fmtNum(totals.freeStock);
                    else if (key === 'reservedStock') content = fmtNum(totals.reservedStock);
                    else if (key === 'promisedStock') content = fmtNum(totals.promisedStock);
                    else if (key === 'skuCount') content = fmtNum(totals.skuCount);
                    else if (key === 'sharePct') content = '100%';
                    else if (key === 'ordersInPeriod') content = fmtNum(totals.ordersInPeriod);
                    else if (key === 'revenueInPeriod') content = fmtRub(totals.revenueInPeriod);
                    else if (key === 'dsiDays') content = '';
                    return (
                      <td
                        key={key}
                        className={'px-2 py-1.5 tabular-nums ' + (def.right ? 'text-right' : 'text-left')}
                      >
                        {content}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </Card>
  );
}

const COL_DESCRIPTIONS: Partial<Record<ClusterColumnKey, string>> = {
  dsiDays: 'Дней до исчерпания при текущем темпе',
  ordersInPeriod: 'За выбранный период',
  revenueInPeriod: 'За выбранный период',
  sharePct: 'Доля от общего остатка',
  promisedStock: 'Ожидается поступление',
};

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
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">Колонки</p>
        <div className="grid grid-cols-2 gap-0.5">
          {CLUSTER_COLUMN_KEYS.map((key) => {
            const def = COLUMN_LABELS[key];
            const desc = COL_DESCRIPTIONS[key];
            const checked = parsed.visibleColumns.includes(key);
            return (
              <label
                key={key}
                className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-[12px] hover:bg-accent/40"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleColumn(key)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded accent-primary"
                />
                <span className="flex flex-col leading-snug">
                  <span>{def.label}</span>
                  {desc && <span className="text-[10px] text-muted-foreground">{desc}</span>}
                </span>
              </label>
            );
          })}
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] hover:bg-accent/40">
        <input
          type="checkbox"
          checked={parsed.showShareBar}
          onChange={(e) =>
            onChange({
              ...parsed,
              showShareBar: e.target.checked,
            } as unknown as Record<string, unknown>)
          }
          className="h-3.5 w-3.5 shrink-0 rounded accent-primary"
        />
        <span>Показывать прогресс-бар «Доля, %»</span>
      </label>
      <p className="text-[10px] text-muted-foreground opacity-70">
        Период задаётся в шапке блока и синхронизирован с периодом страницы.
      </p>
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
