// PURPOSE: Блок «Ozon · Аналитика». Per-product таблица
// выручки/заказов/рекламы/ДРР/остатков за выбранный период.
// Отдельно от unit.ozon-multi-table (юнит-экономика калькулятор):
// этот блок read-only, агрегирующий, не редактируется пользователем.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlockValuePublisher, formatPeriodKey } from '@/lib/blocks/values';
import {
  BarChart3,
  Check,
  CloudDownload,
  Download,
  Loader2,
  Lock,
  RefreshCw,
  Sigma,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { useLastFetched } from '@/lib/blocks/use-last-fetched';
import type { BlockDef, BlockRenderProps, BlockSettingsFormProps } from '../types';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  OzonAnalyticsTable,
  type TableSort,
  COLUMN_DEFS,
  sortRows,
} from '@/components/unit-economics/ozon-analytics-table';
import {
  ANALYTICS_FILTERS,
  applyAnalyticsFilter,
  type AnalyticsFilterId,
} from '@/components/unit-economics/ozon-analytics-filters';
import { OzonAnalyticsSettingsForm } from '@/components/unit-economics/ozon-analytics-settings-form';
import { OzonSyncDialog } from '@/components/marketplaces/ozon-sync-dialog';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';
import {
  OZON_ANALYTICS_PERIOD_PRESETS,
  OzonAnalyticsBlockConfigSchema,
  resolvePeriod,
  type OzonAnalyticsBlockConfig,
  type OzonAnalyticsPeriodPreset,
} from './unit-ozon-analytics-types';
import { useBlockPeriod } from '../use-block-period';
import { useOzonSyncListener } from '../use-ozon-sync-listener';
import type { OzonAnalyticsResponse } from '@/app/api/marketplaces/analytics/ozon/route';

function parseConfig(raw: unknown): OzonAnalyticsBlockConfig {
  return OzonAnalyticsBlockConfigSchema.parse(raw ?? {});
}

function formatRub(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString('ru-RU') + ' ₽';
}

function formatPct(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value.toFixed(value >= 100 ? 0 : 1) + '%';
}

