// PURPOSE: Блок «Ozon · Остатки по кластерам» — географические кластеры
// (источник Seller API `POST /v1/cluster/list` + Seller
// `POST /v2/analytics/stock_on_warehouses`). Опционально показывает заказы/
// выручку за период по кластерам (через сопоставление
// `ozon_orders.raw->'analytics_data'->>'warehouse_name'` → справочник
// ozon_clusters). Вся агрегация — на сервере, см. cluster-stocks-v2/route.ts.
//
// Этап 2a LK_V2_PLAN: два разреза — «Кластеры» и «Склады» (иерархия
// кластер→склады с раскрытием). Разрез хранится в config (`groupBy`), как и
// набор раскрытых кластеров (`expandedClusters`). Топ-N складов на кластер
// отбирает СЕРВЕР по той же метрике, по которой отсортирована таблица, —
// поэтому смена сортировки в режиме складов вызывает рефетч.
//
// Этап 2b LK_V2_PLAN: переключатель источника «Все | FBO | FBS» (config
// `source`, тоже персистится). FBS — собственные склады продавца; они не
// входят в кластеры Ozon и собираются в псевдо-строку «FBS (свои склады)».

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { z } from 'zod';
import {
  Map as MapIcon,
  RefreshCw,
  AlertCircle,
  ExternalLink,
  Lock,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronRight,
  ChevronDown,
  Warehouse,
} from 'lucide-react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { useBlockDensity } from '@/components/blocks/block-size';
import {
  PeriodPicker,
  resolvePeriod,
  type PeriodPreset,
  type PeriodValue,
} from '@/components/blocks/period-picker';
import { useReportBlockLoading } from '@/components/blocks/use-block-loading';
import { OzonAccountSelector } from '@/components/marketplaces/ozon-account-selector';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { useBlockPeriod } from '@/lib/blocks/use-block-period';
import { useOzonSyncListener } from '@/lib/blocks/use-ozon-sync-listener';
import type {
  BlockDef,
  BlockRenderProps,
  BlockSettingsFormProps,
} from '../types';
import {
  isWarehouseSortKey,
  DEFAULT_WAREHOUSE_LIMIT,
  MAX_WAREHOUSE_LIMIT,
  type WarehouseAggRow,
  type WarehouseSortKey,
} from '@/lib/marketplaces/ozon/cluster-agg';
import type {
  OzonClusterStocksResponse,
  OzonClusterStocksRow,
} from '@/app/api/marketplaces/ozon/cluster-stocks-v2/route';

const CLUSTER_COLUMN_KEYS = [
  'clusterName',
  'warehouseName',
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
  /** Разрез таблицы. Дефолт 'cluster' — поведение до Этапа 2a. */
  groupBy: z.enum(['cluster', 'warehouse']).default('cluster'),
  /**
   * Источник остатков (Этап 2b): фулфилмент Ozon, свои склады продавца или
   * оба сразу. Дефолт 'all' — поведение до появления FBS-стейджа.
   */
  source: z.enum(['all', 'FBO', 'FBS']).default('all'),
  /** rowKey кластеров, раскрытых в режиме складов. */
  expandedClusters: z.array(z.string()).default([]),
  /** Топ-N складов на кластер (у крупных продавцов складов сотни). */
  warehouseLimit: z
    .number()
    .int()
    .min(1)
    .max(MAX_WAREHOUSE_LIMIT)
    .default(DEFAULT_WAREHOUSE_LIMIT),
});
export type OzonWarehouseClustersBlockConfig = z.infer<
  typeof OzonWarehouseClustersBlockConfigSchema
>;
export type GroupBy = OzonWarehouseClustersBlockConfig['groupBy'];
export type SourceFilter = OzonWarehouseClustersBlockConfig['source'];

const SOURCE_OPTIONS: Array<{ key: SourceFilter; label: string; title: string }> = [
  { key: 'all', label: 'Все', title: 'Остатки Ozon (FBO) и склады продавца (FBS) вместе' },
  { key: 'FBO', label: 'FBO', title: 'Только фулфилмент Ozon' },
  { key: 'FBS', label: 'FBS', title: 'Только собственные склады продавца (FBS/rFBS)' },
];

