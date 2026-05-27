// PURPOSE: Блок «Ozon · Кампании» — таблица кампаний с расходом, заказами,
// выручкой, ДРР, CTR, CPC. Drag-to-resize колонки, цветной ДРР-бар.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import {
  Megaphone,
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Info,
  Lock,
  RefreshCw,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  PeriodPicker,
  resolvePeriod,
  type PeriodPreset,
  type PeriodValue,
} from '@/components/blocks/period-picker';
import { OzonAccountSelector } from '@/components/marketplaces/ozon-account-selector';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';
import { useBlockValuePublisher, formatPeriodKey } from '@/lib/blocks/values';
import { useBlockPeriod } from '@/lib/blocks/use-block-period';
import { useOzonSyncListener } from '@/lib/blocks/use-ozon-sync-listener';
import { autoColumnWidth } from '@/lib/blocks/auto-column-width';
import type {
  BlockDef,
  BlockRenderProps,
  BlockSettingsFormProps,
} from '../types';
import type { OzonCampaignsResponse } from '@/app/api/marketplaces/ozon/campaigns/route';

const ALL_CAMPAIGN_COLS = [
  'campaign', 'type', 'state', 'budget', 'expense', 'revenue',
  'orders', 'views', 'clicks', 'ctr', 'cpc', 'drr',
] as const;
export type CampaignColKey = (typeof ALL_CAMPAIGN_COLS)[number];

const DEFAULT_VISIBLE_COLS: CampaignColKey[] = [
  'campaign', 'type', 'state', 'budget', 'expense', 'revenue', 'orders', 'drr',
];

export const OzonCampaignsBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
  periodPreset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('30d'),
  customFrom: z.string().nullable().default(null),
  customTo: z.string().nullable().default(null),
  /** Скрыть кампании в статусе PAUSED/FINISHED — оставить только RUNNING. */
  onlyActive: z.boolean().default(false),
  visibleCols: z.array(z.enum(ALL_CAMPAIGN_COLS)).default(DEFAULT_VISIBLE_COLS),
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

/** Ordinal для сортировки по статусу — Активные сверху по умолчанию. */
function stateOrdinal(state: string | null): number {
  if (!state) return 99;
  if (state.includes('RUNNING')) return 0;
  if (state.includes('PAUSED')) return 1;
  if (state.includes('FINISHED')) return 2;
  return 3;
}

type SortKey =
  | 'campaign'
  | 'type'
  | 'state'
  | 'budget'
  | 'expense'
  | 'revenue'
  | 'orders'
  | 'views'
  | 'clicks'
  | 'ctr'
  | 'cpc'
  | 'drr';

/** Humanize Ozon Performance payment/adv type codes. */
function humanizeType(paymentType: string | null, advObjectType: string | null): string {
  const pay: Record<string, string> = {
    CPC: 'Клики (CPC)',
    CPO: 'Заказы (CPO)',
    CPM: 'Показы (CPM)',
  };
  const adv: Record<string, string> = {
    SKU: 'По SKU',
    ALL_SKU_PROMO: 'Все SKU',
    VIDEO_BANNER: 'Видеобаннер',
    BANNER: 'Баннер',
    BOOSTING: 'Буст',
  };
  const p = paymentType ? (pay[paymentType] ?? paymentType) : null;
  const a = advObjectType ? (adv[advObjectType] ?? advObjectType) : null;
  if (p && a) return `${p} · ${a}`;
  return p ?? a ?? '—';
}

/** Color class for ДРР value */
function drrColorCls(drrPct: number | null): string {
  if (drrPct === null) return 'text-muted-foreground';
  if (drrPct <= 15) return 'text-emerald-600 dark:text-emerald-400';
  if (drrPct <= 25) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}
type SortDir = 'asc' | 'desc';

