// PURPOSE: Блок «Ozon · Аналитика». Per-product таблица
// выручки/заказов/рекламы/ДРР/остатков за выбранный период.
// Отдельно от unit.ozon-multi-table (юнит-экономика калькулятор):
// этот блок read-only, агрегирующий, не редактируется пользователем.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Download, Loader2, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
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
import {
  OZON_ANALYTICS_PERIOD_PRESETS,
  OzonAnalyticsBlockConfigSchema,
  resolvePeriod,
  type OzonAnalyticsBlockConfig,
  type OzonAnalyticsPeriodPreset,
} from './unit-ozon-analytics-types';
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

function RenderOzonAnalytics({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);

  const [activeFilter, setActiveFilter] = useState<AnalyticsFilterId>(config.defaultFilter);
  const [periodPreset, setPeriodPreset] = useState<OzonAnalyticsPeriodPreset>(config.periodPreset);
  const [customFrom, setCustomFrom] = useState<string | null>(config.customFrom);
  const [customTo, setCustomTo] = useState<string | null>(config.customTo);
  const [response, setResponse] = useState<OzonAnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<TableSort>({ key: 'revenueRub', dir: 'desc' });
  const mountedRef = useRef(true);

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
        from: period.from.toISOString(),
        to: period.to.toISOString(),
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
    fetchData();
  }, [fetchData]);

  const rows = response?.rows ?? [];
  const filteredRows = useMemo(
    () => applyAnalyticsFilter(rows, activeFilter),
    [rows, activeFilter],
  );

  const handleExport = useCallback(() => {
    if (filteredRows.length === 0) return;
    const sorted = sortRows(filteredRows, sort);
    const columns = COLUMN_DEFS.filter((c) => config.visibleColumns.includes(c.key));
    const header = columns.map((c) => c.label);
    const body = sorted.map((row) =>
      columns.map((col) => {
        switch (col.key) {
          case 'article':
            return row.article ?? '';
          case 'name':
            return row.name;
          case 'priceRub':
            return row.priceRub;
          case 'costRub':
            return row.costRub;
          case 'marginRub':
            return row.priceRub - row.costRub;
          case 'delivered':
            return row.delivered;
          case 'qtyDelivered':
            return row.qtyDelivered;
          case 'revenueRub':
            return row.revenueRub;
          case 'adsRub':
            return row.adsRub;
          case 'drrPct':
            return row.drrPct ?? '';
          case 'stock':
            return row.stockMarketplace + row.stockOwn;
          case 'daysOfStock':
            return row.daysOfStock ?? '';
          case 'buyoutPct':
            return row.buyoutPct ?? '';
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
  }, [filteredRows, sort, config.visibleColumns, periodPreset, customFrom, customTo]);

  return (
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
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={loading}
            title="Обновить"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {loading ? ' Обновляем…' : ' Обновить'}
          </Button>
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
        <div className="grid grid-cols-2 gap-px border-b border-border/40 bg-border/40 sm:grid-cols-5">
          <Totals label="Выручка" value={formatRub(response.totals.revenueRub)} />
          <Totals label="Реклама" value={formatRub(response.totals.adsRub)} />
          <Totals label="ДРР" value={formatPct(response.totals.drrPct)} tone={response.totals.drrPct !== null && response.totals.drrPct > 20 ? 'warning' : 'neutral'} />
          <Totals label="Заказы" value={response.totals.delivered.toLocaleString('ru-RU')} />
          <Totals label="Товары с продажами" value={`${response.totals.productsWithSales} / ${rows.length}`} />
        </div>
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

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-hidden">
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
            sort={sort}
            onSortChange={setSort}
          />
        )}
      </div>
    </Card>
  );
}

function Totals({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'warning';
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