function parseConfig(raw: unknown): OzonWarehouseClustersBlockConfig {
  return OzonWarehouseClustersBlockConfigSchema.parse(raw ?? {});
}

const COLUMN_LABELS: Record<ClusterColumnKey, { label: string; right?: boolean }> = {
  clusterName: { label: 'Кластер' },
  warehouseName: { label: 'Склад' },
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
  // У строк кластеров нет поля warehouseName — сортируем их по имени кластера
  // (иначе клик по «Склад» ничего бы не делал).
  const key = sort.key === 'warehouseName' ? 'clusterName' : sort.key;
  const out = [...rows];
  out.sort((a, b) => {
    const av = (a as unknown as Record<string, unknown>)[key];
    const bv = (b as unknown as Record<string, unknown>)[key];
    if (typeof av === 'number' && typeof bv === 'number') {
      return sort.dir === 'asc' ? av - bv : bv - av;
    }
    const as = String(av ?? '');
    const bs = String(bv ?? '');
    return sort.dir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
  });
  return out;
}

/**
 * Нормализованная строка для рендера ячеек: у кластера и у склада одинаковый
 * набор метрик, различаются только подписи. Без неё пришлось бы дублировать
 * `formatCell` под два типа строк.
 */
type CellRow = {
  clusterName: string;
  clusterType: string | null;
  warehouseName: string;
  freeStock: number;
  promisedStock: number;
  reservedStock: number;
  totalStock: number;
  skuCount: number;
  ordersInPeriod: number;
  revenueInPeriod: number;
  sharePct: number;
};

function pluralWarehouses(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} склад`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} склада`;
  return `${n} складов`;
}

function clusterToCell(row: OzonClusterStocksRow, groupBy: GroupBy): CellRow {
  return {
    clusterName: row.clusterName,
    clusterType: row.clusterType,
    warehouseName:
      groupBy === 'warehouse' && (row.warehousesTotal ?? 0) > 0
        ? pluralWarehouses(row.warehousesTotal ?? 0)
        : '',
    freeStock: row.freeStock,
    promisedStock: row.promisedStock,
    reservedStock: row.reservedStock,
    totalStock: row.totalStock,
    skuCount: row.skuCount,
    ordersInPeriod: row.ordersInPeriod,
    revenueInPeriod: row.revenueInPeriod,
    sharePct: row.sharePct,
  };
}

/** Плоский список строк таблицы: кластер + (если раскрыт) его склады. */
type DisplayRow =
  | {
      kind: 'cluster';
      key: string;
      cell: CellRow;
      row: OzonClusterStocksRow;
      expandable: boolean;
      isExpanded: boolean;
    }
  | { kind: 'warehouse'; key: string; cell: CellRow }
  | { kind: 'rest'; key: string; cell: CellRow };

function warehouseToCell(wh: WarehouseAggRow): CellRow {
  return {
    clusterName: '',
    clusterType: null,
    warehouseName: wh.warehouseName,
    freeStock: wh.freeStock,
    promisedStock: wh.promisedStock,
    reservedStock: wh.reservedStock,
    totalStock: wh.totalStock,
    skuCount: wh.skuCount,
    ordersInPeriod: wh.ordersInPeriod,
    revenueInPeriod: wh.revenueInPeriod,
    sharePct: wh.sharePct,
  };
}

function fmtNum(v: number): string {
  return v.toLocaleString('ru-RU');
}

function fmtRub(v: number): string {
  return Math.round(v).toLocaleString('ru-RU') + ' ₽';
}