function RenderOzonCampaigns({ instance }: BlockRenderProps) {
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
  const [data, setData] = useState<OzonCampaignsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({
    key: 'expense',
    dir: 'desc',
  });
  const mountedRef = useRef(true);
  const { accounts } = useMarketplaceAccounts({ marketplace: 'ozon' });
  const currentAccount = useMemo(
    () => accounts.find((a) => a.id === config.accountId) ?? null,
    [accounts, config.accountId],
  );

  const [colWidths, setColWidths] = useState<Partial<Record<CampaignColKey, number>>>({});
  const resizingRef = useRef<{ key: CampaignColKey; startX: number; startW: number } | null>(null);

  const startResize = useCallback((key: CampaignColKey, e: React.MouseEvent) => {
    e.preventDefault();
    const startW = colWidths[key] ?? 120;
    resizingRef.current = { key, startX: e.clientX, startW };
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - resizingRef.current.startX;
      const newW = Math.max(50, resizingRef.current.startW + delta);
      setColWidths((prev) => ({ ...prev, [resizingRef.current!.key]: newW }));
    };
    const onUp = () => {
      resizingRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [colWidths]);

  const toggleSort = useCallback((key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: key === 'campaign' || key === 'type' ? 'asc' : 'desc' },
    );
  }, []);

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
    if (!periodReady) return;
    fetchData();
  }, [fetchData, periodReady]);

  useOzonSyncListener(fetchData);

  // Публикуем summary (общий расход/заказы/ДРР) для привязок и AI.
  const summary = data?.summary ?? {
    expenseRub: 0,
    orders: 0,
    ordersRub: 0,
    drrPct: null as number | null,
    statsAreAccountWide: false,
  };
  useBlockValuePublisher(instance.id, {
    // Money fields published in KOPECKS (× 100) — global convention.
    value: summary.expenseRub * 100,
    totalExpenseRub: summary.expenseRub * 100,
    totalOrders: summary.orders,
    totalOrdersRub: summary.ordersRub * 100,
    avgDrrPct: summary.drrPct,
    campaignsCount: data?.rows.length ?? 0,
    activeCampaignsCount: (data?.rows ?? []).filter((r) => r.state?.includes('RUNNING')).length,
    label: instance.appearance?.title ?? 'Ozon · Кампании',
    __labels:
      'value=Расход на рекламу,totalExpenseRub=Расход на рекламу,' +
      'totalOrders=Заказы с рекламы,totalOrdersRub=Выручка с рекламы,' +
      'avgDrrPct=Средний ДРР (%),campaignsCount=Всего кампаний,' +
      'activeCampaignsCount=Активных кампаний',
    __money: 'value,totalExpenseRub,totalOrdersRub',
    __periodKey: formatPeriodKey(period),
  });

  // Фильтр «только активные» + сортировка по выбранной колонке.
  const rows = data?.rows ?? [];
  const displayRows = useMemo(() => {
    const filtered = config.onlyActive
      ? rows.filter((r) => r.state?.includes('RUNNING'))
      : rows.slice();
    const dir = sort.dir === 'asc' ? 1 : -1;
    const cmp = (a: typeof rows[number], b: typeof rows[number]): number => {
      switch (sort.key) {
        case 'campaign': {
          const av = (a.title ?? a.campaignId).toLowerCase();
          const bv = (b.title ?? b.campaignId).toLowerCase();
          return av.localeCompare(bv, 'ru') * dir;
        }
        case 'type': {
          const av = humanizeType(a.paymentType, a.advObjectType);
          const bv = humanizeType(b.paymentType, b.advObjectType);
          return av.localeCompare(bv, 'ru') * dir;
        }
        case 'state':
          return (stateOrdinal(a.state) - stateOrdinal(b.state)) * dir;
        case 'budget':
          return ((a.dailyBudgetRub ?? -1) - (b.dailyBudgetRub ?? -1)) * dir;
        case 'expense':
          return (a.expenseRub - b.expenseRub) * dir;
        case 'revenue':
          return (a.ordersRub - b.ordersRub) * dir;
        case 'orders':
          return (a.orders - b.orders) * dir;
        case 'views':
          return (a.views - b.views) * dir;
        case 'clicks':
          return (a.clicks - b.clicks) * dir;
        case 'ctr':
          return ((a.ctrPct ?? -1) - (b.ctrPct ?? -1)) * dir;
        case 'cpc':
          return ((a.cpcRub ?? -1) - (b.cpcRub ?? -1)) * dir;
        case 'drr':
          return ((a.drrPct ?? -1) - (b.drrPct ?? -1)) * dir;
        default:
          return 0;
      }
    };
    filtered.sort(cmp);
    return filtered;
  }, [rows, config.onlyActive, sort]);

  // Default auto widths (used when user hasn't resized)
  const autoWidths = useMemo(
    () => ({
      campaign: autoColumnWidth('Кампания', displayRows.map((r) => r.title ?? r.campaignId), { min: 160, max: 320 }),
      type: autoColumnWidth('Тип', displayRows.map((r) => humanizeType(r.paymentType, r.advObjectType)), { min: 100, max: 200 }),
      state: autoColumnWidth('Статус', displayRows.map((r) => stateBadge(r.state).label), { min: 72, max: 120 }),
      budget: autoColumnWidth('Бюджет/д', displayRows.map((r) => r.dailyBudgetRub ? Math.round(r.dailyBudgetRub).toLocaleString('ru-RU') + ' ₽' : '—'), { min: 90, max: 140 }),
      expense: autoColumnWidth('Расход', displayRows.map((r) => Math.round(r.expenseRub).toLocaleString('ru-RU') + ' ₽'), { min: 80, max: 140 }),
      revenue: autoColumnWidth('Выручка р.', displayRows.map((r) => Math.round(r.ordersRub).toLocaleString('ru-RU') + ' ₽'), { min: 90, max: 150 }),
      orders: autoColumnWidth('Заказы', displayRows.map((r) => String(r.orders)), { min: 60, max: 90 }),
      views: autoColumnWidth('Показы', displayRows.map((r) => r.views.toLocaleString('ru-RU')), { min: 70, max: 110 }),
      clicks: autoColumnWidth('Клики', displayRows.map((r) => r.clicks.toLocaleString('ru-RU')), { min: 60, max: 90 }),
      ctr: 70,
      cpc: autoColumnWidth('CPC', displayRows.map((r) => r.cpcRub ? r.cpcRub.toFixed(1) + ' ₽' : '—'), { min: 60, max: 100 }),
      drr: 80,
    }),
    [displayRows],
  );

  const visibleCols = (config.visibleCols ?? DEFAULT_VISIBLE_COLS) as CampaignColKey[];

  const getWidth = (key: CampaignColKey) =>
    colWidths[key] ?? (autoWidths[key as keyof typeof autoWidths] as number);

  // Summary totals
  const totals = useMemo(() => {
    const r = displayRows;
    const totalExpense = r.reduce((a, b) => a + b.expenseRub, 0);
    const totalRevenue = r.reduce((a, b) => a + b.ordersRub, 0);
    const totalOrders = r.reduce((a, b) => a + b.orders, 0);
    const totalViews = r.reduce((a, b) => a + b.views, 0);
    const totalClicks = r.reduce((a, b) => a + b.clicks, 0);
    const avgDrr = totalRevenue > 0 ? (totalExpense / totalRevenue) * 100 : null;
    const avgCtr = totalViews > 0 ? (totalClicks / totalViews) * 100 : null;
    return { totalExpense, totalRevenue, totalOrders, totalViews, totalClicks, avgDrr, avgCtr };
  }, [displayRows]);

  // Структурированный empty state.
  const emptyKind: 'no-account' | 'no-perf' | 'perf-error' | 'error' | 'no-campaigns' | null =
    !config.accountId
      ? 'no-account'
      : !currentAccount
        ? 'no-account'
        : !currentAccount.perfConnected
          ? 'no-perf'
          : error
            ? 'error'
            : data && displayRows.length > 0
              ? null
              : currentAccount.perfStatus === 'error'
                ? 'perf-error'
                : data && displayRows.length === 0
                  ? 'no-campaigns'
                  : null;

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
        {data?.summary?.statsAreAccountWide && (
          <span
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
            title="Ozon Performance API не разбил отчёт по кампаниям — расход показан суммарно по аккаунту."
          >
            <Info className="h-3 w-3" /> Расход — суммарный по аккаунту
          </span>
        )}
        <div className="block-toolbar-shift ml-auto flex items-center gap-1.5">
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
      <div className="min-h-0 flex-1 overflow-auto">
        {emptyKind ? (
          <CampaignsEmptyState
            kind={emptyKind}
            loading={loading}
            error={error}
            perfError={currentAccount?.perfLastSyncError ?? null}
            onRefresh={fetchData}
          />
        ) : !data ? (
          <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
            Загрузка…
          </div>
        ) : (
          <table className="w-full text-[11px]" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              {visibleCols.map((key) => (
                <col key={key} style={{ width: `${getWidth(key)}px` }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                {visibleCols.map((key) => {
                  const isRight = ['budget','expense','revenue','orders','views','clicks','ctr','cpc','drr'].includes(key);
                  const labels: Record<CampaignColKey, string> = {
                    campaign: 'Кампания', type: 'Тип', state: 'Статус',
                    budget: 'Бюджет/д', expense: 'Расход', revenue: 'Выручка р.',
                    orders: 'Заказы', views: 'Показы', clicks: 'Клики',
                    ctr: 'CTR', cpc: 'CPC', drr: 'ДРР',
                  };
                  return (
                    <th
                      key={key}
                      className={'relative select-none px-2 py-1.5 font-medium text-muted-foreground ' + (isRight ? 'text-right' : '')}
                      style={{ width: `${getWidth(key)}px` }}
                    >
                      <button
                        type="button"
                        className={'inline-flex w-full items-center gap-1 hover:text-foreground ' + (isRight ? 'justify-end' : '')}
                        onClick={() => toggleSort(key as SortKey)}
                        title={sort.key === key ? `Сортировка: ${sort.dir === 'asc' ? '↑' : '↓'}` : 'Кликните для сортировки'}
                      >
                        <span>{labels[key]}</span>
                        {sort.key === key
                          ? (sort.dir === 'asc' ? <ArrowUp className="h-2.5 w-2.5 shrink-0" /> : <ArrowDown className="h-2.5 w-2.5 shrink-0" />)
                          : <ArrowUpDown className="h-2.5 w-2.5 shrink-0 opacity-30 group-hover:opacity-70" />}
                      </button>
                      <div
                        className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-border/60 active:bg-primary/30"
                        onMouseDown={(e) => startResize(key, e)}
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {displayRows.map((c) => {
                const badge = stateBadge(c.state);
                const hasNoStats = c.expenseRub === 0 && c.orders === 0 && !data.summary?.statsAreAccountWide;
                const fmtRub = (v: number) => Math.round(v).toLocaleString('ru-RU') + ' ₽';
                const fmtNum = (v: number) => v.toLocaleString('ru-RU');
                const drrMax = Math.max(...displayRows.map((r) => r.drrPct ?? 0), 1);
                return (
                  <tr key={c.campaignId} className="hover:bg-accent/20">
                    {visibleCols.map((key) => {
                      if (key === 'campaign') return (
                        <td key={key} className="px-2 py-1.5">
                          <div className="truncate font-medium leading-snug" title={c.title ?? c.campaignId}>
                            {c.title ?? c.campaignId}
                          </div>
                          <div className="flex items-center gap-1.5 truncate font-mono text-[10px] text-muted-foreground">
                            <span>{c.campaignId}</span>
                            {(c.startDate || c.endDate) && (
                              <span className="text-[9px] opacity-60">
                                {c.startDate ?? '…'}–{c.endDate ?? '∞'}
                              </span>
                            )}
                          </div>
                        </td>
                      );
                      if (key === 'type') return (
                        <td key={key} className="truncate px-2 py-1.5 text-[11px]" title={humanizeType(c.paymentType, c.advObjectType)}>
                          {humanizeType(c.paymentType, c.advObjectType)}
                        </td>
                      );
                      if (key === 'state') return (
                        <td key={key} className="px-2 py-1.5">
                          <span className={'rounded-full px-1.5 py-0.5 text-[10px] ' + badge.cls}>{badge.label}</span>
                        </td>
                      );
                      if (key === 'budget') return (
                        <td key={key} className="px-2 py-1.5 text-right tabular-nums">
                          {c.dailyBudgetRub ? fmtRub(c.dailyBudgetRub) : '—'}
                        </td>
                      );
                      if (key === 'expense') return (
                        <td key={key} className={'px-2 py-1.5 text-right tabular-nums ' + (hasNoStats ? 'italic text-muted-foreground' : '')}
                          title={hasNoStats ? 'Нет perf-данных для этой кампании' : undefined}>
                          {hasNoStats ? '—' : fmtRub(c.expenseRub)}
                        </td>
                      );
                      if (key === 'revenue') return (
                        <td key={key} className="px-2 py-1.5 text-right tabular-nums">{c.ordersRub > 0 ? fmtRub(c.ordersRub) : '—'}</td>
                      );
                      if (key === 'orders') return (
                        <td key={key} className="px-2 py-1.5 text-right tabular-nums">{c.orders > 0 ? fmtNum(c.orders) : '—'}</td>
                      );
                      if (key === 'views') return (
                        <td key={key} className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{c.views > 0 ? fmtNum(c.views) : '—'}</td>
                      );
                      if (key === 'clicks') return (
                        <td key={key} className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">{c.clicks > 0 ? fmtNum(c.clicks) : '—'}</td>
                      );
                      if (key === 'ctr') return (
                        <td key={key} className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {c.ctrPct !== null ? c.ctrPct.toFixed(2) + '%' : '—'}
                        </td>
                      );
                      if (key === 'cpc') return (
                        <td key={key} className="px-2 py-1.5 text-right tabular-nums text-muted-foreground">
                          {c.cpcRub !== null ? c.cpcRub.toFixed(1) + ' ₽' : '—'}
                        </td>
                      );
                      if (key === 'drr') return (
                        <td key={key} className="px-2 py-1.5 text-right">
                          {c.drrPct !== null ? (
                            <div className="flex flex-col items-end gap-0.5">
                              <span className={'tabular-nums font-medium ' + drrColorCls(c.drrPct)}>
                                {c.drrPct.toFixed(1)}%
                              </span>
                              <div className="h-0.5 w-full max-w-[48px] overflow-hidden rounded-full bg-border/40">
                                <div
                                  className={'h-full rounded-full ' + (c.drrPct <= 15 ? 'bg-emerald-500' : c.drrPct <= 25 ? 'bg-amber-500' : 'bg-red-500')}
                                  style={{ width: `${Math.min(100, (c.drrPct / drrMax) * 100)}%` }}
                                />
                              </div>
                            </div>
                          ) : '—'}
                        </td>
                      );
                      return null;
                    })}
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="sticky bottom-0 border-t border-border/60 bg-muted/80 backdrop-blur text-[10px] text-muted-foreground font-medium">
              <tr>
                {visibleCols.map((key) => {
                  const isRight = ['budget','expense','revenue','orders','views','clicks','ctr','cpc','drr'].includes(key);
                  if (key === 'campaign') return <td key={key} className="px-2 py-1 text-[10px] font-semibold text-foreground">Итого: {displayRows.length}</td>;
                  if (key === 'type' || key === 'state' || key === 'budget') return <td key={key} className="px-2 py-1" />;
                  if (key === 'expense') return <td key={key} className={'px-2 py-1 tabular-nums ' + (isRight ? 'text-right' : '')}>{Math.round(totals.totalExpense).toLocaleString('ru-RU')} ₽</td>;
                  if (key === 'revenue') return <td key={key} className={'px-2 py-1 tabular-nums ' + (isRight ? 'text-right' : '')}>{Math.round(totals.totalRevenue).toLocaleString('ru-RU')} ₽</td>;
                  if (key === 'orders') return <td key={key} className={'px-2 py-1 tabular-nums ' + (isRight ? 'text-right' : '')}>{totals.totalOrders.toLocaleString('ru-RU')}</td>;
                  if (key === 'views') return <td key={key} className={'px-2 py-1 tabular-nums ' + (isRight ? 'text-right' : '')}>{totals.totalViews.toLocaleString('ru-RU')}</td>;
                  if (key === 'clicks') return <td key={key} className={'px-2 py-1 tabular-nums ' + (isRight ? 'text-right' : '')}>{totals.totalClicks.toLocaleString('ru-RU')}</td>;
                  if (key === 'ctr') return <td key={key} className={'px-2 py-1 tabular-nums ' + (isRight ? 'text-right' : '')}>{totals.avgCtr !== null ? totals.avgCtr.toFixed(2) + '%' : '—'}</td>;
                  if (key === 'cpc') return <td key={key} className={'px-2 py-1 tabular-nums ' + (isRight ? 'text-right' : '')}>{totals.totalClicks > 0 ? (totals.totalExpense / totals.totalClicks).toFixed(1) + ' ₽' : '—'}</td>;
                  if (key === 'drr') return <td key={key} className={'px-2 py-1 tabular-nums ' + drrColorCls(totals.avgDrr) + (isRight ? ' text-right' : '')}>{totals.avgDrr !== null ? totals.avgDrr.toFixed(1) + '%' : '—'}</td>;
                  return <td key={key} className="px-2 py-1" />;
                })}
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </Card>
  );
}

function CampaignsEmptyState({
  kind,
  loading,
  error,
  perfError,
  onRefresh,
}: {
  kind: 'no-account' | 'no-perf' | 'perf-error' | 'error' | 'no-campaigns';
  loading: boolean;
  error: string | null;
  perfError: string | null;
  onRefresh?: () => void;
}) {
  if (loading && kind === 'no-campaigns') {
    return (
      <div className="flex h-full items-center justify-center text-center text-[12px] text-muted-foreground">
        Загрузка…
      </div>
    );
  }
  if (kind === 'no-account') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-muted-foreground">
        <AlertCircle className="h-5 w-5" />
        Выберите Ozon-магазин в настройках блока
      </div>
    );
  }
  if (kind === 'no-perf') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-muted-foreground">
        <AlertCircle className="h-5 w-5" />
        Для этого магазина не подключён Performance API
        <Link
          href="/settings/integrations"
          className="text-[11px] text-primary hover:underline"
        >
          Подключить в Настройках → Интеграции →
        </Link>
      </div>
    );
  }
  if (kind === 'perf-error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-rose-700 dark:text-rose-300">
        <AlertCircle className="h-5 w-5" />
        Ошибка Performance API при последней синхронизации
        {perfError && <span className="text-[11px] opacity-80">{perfError}</span>}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent"
          >
            <RefreshCw className="h-3 w-3" /> Попробовать снова
          </button>
        )}
      </div>
    );
  }
  if (kind === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-rose-700 dark:text-rose-300">
        {error ?? 'Не удалось получить данные'}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[11px] font-medium text-foreground hover:bg-accent"
          >
            <RefreshCw className="h-3 w-3" /> Обновить
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-muted-foreground">
      <AlertCircle className="h-5 w-5" />
      Нет рекламных кампаний за выбранный период
      <span className="text-[11px] opacity-70">
        Запустите Perf-sync или подождите завершения генерации отчёта.
      </span>
    </div>
  );
}

function SortableHeader({
  sortKey,
  sort,
  onClick,
  align,
  children,
}: {
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onClick: (key: SortKey) => void;
  align?: 'left' | 'right';
  children: React.ReactNode;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th
      className={
        'group cursor-pointer select-none px-2 py-1.5 font-medium hover:text-foreground ' +
        (align === 'right' ? 'text-right' : '')
      }
      onClick={() => onClick(sortKey)}
      title={
        active
          ? `Сортировка: ${sort.dir === 'asc' ? '↑ по возрастанию' : '↓ по убыванию'}`
          : 'Кликните для сортировки'
      }
    >
      <span
        className={
          'inline-flex items-center gap-1 ' +
          (align === 'right' ? 'flex-row-reverse' : '')
        }
      >
        <span>{children}</span>
        <Icon
          className={
            'h-3 w-3 ' +
            (active
              ? 'text-foreground'
              : 'text-muted-foreground/40 group-hover:text-muted-foreground')
          }
        />
      </span>
    </th>
  );
}

const COL_LABELS: Record<CampaignColKey, string> = {
  campaign: 'Кампания', type: 'Тип', state: 'Статус',
  budget: 'Бюджет/день', expense: 'Расход', revenue: 'Выручка с рекл.',
  orders: 'Заказы', views: 'Показы', clicks: 'Клики',
  ctr: 'CTR', cpc: 'CPC', drr: 'ДРР',
};

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  function patch(updates: Partial<typeof parsed>) {
    onChange({ ...parsed, ...updates } as unknown as Record<string, unknown>);
  }
  const cols = parsed.visibleCols ?? DEFAULT_VISIBLE_COLS;
  function toggleCol(key: CampaignColKey) {
    if (key === 'campaign') return; // always visible
    const next = cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key];
    patch({ visibleCols: next });
  }
  return (
    <div className="space-y-4">
      <OzonAccountSelector
        value={parsed.accountId}
        onChange={(id) => patch({ accountId: id })}
        showPerfStatus
      />
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">Отображение</Label>
        <label className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2 text-[12px]">
          <span className="flex-1">
            <span className="font-medium">Только активные кампании</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              Скрыть «Пауза» и «Завершена» — оставить только RUNNING.
            </span>
          </span>
          <Switch
            checked={parsed.onlyActive}
            onCheckedChange={(on) => patch({ onlyActive: on })}
          />
        </label>
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px] text-muted-foreground">Видимые колонки</Label>
        <div className="grid grid-cols-2 gap-1">
          {ALL_CAMPAIGN_COLS.map((key) => (
            <label key={key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-[12px] hover:bg-accent/40">
              <input
                type="checkbox"
                checked={cols.includes(key)}
                disabled={key === 'campaign'}
                onChange={() => toggleCol(key)}
                className="h-3.5 w-3.5 rounded accent-primary"
              />
              <span className={key === 'campaign' ? 'text-muted-foreground' : ''}>{COL_LABELS[key]}</span>
            </label>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">
          Период задаётся в шапке блока и синхронизирован с глобальным периодом страницы.
        </p>
      </div>
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