function RenderOzonAnalytics({ instance, onConfigChange }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const { accounts } = useMarketplaceAccounts({ marketplace: 'ozon' });
  const account = accounts.find((a) => a.id === config.accountId);
  // Silent failure detection: perfSkuStats/perfCpoDaily запустились,
  // получили строки от Ozon, но parser записал 0 → надо сказать прямо.
  const perfStages = ['perfSkuStats', 'perfCpoDaily'] as const;
  const silentFailure = account
    ? perfStages.some((name) => {
        const s = account.lastSyncSummary?.stages?.[name];
        return s?.ok === true && (s.itemsTotal ?? 0) > 0 && (s.itemsProcessed ?? 0) === 0;
      })
    : false;

  const [activeFilter, setActiveFilter] = useState<AnalyticsFilterId>(config.defaultFilter);
  const {
    period: blockPeriod,
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
    // Persist explicit period changes to DB config so /api/blocks/sources uses the correct period
    // in the cross-page source picker (avoids value mismatch between pages).
    onConfigChange: (next) => {
      if (next) {
        onConfigChange?.({
          ...config,
          periodPreset: next.preset,
          customFrom: next.customFrom,
          customTo: next.customTo,
        } as unknown as Record<string, unknown>);
      }
    },
  });
  const periodPreset = blockPeriod.preset;
  const customFrom = blockPeriod.customFrom;
  const customTo = blockPeriod.customTo;
  const setPeriodPreset = useCallback(
    (preset: OzonAnalyticsPeriodPreset) => {
      setPeriodOverride({ preset, customFrom: blockPeriod.customFrom, customTo: blockPeriod.customTo });
    },
    [setPeriodOverride, blockPeriod.customFrom, blockPeriod.customTo],
  );
  const setCustomFrom = useCallback(
    (next: string | null) => {
      setPeriodOverride({ preset: blockPeriod.preset, customFrom: next, customTo: blockPeriod.customTo });
    },
    [setPeriodOverride, blockPeriod.preset, blockPeriod.customTo],
  );
  const setCustomTo = useCallback(
    (next: string | null) => {
      setPeriodOverride({ preset: blockPeriod.preset, customFrom: blockPeriod.customFrom, customTo: next });
    },
    [setPeriodOverride, blockPeriod.preset, blockPeriod.customFrom],
  );
  const [response, setResponse] = useState<OzonAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // v0.22.1: sync-модалка
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  // sort=null = «без сортировки», порядок rows как пришёл из API.
  // Cycle через UI: null → desc → asc → null.
  const [sort, setSort] = useState<TableSort | null>(null);

  // Persist изменение порядка/видимости колонок. visibleColumns теперь —
  // и порядок, и фильтр видимости (раньше порядок брался из COLUMN_DEFS, что
  // мешало DnD-перетаскиванию заголовков).
  const handleReorderColumns = useCallback(
    (next: string[]) => {
      onConfigChange?.({
        ...config,
        visibleColumns: next,
      } as unknown as Record<string, unknown>);
    },
    [config, onConfigChange],
  );
  const mountedRef = useRef(true);
  const { markFetched, label: lastFetchedLabel, justUpdated } = useLastFetched();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchData = useCallback(async () => {
    if (!config.accountId) {
      setResponse(null);
      setError('Подключите Ozon-магазин в настройках блока.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const period = resolvePeriod(periodPreset, customFrom, customTo);
      const params = new URLSearchParams({
        accountId: config.accountId,
        fromDate: period.msc.fromDate,
        toDateExclusive: period.msc.toDateExclusive,
      });
      const res = await fetch(`/api/marketplaces/analytics/ozon?${params}`);
      const data: unknown = await res.json();
      if (!mountedRef.current) return;
      if (
        res.ok &&
        data &&
        typeof data === 'object' &&
        'ok' in data &&
        (data as { ok: boolean }).ok
      ) {
        setResponse(data as OzonAnalyticsResponse);
        markFetched();
      } else {
        setError(
          (data as { error?: string } | null)?.error ?? `HTTP ${res.status}`,
        );
        setResponse(null);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed');
      setResponse(null);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [config.accountId, periodPreset, customFrom, customTo]);

  useEffect(() => {
    if (!periodReady) return;
    fetchData();
  }, [fetchData, periodReady]);

  useOzonSyncListener(fetchData);

  const rows = response?.rows ?? [];
  const filteredRows = useMemo(
    () => applyAnalyticsFilter(rows, activeFilter),
    [rows, activeFilter],
  );

  const periodDays = useMemo(() => {
    const period = resolvePeriod(periodPreset, customFrom, customTo);
    return Math.max(1, Math.round((period.to.getTime() - period.from.getTime()) / (24 * 3600 * 1000)));
  }, [periodPreset, customFrom, customTo]);

  const extendedTotals = useMemo(() => {
    let totalCostRub = 0;
    let stockTotal = 0;
    let qtyDelivered = 0;
    let buyoutSum = 0;
    let buyoutCount = 0;
    for (const r of rows) {
      totalCostRub += r.costRub * r.qtyDelivered;
      stockTotal += r.stockMarketplace + r.stockOwn;
      qtyDelivered += r.qtyDelivered;
      if (r.buyoutPct !== null) {
        buyoutSum += r.buyoutPct;
        buyoutCount += 1;
      }
    }
    const revenueRub = response?.totals.revenueRub ?? 0;
    return {
      totalCostRub,
      totalProfitRub: revenueRub - totalCostRub,
      stockTotal,
      qtyDelivered,
      avgBuyoutPct: buyoutCount > 0 ? Math.round((buyoutSum / buyoutCount) * 10) / 10 : null,
    };
  }, [rows, response?.totals.revenueRub]);

  // Top-1 SKU (DESC by revenue) — для модалки связей и hero-блоков.
  // Считаем на клиенте из rows (response уже отсортирован по revenue DESC).
  const top1 = rows.length > 0 ? rows[0] : null;
  // avg/max DRR по SKU с продажами и расходом.
  const drrValues = rows
    .map((r) => r.drrPct)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  const avgDrr =
    drrValues.length > 0
      ? Math.round((drrValues.reduce((s, v) => s + v, 0) / drrValues.length) * 10) / 10
      : 0;
  const maxDrr =
    drrValues.length > 0 ? Math.round(Math.max(...drrValues) * 10) / 10 : 0;
  // Стоимость остатков = sum(costRub × (stockMarketplace + stockOwn)).
  const totalStockValueRub = rows.reduce(
    (s, r) => s + r.costRub * (r.stockMarketplace + r.stockOwn),
    0,
  );

  // Богатый текстовый контекст для «AI Анализ раздела» (конвенция __aiContext).
  const aiContext = useMemo(() => {
    if (!response) return null;
    const rub = (v: number) => Math.round(v).toLocaleString('ru-RU') + ' ₽';
    const t = response.totals;
    const parts = [
      `Аналитика Ozon за период: выручка ${rub(t.revenueRub)}, реклама ${rub(t.adsRub)}, ` +
        `ДРР ${t.drrPct?.toFixed(1) ?? '—'}%, прибыль ${rub(extendedTotals.totalProfitRub)}, ` +
        `заказы ${t.delivered}, отмены ${t.cancelled}, возвраты ${t.returned}.`,
      `Товаров ${rows.length}, с продажами ${t.productsWithSales}, остатки на ${rub(totalStockValueRub)}, ` +
        `средний выкуп ${extendedTotals.avgBuyoutPct ?? '—'}%. Средний ДРР по SKU ${avgDrr}%, макс ${maxDrr}%.`,
    ];
    if (top1) {
      parts.push(
        `Топ-1 SKU: ${top1.article ?? top1.name} — выручка ${rub(top1.revenueRub)}, ДРР ${top1.drrPct?.toFixed(0) ?? '—'}%.`,
      );
    }
    return parts.join(' ');
  }, [response, rows.length, extendedTotals, top1, avgDrr, maxDrr, totalStockValueRub]);

  useBlockValuePublisher(instance.id, {
    value: (response?.totals.revenueRub ?? 0) * 100,
    revenue: (response?.totals.revenueRub ?? 0) * 100,
    ads: (response?.totals.adsRub ?? 0) * 100,
    totalCostRub: extendedTotals.totalCostRub * 100,
    totalProfitRub: extendedTotals.totalProfitRub * 100,
    drr: response?.totals.drrPct ?? 0,
    orders: response?.totals.delivered ?? 0,
    cancelled: response?.totals.cancelled ?? 0,
    returned: response?.totals.returned ?? 0,
    qtyDelivered: extendedTotals.qtyDelivered,
    productsWithSales: response?.totals.productsWithSales ?? 0,
    rowsCount: rows.length,
    stockTotal: extendedTotals.stockTotal,
    avgBuyoutPct: extendedTotals.avgBuyoutPct ?? 0,
    // --- Top-1 SKU метрики (новые в v0.18.21) ---
    top1Revenue: (top1?.revenueRub ?? 0) * 100,
    top1Article: top1?.article ?? '',
    top1Name: top1?.name ?? '',
    top1Drr: top1?.drrPct ?? 0,
    top1Ads: (top1?.adsRub ?? 0) * 100,
    avgDrr,
    maxDrr,
    totalStockValueRub: totalStockValueRub * 100,
    label: instance.appearance?.title ?? config.title,
    __money:
      'value,revenue,ads,totalCostRub,totalProfitRub,' +
      'top1Revenue,top1Ads,totalStockValueRub',
    __labels:
      'value=Выручка / период,revenue=Выручка / период,ads=Реклама / период,' +
      'totalCostRub=Себестоимость проданного,totalProfitRub=Прибыль (выручка−себест),' +
      'drr=ДРР %,orders=Заказы доставлено,cancelled=Заказы отменено,' +
      'returned=Заказы возврат,qtyDelivered=Штук доставлено,' +
      'productsWithSales=Товары с продажами,rowsCount=Всего товаров,' +
      'stockTotal=Остатки (шт),avgBuyoutPct=Средний выкуп %,' +
      'top1Revenue=Выручка топ-1 SKU,top1Article=Артикул топ-1 SKU,' +
      'top1Name=Название топ-1 SKU,top1Drr=ДРР топ-1 SKU %,' +
      'top1Ads=Реклама топ-1 SKU,avgDrr=Средний ДРР по SKU %,' +
      'maxDrr=Максимальный ДРР %,totalStockValueRub=Стоимость остатков',
    __periodKey: formatPeriodKey(blockPeriod),
    __aiContext: aiContext,
  });

  const handleExport = useCallback(() => {
    if (filteredRows.length === 0) return;
    // Экспортируем в том же порядке, что и таблица: если пользователь сбросил
    // сортировку (sort=null) — берём rows как пришли из API.
    const sorted = sort ? sortRows(filteredRows, sort) : filteredRows;
    // Порядок колонок берём из visibleColumns (пользовательский порядок через
    // DnD), а не из COLUMN_DEFS, чтобы XLSX совпадал с тем, что на экране.
    const byKey = new Map(COLUMN_DEFS.map((c) => [c.key, c]));
    const columns = config.visibleColumns
      .map((key) => byKey.get(key))
      .filter((c): c is (typeof COLUMN_DEFS)[number] => Boolean(c));
    const header = columns.map((c) => c.label);
    const body = sorted.map((row) =>
      columns.map((col) => {
        const totalRev = response?.totals.revenueRub ?? 0;
        switch (col.key) {
          case 'article':
            return row.article ?? '';
          case 'name':
            return row.name;
          case 'sku':
            return row.sku ?? '';
          case 'priceRub':
            return row.priceRub;
          case 'costRub':
            return row.costRub;
          case 'marginRub':
            return row.priceRub - row.costRub;
          case 'delivered':
            return row.delivered;
          case 'deliveredFbo':
            return row.deliveredFbo;
          case 'deliveredFbs':
            return row.deliveredFbs;
          case 'qtyDelivered':
            return row.qtyDelivered;
          case 'cancelled':
            return row.cancelled;
          case 'returned':
            return row.returned;
          case 'returnPct': {
            const total = row.delivered + row.returned;
            return total > 0 ? +((row.returned / total) * 100).toFixed(1) : '';
          }
          case 'revenueRub':
            return row.revenueRub;
          case 'adsRub':
            return row.adsRub;
          case 'drrPct':
            return row.drrPct ?? '';
          case 'stock':
            return row.stockMarketplace + row.stockOwn;
          case 'stockFbo':
            return row.stockMarketplace;
          case 'stockFbs':
            return row.stockOwn;
          case 'daysOfStock':
            return row.daysOfStock ?? '';
          case 'buyoutPct':
            return row.buyoutPct ?? '';
          case 'views':
            return row.views;
          case 'clicks':
            return row.clicks;
          case 'ctr':
            return row.views > 0 ? +((row.clicks / row.views) * 100).toFixed(2) : '';
          case 'cartAdds':
            return row.cartAdds;
          case 'cpc':
            return row.clicks > 0 ? +(row.adsRub / row.clicks).toFixed(2) : '';
          case 'cpm':
            return row.views > 0 ? +((row.adsRub / row.views) * 1000).toFixed(2) : '';
          case 'salesPerDay':
            return periodDays > 0 ? +(row.qtyDelivered / periodDays).toFixed(1) : '';
          case 'salesShare':
            return totalRev > 0 ? +((row.revenueRub / totalRev) * 100).toFixed(1) : '';
          default:
            return '';
        }
      }),
    );
    const aoa = [header, ...body];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ozon analytics');
    const period = resolvePeriod(periodPreset, customFrom, customTo);
    const fname = `ozon-analytics_${period.from.toISOString().slice(0, 10)}_${period.to.toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fname);
  }, [filteredRows, sort, config.visibleColumns, periodPreset, customFrom, customTo, periodDays, response]);

  return (
    <>
    <Card className="flex h-full flex-col overflow-hidden p-0">
      {/* Header: period + refresh + export */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1">
          {OZON_ANALYTICS_PERIOD_PRESETS.filter((p) => p.id !== 'custom').map((p) => {
            const active = periodPreset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPeriodPreset(p.id)}
                className={
                  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors ' +
                  (active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 bg-background hover:bg-accent')
                }
              >
                {p.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setPeriodPreset('custom')}
            className={
              'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors ' +
              (periodPreset === 'custom'
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border/60 bg-background hover:bg-accent')
            }
          >
            Период…
          </button>
          {periodPreset === 'custom' && (
            <span className="ml-1 inline-flex items-center gap-1">
              <input
                type="date"
                value={customFrom?.slice(0, 10) ?? ''}
                onChange={(e) =>
                  setCustomFrom(e.target.value ? new Date(e.target.value).toISOString() : null)
                }
                className="rounded-md border border-border/60 bg-background px-1 py-0.5 text-[11px]"
              />
              <span className="text-[10px] text-muted-foreground">→</span>
              <input
                type="date"
                value={customTo?.slice(0, 10) ?? ''}
                onChange={(e) =>
                  setCustomTo(e.target.value ? new Date(e.target.value).toISOString() : null)
                }
                className="rounded-md border border-border/60 bg-background px-1 py-0.5 text-[11px]"
              />
            </span>
          )}
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
        </div>
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
            title="Обновить (re-fetch из БД)"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() =>
              onConfigChange?.({
                ...config,
                showTotalsRow: !config.showTotalsRow,
              } as unknown as Record<string, unknown>)
            }
            className={
              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ' +
              (config.showTotalsRow
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground')
            }
            title={config.showTotalsRow ? 'Скрыть строку «Итог»' : 'Показать строку «Итог»'}
          >
            <Sigma className="h-3 w-3" />
            <span className="hidden sm:inline">Итог</span>
          </button>
          <button
            type="button"
            onClick={() => setSyncDialogOpen(true)}
            disabled={!config.accountId}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            title="Синхронизировать с Ozon (загрузить новые данные)"
          >
            <CloudDownload className="h-3 w-3" />
            <span className="hidden sm:inline">Sync</span>
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={filteredRows.length === 0}
            title="Скачать XLSX"
          >
            <Download className="h-3 w-3" /> XLSX
          </Button>
        </div>
      </div>

      {/* Totals header */}
      {response && (
        <>
          <div className="grid grid-cols-2 gap-px border-b border-border/40 bg-border/40 sm:grid-cols-5">
            <Totals label="Выручка" value={formatRub(response.totals.revenueRub)} />
            <Totals
              label="Реклама"
              value={formatRub(response.totals.adsRub)}
              subtitle={
                response.totals.adsCpcRub > 0 || response.totals.adsCpoRub > 0
                  ? `CPC ≈ ${formatRub(response.totals.adsCpcRub)} · CPO ≈ ${formatRub(response.totals.adsCpoRub)}`
                  : undefined
              }
              subtitleTitle={
                response.adsSource === 'expense'
                  ? `Источник: expense_daily (Performance API).
Total включает все типы кампаний (SKU/SEARCH_PROMO/ALL_SKU_PROMO/BANNER/VIDEO) + бонусы — как в рекламном кабинете Ozon.
CPC/CPO — breakdown per-SKU/CPO (может не суммироваться в total)${
                      response.reconciliationGapPct !== null && response.reconciliationGapPct > 5
                        ? `.
Расхождение expense vs CPC+CPO: ${response.reconciliationGapPct.toFixed(1)}% — перезапустите perfExpenseDaily + perfCpoDaily.`
                        : '.'
                    }`
                  : 'CPC/CPM — per-SKU. CPO — агрегат по магазину, распределён по SKU пропорционально выручке.'
              }
            />
            <Totals label="ДРР" value={formatPct(response.totals.drrPct)} tone={response.totals.drrPct !== null && response.totals.drrPct > 20 ? 'warning' : 'neutral'} />
            <Totals
              label="Заказы"
              value={response.totals.delivered.toLocaleString('ru-RU')}
              subtitle={
                response.totals.deliveredFbo + response.totals.deliveredFbs > 0
                  ? `FBO: ${response.totals.deliveredFbo.toLocaleString('ru-RU')} · FBS: ${response.totals.deliveredFbs.toLocaleString('ru-RU')}`
                  : undefined
              }
              subtitleTitle="FBO — со склада Ozon. FBS — со склада продавца. Сумма может быть меньше «Заказы» если ozon_orders ещё не синхронизированы."
            />
            <Totals label="Товары с продажами" value={`${response.totals.productsWithSales} / ${rows.length}`} />
          </div>
          {/* Source badges: оставлены только actionable warnings.
              «Расхождение expense vs CPC+CPO» и «Эталон Performance API» переехали
              в tooltip subtitle блока Реклама — не мешают сканированию таблицы. */}
          {response.ordersSource === 'orders-fallback' && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 bg-amber-50 px-3 py-1 text-[10px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              <span className="font-medium">Аналитика из postings (legacy).</span>
              <span className="text-amber-700/80 dark:text-amber-400/70">
                Запустите sync «Аналитика продаж (Seller API)» в настройках для точных цифр как в Seller-кабинете Ozon.
              </span>
            </div>
          )}
          {response.adsSource === 'transactions-heuristic' && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 bg-amber-50 px-3 py-1 text-[10px] text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
              <span className="font-medium">Реклама из транзакций (эвристика).</span>
              <span className="text-amber-700/80 dark:text-amber-400/70">
                Подключите Performance API и запустите sync «Статистика рекламы по товарам».
              </span>
            </div>
          )}
          {response.adsSource === 'none' && response.totals.revenueRub > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 bg-rose-50 px-3 py-1 text-[10px] text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">
              {silentFailure ? (
                <>
                  <span className="font-medium">
                    Sync завершился, но Performance отчёты не записаны.
                  </span>
                  <span className="text-rose-700/80 dark:text-rose-400/70">
                    Откройте Settings → Синхронизация — там видны warnings из последнего
                    sync (CSV-формат / парсер / пустой отчёт). Запустите{' '}
                    <code className="rounded bg-rose-100 px-1 dark:bg-rose-900/40">
                      pnpm tsx scripts/debug-ozon-perf-csv.ts {config.accountId}
                    </code>{' '}
                    для диагностики.
                  </span>
                </>
              ) : account?.perfConnected ? (
                <>
                  <span className="font-medium">
                    Performance API подключён, но синхронизации ещё не было.
                  </span>
                  <span className="text-rose-700/80 dark:text-rose-400/70">
                    Откройте Settings → Синхронизация и запустите стейджи
                    perfCampaigns + perfSkuStats + perfCpoDaily.
                  </span>
                </>
              ) : (
                <>
                  <span className="font-medium">Расход на рекламу не загружен.</span>
                  <span className="text-rose-700/80 dark:text-rose-400/70">
                    Подключите Performance API в Settings → Интеграции и запустите
                    sync — без него ДРР и колонка «Расход» не считаются.
                  </span>
                </>
              )}
            </div>
          )}
        </>
      )}

      {/* Filter chips */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border/40 px-3 py-1.5">
        {ANALYTICS_FILTERS.map((f) => {
          const active = activeFilter === f.id;
          const count = applyAnalyticsFilter(rows, f.id).length;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setActiveFilter(f.id)}
              title={f.hint}
              className={
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ' +
                (active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/60 bg-background text-foreground hover:bg-accent')
              }
            >
              <span>{f.label}</span>
              <span
                className={
                  'rounded-full px-1 text-[10px] font-medium ' +
                  (active ? 'bg-primary/20' : 'bg-muted text-muted-foreground')
                }
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Body. overflow-auto на flex-child — нужно для scroll внутри таблицы.
          min-h-0 обязательно, иначе flex-1 даёт min-height: auto и body вылезает. */}
      <div className="min-h-0 flex-1 overflow-auto">
        {error ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
            {error}
          </div>
        ) : loading && !response ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-[12px] text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Загрузка аналитики…
          </div>
        ) : (
          <OzonAnalyticsTable
            rows={filteredRows}
            enabledColumns={config.visibleColumns}
            pinnedColumns={config.pinnedColumns}
            onReorderColumns={handleReorderColumns}
            sort={sort}
            onSortChange={setSort}
            totalRevenue={response?.totals.revenueRub ?? 0}
            periodDays={periodDays}
            showProductImage={config.showProductImage}
            showDrrColor={config.showDrrColor}
            showStockColor={config.showStockColor}
            useOzonTurnover={config.useOzonTurnover}
            showTotalsRow={config.showTotalsRow}
          />
        )}
      </div>
    </Card>
    <OzonSyncDialog
      open={syncDialogOpen}
      onOpenChange={setSyncDialogOpen}
      accountId={config.accountId ?? null}
      defaultPreset="auto"
      onCompleted={async ({ status }) => {
        if (status !== 'error') {
          // Auto re-fetch таблицы (cache бамп сделан на сервере в стейджах).
          await fetchData();
        }
      }}
    />
    </>
  );
}

function Totals({
  label,
  value,
  tone,
  subtitle,
  subtitleTitle,
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'warning';
  subtitle?: string;
  subtitleTitle?: string;
}) {
  return (
    <div className="bg-card p-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={
          'text-[14px] font-semibold tabular-nums ' +
          (tone === 'warning' ? 'text-amber-700 dark:text-amber-300' : '')
        }
      >
        {value}
      </div>
      {subtitle && (
        <div
          className="mt-0.5 text-[10px] text-muted-foreground/80 tabular-nums"
          title={subtitleTitle}
        >
          {subtitle}
        </div>
      )}
    </div>
  );
}

function UnitOzonAnalyticsSettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  return (
    <OzonAnalyticsSettingsForm
      value={parsed}
      onChange={(next) => onChange(next as unknown as Record<string, unknown>)}
    />
  );
}

export const UnitOzonAnalyticsBlock: BlockDef = {
  type: 'unit.ozon-analytics',
  displayName: 'Ozon · Аналитика',
  description:
    'Таблица per-product: выручка, заказы, реклама, ДРР, остатки за выбранный период. Read-only, обновляется автоматически.',
  category: 'tables',
  icon: BarChart3,
  defaultSize: { w: 12, h: 10 },
  minSize: { w: 6, h: 5 },
  minContentSize: { w: 480, h: 240 },
  pages: ['unit-economics-ozon-multi', '*'],
  configSchema: OzonAnalyticsBlockConfigSchema,
  defaultConfig: () => OzonAnalyticsBlockConfigSchema.parse({}),
  SettingsForm: UnitOzonAnalyticsSettingsForm,
  Render: RenderOzonAnalytics,
};