function formatCell(row: CellRow, key: ClusterColumnKey): string {
  switch (key) {
    case 'clusterName':
      return row.clusterName;
    case 'warehouseName':
      return row.warehouseName;
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
  // В разрезе «Только FBS» справочник кластеров не нужен вовсе — свои склады
  // в кластеры Ozon не входят; нужен стейдж FBS-остатков.
  const fbsOnly = meta.source === 'FBS';
  const needsFbsStage = (meta.bySource?.fbs ?? 0) === 0;
  const lastFetch = meta.lastWarehouseStocksFetchAt
    ? new Date(meta.lastWarehouseStocksFetchAt).toLocaleString('ru-RU')
    : null;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-[12px] text-muted-foreground">
      <AlertCircle className="h-6 w-6 opacity-50" />
      <div className="space-y-1">
        <div className="font-medium text-foreground">Нет данных для отображения</div>
        <div className="max-w-md">
          {fbsOnly
            ? 'Для среза FBS нужно запустить стейдж синхронизации:'
            : 'Для блока «Остатки по кластерам» нужно запустить два стейджа синхронизации:'}
        </div>
      </div>
      <ul className="space-y-1 text-left text-[11px]">
        {fbsOnly ? (
          <li className={needsFbsStage ? 'text-rose-700 dark:text-rose-300' : 'opacity-60 line-through'}>
            • «Остатки по своим складам (FBS)» (Seller API{' '}
            <code>/v1/product/info/stocks-by-warehouse/fbs</code>):
            {' '}
            <span className="tabular-nums">{meta.bySource?.fbs ?? 0} строк</span>
          </li>
        ) : (
          <>
            <li className={needsStocks ? 'text-rose-700 dark:text-rose-300' : 'opacity-60 line-through'}>
              • «Остатки по складам» (Seller API <code>/v2/analytics/stock_on_warehouses</code>):
              {' '}
              <span className="tabular-nums">{meta.warehouseStocksCount} строк</span>
            </li>
            <li className={needsClusters ? 'text-amber-700 dark:text-amber-300' : 'opacity-60 line-through'}>
              • «Кластеры» (Seller API <code>/v1/cluster/list</code>):
              {' '}
              <span className="tabular-nums">{meta.clustersCount} кластеров</span>
            </li>
          </>
        )}
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

/** Сегментированный переключатель разреза «Кластеры | Склады». */
function GroupByToggle({
  value,
  onChange,
  compact,
}: {
  value: GroupBy;
  onChange: (next: GroupBy) => void;
  compact: boolean;
}) {
  const items: Array<{ key: GroupBy; label: string; Icon: typeof MapIcon; title: string }> = [
    { key: 'cluster', label: 'Кластеры', Icon: MapIcon, title: 'Разрез по географическим кластерам' },
    {
      key: 'warehouse',
      label: 'Склады',
      Icon: Warehouse,
      title: 'Разрез по складам внутри кластеров',
    },
  ];
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border/60">
      {items.map(({ key, label, Icon, title }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            title={title}
            aria-pressed={active}
            className={
              'inline-flex items-center gap-1 px-2 py-1 text-[11px] transition ' +
              (active
                ? 'bg-primary/10 font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground')
            }
          >
            <Icon className="h-3 w-3 shrink-0" />
            {!compact && <span>{label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Переключатель источника «Все | FBO | FBS».
 *
 * Отдельный сегмент рядом с разрезом, а не пункт в настройках: пользователь
 * переключает его так же часто, как период, — сравнивать «свои склады против
 * фулфилмента» это основной сценарий блока после Этапа 2b.
 */
function SourceToggle({
  value,
  onChange,
  fbsRows,
}: {
  value: SourceFilter;
  onChange: (next: SourceFilter) => void;
  /** Сколько FBS-строк вообще есть у аккаунта (для подсказки «не синкали»). */
  fbsRows: number;
}) {
  return (
    <div className="inline-flex shrink-0 overflow-hidden rounded-md border border-border/60">
      {SOURCE_OPTIONS.map(({ key, label, title }) => {
        const active = value === key;
        const noFbsData = key === 'FBS' && fbsRows === 0;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            title={
              noFbsData
                ? 'Остатков FBS нет. Запустите стейдж «Остатки по своим складам (FBS)» в настройках синхронизации.'
                : title
            }
            aria-pressed={active}
            className={
              'px-2 py-1 text-[11px] transition ' +
              (active
                ? 'bg-primary/10 font-medium text-foreground'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground') +
              (noFbsData && !active ? ' opacity-50' : '')
            }
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function ClusterKpiStrip({
  totals,
  warehouses,
}: {
  totals: OzonClusterStocksResponse['totals'];
  /** Не-null только в разрезе «Склады». */
  warehouses: OzonClusterStocksResponse['meta']['warehouses'];
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
      {warehouses && (
        <>
          <div className="h-6 w-px bg-border/40" />
          <div className="flex flex-col">
            <span className="text-[10px] text-muted-foreground">Складов</span>
            <span
              className="text-[13px] font-semibold tabular-nums leading-tight"
              title={`С остатком: ${warehouses.withStock} · С заказами за период: ${warehouses.withOrders}`}
            >
              {fmtNum(warehouses.total)}
              {warehouses.soldOutWithOrders > 0 && (
                <span
                  className="ml-1 text-[10px] font-normal text-amber-600 dark:text-amber-400"
                  title="Склады с продажами за период, но с нулевым остатком (выбиты в ноль)"
                >
                  · {warehouses.soldOutWithOrders} в нуле
                </span>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function RenderOzonWarehouseClusters({ instance, onConfigChange }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const density = useBlockDensity();
  // Компактная шапка на узких блоках: переключатель без подписей.
  const compact = density === 'xs' || density === 'sm';
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
  useReportBlockLoading(loading);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>({ key: 'totalStock', dir: 'desc' });
  const mountedRef = useRef(true);

  // Разрез и раскрытые кластеры живут в config (переживают перезагрузку) и
  // при наличии onConfigChange являются ЕДИНСТВЕННЫМ источником правды — иначе
  // локальная тень навсегда замаскировала бы внешние правки конфига (форма
  // настроек, AI-tool update_block_config). Тень включается только в превью
  // (onConfigChange нет) — там переключатель работает, но не персистится.
  const canPersist = Boolean(onConfigChange);
  const [uiGroupBy, setUiGroupBy] = useState<GroupBy | null>(null);
  const [uiSource, setUiSource] = useState<SourceFilter | null>(null);
  const [uiExpanded, setUiExpanded] = useState<string[] | null>(null);
  const groupBy: GroupBy = canPersist ? config.groupBy : (uiGroupBy ?? config.groupBy);
  const source: SourceFilter = canPersist ? config.source : (uiSource ?? config.source);
  const expanded = useMemo(
    () => new Set(canPersist ? config.expandedClusters : (uiExpanded ?? config.expandedClusters)),
    [canPersist, uiExpanded, config.expandedClusters],
  );

  const patchConfig = useCallback(
    (patch: Partial<OzonWarehouseClustersBlockConfig>) => {
      onConfigChange?.({ ...config, ...patch } as unknown as Record<string, unknown>);
    },
    [config, onConfigChange],
  );

  const setGroupBy = useCallback(
    (next: GroupBy) => {
      if (canPersist) patchConfig({ groupBy: next });
      else setUiGroupBy(next);
    },
    [canPersist, patchConfig],
  );

  const setSource = useCallback(
    (next: SourceFilter) => {
      if (canPersist) patchConfig({ source: next });
      else setUiSource(next);
    },
    [canPersist, patchConfig],
  );

  const toggleExpanded = useCallback(
    (rowKey: string) => {
      const next = expanded.has(rowKey)
        ? Array.from(expanded).filter((k) => k !== rowKey)
        : [...Array.from(expanded), rowKey];
      if (canPersist) patchConfig({ expandedClusters: next });
      else setUiExpanded(next);
    },
    [canPersist, expanded, patchConfig],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Топ-N складов отбирает сервер, поэтому метрику сортировки надо ему
  // передать: иначе склад, выбитый в ноль, но с большой выручкой, обрезался бы
  // лимитом «топ-20 по остатку» именно тогда, когда его и ищут.
  // `sharePct` пропорциональна остатку → маппим на totalStock.
  const serverSort: { key: WarehouseSortKey; dir: 'asc' | 'desc' } | null = useMemo(() => {
    if (groupBy !== 'warehouse' || !sort) return null;
    const key = sort.key === 'sharePct' ? 'totalStock' : sort.key;
    return isWarehouseSortKey(key) ? { key, dir: sort.dir } : null;
  }, [groupBy, sort]);

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
        groupBy,
        source,
      });
      if (groupBy === 'warehouse') {
        params.set('warehouseLimit', String(config.warehouseLimit));
        if (serverSort) {
          params.set('warehouseSort', serverSort.key);
          params.set('warehouseSortDir', serverSort.dir);
        }
      }
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
  }, [
    config.accountId,
    config.warehouseLimit,
    period.preset,
    period.customFrom,
    period.customTo,
    groupBy,
    source,
    serverSort,
  ]);

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
    warehousesCount: data?.meta.warehouses?.total ?? 0,
    label: instance.appearance?.title ?? 'Ozon · Остатки по кластерам',
    __money: 'revenueInPeriod',
    __labels:
      'value=Всего остатков (шт),totalStock=Всего остатков (шт),' +
      'freeStock=Свободно (шт),reservedStock=В резерве (шт),' +
      'promisedStock=Ожидается (шт),skuCount=SKU,' +
      'ordersInPeriod=Заказов / период,revenueInPeriod=Выручка / период,' +
      'clustersCount=Кластеров,warehousesCount=Складов',
  });

  // Колонка «Склад» имеет смысл только в разрезе складов: в режиме кластеров
  // её убираем, в режиме складов — принудительно добавляем (иначе строки
  // складов остались бы безымянными, если галка снята в настройках блока).
  const visibleCols: ClusterColumnKey[] = useMemo(() => {
    const base: ClusterColumnKey[] =
      config.visibleColumns.length > 0
        ? config.visibleColumns
        : ['clusterName', 'totalStock'];
    if (groupBy === 'cluster') return base.filter((k) => k !== 'warehouseName');
    if (base.includes('warehouseName')) return base;
    const idx = base.indexOf('clusterName');
    const out = [...base];
    out.splice(idx >= 0 ? idx + 1 : 0, 0, 'warehouseName');
    return out;
  }, [config.visibleColumns, groupBy]);

  const expandableKeys = useMemo(
    () => rows.filter((r) => (r.warehousesTotal ?? 0) > 0).map((r) => r.rowKey),
    [rows],
  );
  const allExpanded =
    expandableKeys.length > 0 && expandableKeys.every((k) => expanded.has(k));

  const displayRows = useMemo<DisplayRow[]>(() => {
    const out: DisplayRow[] = [];
    for (const row of rows) {
      const expandable = groupBy === 'warehouse' && (row.warehousesTotal ?? 0) > 0;
      const isExpanded = expandable && expanded.has(row.rowKey);
      out.push({
        kind: 'cluster',
        key: row.rowKey,
        row,
        cell: clusterToCell(row, groupBy),
        expandable,
        isExpanded,
      });
      if (!isExpanded) continue;
      for (const wh of row.warehouses ?? []) {
        out.push({
          kind: 'warehouse',
          key: `${row.rowKey}:${wh.warehouseName}`,
          cell: warehouseToCell(wh),
        });
      }
      const hidden = row.hiddenWarehouses;
      if (hidden) {
        out.push({
          kind: 'rest',
          key: `${row.rowKey}:__rest__`,
          cell: {
            ...warehouseToCell({ ...hidden, warehouseName: '' }),
            warehouseName: `ещё ${pluralWarehouses(hidden.count)}`,
          },
        });
      }
    }
    return out;
  }, [rows, groupBy, expanded]);

  // Когда стоки есть, но справочник кластеров пуст — все ряды идут в
  // «Без кластера». Показываем banner, чтобы пользователь понял почему.
  const showClustersBanner =
    !!data &&
    // В разрезе «Только FBS» справочник кластеров ни на что не влияет.
    data.meta.source !== 'FBS' &&
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
          <SourceToggle
            value={source}
            onChange={setSource}
            fbsRows={data?.meta.bySource?.fbs ?? 0}
          />
          <GroupByToggle value={groupBy} onChange={setGroupBy} compact={compact} />
          {groupBy === 'warehouse' && rows.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const next = allExpanded ? [] : expandableKeys;
                if (canPersist) patchConfig({ expandedClusters: next });
                else setUiExpanded(next);
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
              title={allExpanded ? 'Свернуть все кластеры' : 'Развернуть все кластеры'}
            >
              {allExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {!compact && <span>{allExpanded ? 'Свернуть' : 'Развернуть'}</span>}
            </button>
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
      {data?.totals && rows.length > 0 && (
        <ClusterKpiStrip totals={data.totals} warehouses={data.meta.warehouses} />
      )}
      {showClustersBanner && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertCircle className="h-3 w-3 shrink-0" />
          <span>
            Справочник кластеров пуст (Seller API <code>/v1/cluster/list</code>).
            Остатки сгруппированы «Без кластера» — запустите стейдж «Кластеры»
            для геогруппировки.
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
              {displayRows.map((d) => {
                const cell = d.cell;
                const isChild = d.kind !== 'cluster';
                return (
                  <tr
                    key={d.key}
                    className={
                      isChild
                        ? 'bg-muted/15 text-[11px] text-muted-foreground hover:bg-accent/20'
                        : 'hover:bg-accent/20'
                    }
                  >
                    {visibleCols.map((key) => {
                      const def = COLUMN_LABELS[key];
                      if (key === 'clusterName') {
                        if (isChild) {
                          // Имя склада живёт в колонке «Склад» — здесь только отступ.
                          return <td key={key} className="px-2 py-1" />;
                        }
                        const row = d.row;
                        const isNoCluster = !row.clusterId;
                        return (
                          <td key={key} className="px-2 py-1.5 font-medium">
                            <div className="flex items-start gap-1">
                              {d.expandable && (
                                <button
                                  type="button"
                                  onClick={() => toggleExpanded(row.rowKey)}
                                  className="mt-[1px] shrink-0 rounded text-muted-foreground hover:text-foreground"
                                  title={
                                    d.isExpanded
                                      ? 'Свернуть склады кластера'
                                      : `Показать склады (${row.warehousesTotal ?? 0})`
                                  }
                                  aria-expanded={d.isExpanded}
                                >
                                  {d.isExpanded ? (
                                    <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3" />
                                  )}
                                </button>
                              )}
                              <span className="flex flex-col">
                                <span
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
                                </span>
                                {row.clusterType && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {row.clusterType}
                                  </span>
                                )}
                              </span>
                            </div>
                          </td>
                        );
                      }
                      if (key === 'warehouseName') {
                        return (
                          <td
                            key={key}
                            className={
                              isChild
                                ? 'px-2 py-1 pl-5 ' +
                                  (d.kind === 'rest' ? 'italic opacity-70' : '')
                                : 'px-2 py-1.5 text-[10px] text-muted-foreground'
                            }
                            title={d.kind === 'warehouse' ? cell.warehouseName : undefined}
                          >
                            {cell.warehouseName}
                          </td>
                        );
                      }
                      if (key === 'totalStock') {
                        const total = cell.totalStock;
                        const freePct = total > 0 ? (cell.freeStock / total) * 100 : 0;
                        const resPct = total > 0 ? (cell.reservedStock / total) * 100 : 0;
                        const promPct = total > 0 ? (cell.promisedStock / total) * 100 : 0;
                        return (
                          <td key={key} className="px-2 py-1.5 text-right tabular-nums">
                            <div className="flex flex-col items-end gap-0.5">
                              <span>{fmtNum(total)}</span>
                              {total > 0 && (
                                <div
                                  className="flex h-[3px] w-full max-w-[56px] overflow-hidden rounded-full"
                                  title={`Свободно: ${fmtNum(cell.freeStock)} · Резерв: ${fmtNum(cell.reservedStock)} · Ожидается: ${fmtNum(cell.promisedStock)}`}
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
                                  style={{ width: `${Math.min(cell.sharePct, 100)}%` }}
                                />
                              </div>
                              <span>{cell.sharePct.toFixed(1)}%</span>
                            </div>
                          </td>
                        );
                      }
                      if (key === 'dsiDays') {
                        const dsi =
                          cell.ordersInPeriod > 0
                            ? Math.round(cell.totalStock / (cell.ordersInPeriod / periodDays))
                            : null;
                        const dsiCls =
                          dsi === null
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
                          {formatCell(cell, key)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
            {totals && (
              <tfoot className="sticky bottom-0 border-t border-border/60 bg-muted/80 backdrop-blur text-[10px] font-medium text-muted-foreground">
                <tr>
                  {visibleCols.map((key) => {
                    const def = COLUMN_LABELS[key];
                    let content: React.ReactNode = '';
                    if (key === 'clusterName') content = <span className="font-semibold text-foreground text-[10px]">Итого</span>;
                    else if (key === 'warehouseName')
                      content = data?.meta.warehouses
                        ? pluralWarehouses(data.meta.warehouses.total)
                        : '';
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
  warehouseName: 'Только в разрезе «Склады» (там всегда включена)',
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
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">
          Разрез по умолчанию
        </p>
        <div className="flex gap-1">
          {(['cluster', 'warehouse'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() =>
                onChange({ ...parsed, groupBy: key } as unknown as Record<string, unknown>)
              }
              className={
                'rounded-md border px-2 py-1 text-[12px] transition ' +
                (parsed.groupBy === key
                  ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                  : 'border-border/60 text-muted-foreground hover:bg-accent')
              }
            >
              {key === 'cluster' ? 'Кластеры' : 'Склады'}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground opacity-70">
          Переключается и прямо в шапке блока — выбор сохраняется здесь же.
        </p>
      </div>
      <div className="space-y-1.5">
        <p className="text-[11px] font-medium text-muted-foreground">
          Источник остатков
        </p>
        <div className="flex gap-1">
          {SOURCE_OPTIONS.map(({ key, label, title }) => (
            <button
              key={key}
              type="button"
              title={title}
              onClick={() =>
                onChange({ ...parsed, source: key } as unknown as Record<string, unknown>)
              }
              className={
                'rounded-md border px-2 py-1 text-[12px] transition ' +
                (parsed.source === key
                  ? 'border-primary/40 bg-primary/10 font-medium text-foreground'
                  : 'border-border/60 text-muted-foreground hover:bg-accent')
              }
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground opacity-70">
          FBS — собственные склады продавца (стейдж «Остатки по своим складам»).
          Фильтр применяется и к остаткам, и к заказам периода.
        </p>
      </div>
      <label className="flex flex-col gap-1 text-[12px]">
        <span className="text-[11px] font-medium text-muted-foreground">
          Складов на кластер (топ-N)
        </span>
        <select
          value={parsed.warehouseLimit}
          onChange={(e) =>
            onChange({
              ...parsed,
              warehouseLimit: Number(e.target.value),
            } as unknown as Record<string, unknown>)
          }
          className="w-32 rounded-md border border-border/60 bg-background px-2 py-1 text-[12px]"
        >
          {[10, 20, 50, 100, MAX_WAREHOUSE_LIMIT].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-muted-foreground opacity-70">
          Отбор — на сервере по текущей сортировке таблицы. Остальные склады
          сворачиваются в строку «ещё N складов».
        </span>
      </label>
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
    'Географические кластеры Ozon с разрезом по складам и фильтром FBO/FBS: остатки (свободно/резерв/ожидается), доля, заказы и выручка за период.',
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
