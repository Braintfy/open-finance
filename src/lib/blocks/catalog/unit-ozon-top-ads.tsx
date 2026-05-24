// PURPOSE: Блок «Ozon · Топ рекламы» — таблица с SKU, расходом, CTR/CPC/CPO/ДРР.
// Если perf-данных нет — показывает CTA подключения Performance API.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Megaphone, ArrowUpDown, AlertCircle, Check, Lock, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useLastFetched } from '@/lib/blocks/use-last-fetched';
import {
  PeriodPicker,
  resolveOzonPeriod,
  type PeriodPreset,
  type PeriodValue,
} from '@/components/blocks/period-picker';
import { OzonAccountSelector } from '@/components/marketplaces/ozon-account-selector';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { useBlockPeriod } from '@/lib/blocks/use-block-period';
import { autoColumnWidth } from '@/lib/blocks/auto-column-width';
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
  const [data, setData] = useState<OzonTopAdsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { markFetched, label: lastFetchedLabel, justUpdated } = useLastFetched();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'expenseRub',
    dir: 'desc',
  });
  const mountedRef = useRef(true);
  const { accounts } = useMarketplaceAccounts({ marketplace: 'ozon' });
  const currentAccount = useMemo(
    () => accounts.find((a) => a.id === config.accountId) ?? null,
    [accounts, config.accountId],
  );

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
      const range = resolveOzonPeriod(period.preset, period.customFrom, period.customTo);
      const params = new URLSearchParams({
        accountId: config.accountId,
        fromDate: range.fromDate,
        toDateExclusive: range.toDateExclusive,
        limit: String(config.limit),
      });
      const res = await fetch(`/api/marketplaces/ozon/top-ads?${params}`);
      const json = await res.json();
      if (!mountedRef.current) return;
      if (res.ok && json.ok) {
        setData(json as OzonTopAdsResponse);
        markFetched();
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

  // Summary для публикации значений и привязок других блоков.
  const summary = useMemo(() => {
    if (!data || data.rows.length === 0) {
      return { expenseRub: 0, orders: 0, clicks: 0, views: 0, drrPct: null as number | null };
    }
    const totalExpense = data.rows.reduce((a, b) => a + b.expenseRub, 0);
    const totalOrders = data.rows.reduce((a, b) => a + b.orders, 0);
    const totalClicks = data.rows.reduce((a, b) => a + b.clicks, 0);
    const totalViews = data.rows.reduce((a, b) => a + b.views, 0);
    const totalOrdersRub = data.rows.reduce((a, b) => a + (b.ordersRub ?? 0), 0);
    return {
      expenseRub: totalExpense,
      orders: totalOrders,
      clicks: totalClicks,
      views: totalViews,
      drrPct: totalOrdersRub > 0 ? (totalExpense / totalOrdersRub) * 100 : null,
    };
  }, [data]);

  // Primary value (расход) — для bind в single-cell. Дополнительные поля и
  // лейблы для модалки «Связать ячейку».
  useBlockValuePublisher(instance.id, {
    value: summary.expenseRub,
    totalExpenseRub: summary.expenseRub,
    totalOrders: summary.orders,
    totalClicks: summary.clicks,
    totalViews: summary.views,
    avgDrrPct: summary.drrPct ?? 0,
    rowCount: rows.length,
    __labels:
      'value=Расход на рекламу,totalExpenseRub=Расход на рекламу,' +
      'totalOrders=Заказы,totalClicks=Клики,totalViews=Показы,' +
      'avgDrrPct=Средний ДРР %,rowCount=Товаров в топе',
    __money: 'value,totalExpenseRub',
  });

  // Авторасчёт ширин — как в ozon-analytics-table.
  const columnWidths = useMemo(() => {
    const productSamples = rows.map((r) => `${r.name ?? r.sku}\n${r.article ?? r.sku}`);
    return {
      product: autoColumnWidth('Товар', productSamples, { min: 140, max: 320 }),
      expense: autoColumnWidth('Расход', rows.map((r) => fmtRub(r.expenseRub)), { min: 80, max: 130 }),
      drr: autoColumnWidth('ДРР', rows.map((r) => fmtPct(r.drrPct)), { min: 60, max: 100 }),
      orders: autoColumnWidth('Заказы', rows.map((r) => String(r.orders)), { min: 60, max: 100 }),
      ctr: autoColumnWidth('CTR', rows.map((r) => fmtPct(r.ctrPct)), { min: 60, max: 100 }),
      cpc: autoColumnWidth('CPC', rows.map((r) => fmtRubOrDash(r.cpcRub)), { min: 60, max: 110 }),
      cpo: autoColumnWidth('CPO', rows.map((r) => fmtRubOrDash(r.cpoRub)), { min: 60, max: 110 }),
    };
  }, [rows]);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'desc' },
    );
  }

  // Структурированный empty state: разделяем «нет аккаунта» / «нет perf»
  // / «ошибка» / «нет данных», чтобы пользователь не подумал, что просто
  // некорректно настроена интеграция.
  const emptyKind: 'no-account' | 'no-perf' | 'perf-error' | 'error' | 'no-data' | null =
    !config.accountId
      ? 'no-account'
      : !currentAccount
        ? 'no-account'
        : !currentAccount.perfConnected
          ? 'no-perf'
          : error
            ? 'error'
            : data && data.rows.length > 0
              ? null
              : currentAccount.perfStatus === 'error'
                ? 'perf-error'
                : data && data.rows.length === 0
                  ? 'no-data'
                  : null;

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
        <PeriodPicker
          value={{ preset: period.preset as PeriodPreset, customFrom: period.customFrom, customTo: period.customTo }}
          onChange={setPeriod}
          compact
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
        <span
          className="rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
          title="Per-SKU аналитика доступна только для Search Promo (CPC/CPM). Расход CPO кампаний (Оплата за заказ) — агрегат по магазину, виден в KPI блоке."
        >
          CPC/CPM
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {lastFetchedLabel && (
            <span
              className={
                'flex items-center gap-1 text-[10px] transition-colors ' +
                (justUpdated ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')
              }
              title={`Последнее обновление: ${lastFetchedLabel}`}
            >
              {justUpdated && <Check className="h-2.5 w-2.5" />}
              {lastFetchedLabel}
            </span>
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
      <div className="min-h-0 flex-1 overflow-auto">
        {emptyKind ? (
          <TopAdsEmptyState
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
              <col style={{ width: `${columnWidths.product}px` }} />
              <col style={{ width: `${columnWidths.expense}px` }} />
              <col style={{ width: `${columnWidths.drr}px` }} />
              <col style={{ width: `${columnWidths.orders}px` }} />
              <col style={{ width: `${columnWidths.ctr}px` }} />
              <col style={{ width: `${columnWidths.cpc}px` }} />
              <col style={{ width: `${columnWidths.cpo}px` }} />
            </colgroup>
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
                    <div className="truncate font-medium" title={r.name ?? r.sku}>
                      {r.name ?? r.sku}
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
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

function TopAdsEmptyState({
  kind,
  loading,
  error,
  perfError,
  onRefresh,
}: {
  kind: 'no-account' | 'no-perf' | 'perf-error' | 'error' | 'no-data';
  loading: boolean;
  error: string | null;
  perfError: string | null;
  onRefresh?: () => void;
}) {
  if (loading && kind === 'no-data') {
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
  // no-data
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-muted-foreground">
      <AlertCircle className="h-5 w-5" />
      Нет рекламных данных за выбранный период
      <span className="text-[11px] opacity-70">
        Попробуйте увеличить диапазон или дождитесь Performance-sync.
      </span>
    </div>
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
