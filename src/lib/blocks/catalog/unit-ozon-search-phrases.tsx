// PURPOSE: Блок «Ozon · Поисковые фразы».

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Search, AlertCircle, Check, Info, Lock, RefreshCw } from 'lucide-react';
import { useLastFetched } from '@/lib/blocks/use-last-fetched';
import { Card } from '@/components/ui/card';
import {
  PeriodPicker,
  resolvePeriod,
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
  const [data, setData] = useState<OzonSearchPhrasesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const { markFetched, label: lastFetchedLabel, justUpdated } = useLastFetched();
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
      if (res.ok && json.ok) {
        setData(json as OzonSearchPhrasesResponse);
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

  // Публикуем агрегаты для привязок.
  const rows = data?.rows ?? [];
  const totals = useMemo(() => {
    const views = rows.reduce((a, b) => a + b.views, 0);
    const clicks = rows.reduce((a, b) => a + b.clicks, 0);
    const orders = rows.reduce((a, b) => a + b.orders, 0);
    const expense = rows.reduce((a, b) => a + b.expenseRub, 0);
    return { views, clicks, orders, expense };
  }, [rows]);
  useBlockValuePublisher(instance.id, {
    value: totals.expense,
    totalViews: totals.views,
    totalClicks: totals.clicks,
    totalOrders: totals.orders,
    totalExpenseRub: totals.expense,
    avgCtrPct: totals.views > 0 ? (totals.clicks / totals.views) * 100 : null,
    phrasesCount: rows.length,
    label: instance.appearance?.title ?? 'Ozon · Поисковые фразы',
    __labels:
      'value=Расход на фразы,totalViews=Всего показов,totalClicks=Всего кликов,' +
      'totalOrders=Заказы с фраз,totalExpenseRub=Расход на фразы,' +
      'avgCtrPct=Средний CTR (%),phrasesCount=Уникальных фраз',
    __money: 'value,totalExpenseRub',
  });

  const widths = useMemo(
    () => ({
      phrase: autoColumnWidth('Фраза', rows.map((r) => r.phrase), { min: 180, max: 360 }),
      views: autoColumnWidth(
        'Показы',
        rows.map((r) => r.views.toLocaleString('ru-RU')),
        { min: 80, max: 120 },
      ),
      clicks: autoColumnWidth(
        'Клики',
        rows.map((r) => r.clicks.toLocaleString('ru-RU')),
        { min: 70, max: 110 },
      ),
      ctr: autoColumnWidth(
        'CTR',
        rows.map((r) => (r.ctrPct !== null ? r.ctrPct.toFixed(1) + '%' : '—')),
        { min: 60, max: 100 },
      ),
      orders: autoColumnWidth('Заказы', rows.map((r) => String(r.orders)), {
        min: 70,
        max: 110,
      }),
      expense: autoColumnWidth(
        'Расход',
        rows.map((r) => Math.round(r.expenseRub).toLocaleString('ru-RU') + ' ₽'),
        { min: 80, max: 130 },
      ),
      cpo: autoColumnWidth(
        'CPO',
        rows.map((r) => (r.cpoRub !== null ? Math.round(r.cpoRub) + ' ₽' : '—')),
        { min: 70, max: 110 },
      ),
    }),
    [rows],
  );

  // Структурированный empty state. КРИТИЧНО: «Поисковые фразы» —
  // Performance API не отдаёт стабильный отчёт «search-phrases». Sync stage
  // помечен TODO. Поэтому даже при подключённом Performance API данные могут
  // быть пусты. Показываем это как `limited`, не как ошибку.
  const emptyKind:
    | 'no-account'
    | 'no-perf'
    | 'perf-error'
    | 'error'
    | 'limited'
    | null = !config.accountId
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
                ? 'limited'
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
        <span
          className="rounded-md border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200"
          title="Поисковые фразы доступны только для CPC/CPM Search Promo кампаний. CPO (Оплата за заказ) — без детализации по фразам."
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
          <SearchPhrasesEmptyState
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
              <col style={{ width: `${widths.phrase}px` }} />
              <col style={{ width: `${widths.views}px` }} />
              <col style={{ width: `${widths.clicks}px` }} />
              <col style={{ width: `${widths.ctr}px` }} />
              <col style={{ width: `${widths.orders}px` }} />
              <col style={{ width: `${widths.expense}px` }} />
              <col style={{ width: `${widths.cpo}px` }} />
            </colgroup>
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
                  <td className="truncate px-2 py-1.5 font-medium" title={r.phrase}>
                    {r.phrase}
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

function SearchPhrasesEmptyState({
  kind,
  loading,
  error,
  perfError,
  onRefresh,
}: {
  kind: 'no-account' | 'no-perf' | 'perf-error' | 'error' | 'limited';
  loading: boolean;
  error: string | null;
  perfError: string | null;
  onRefresh?: () => void;
}) {
  if (loading && kind === 'limited') {
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
  // limited — Ozon Performance API не отдаёт стабильный CSV-отчёт
  // «search-phrases» без личного обращения. Это не баг и не ошибка
  // подключения, поэтому не пугаем пользователя «нет данных».
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-[12px] text-muted-foreground">
      <Info className="h-5 w-5 text-sky-700 dark:text-sky-400" />
      <span className="font-medium text-foreground">
        Поисковые фразы — ограниченная поддержка
      </span>
      <span className="max-w-xs text-[11px]">
        Ozon Performance API не предоставляет стабильный отчёт «поисковые
        фразы» без индивидуального доступа. Данные отображаются только если
        вы запустили sync с расширенными правами.
      </span>
      <span className="text-[10px] opacity-70">
        Когда отчёт появится в API — блок начнёт работать автоматически.
      </span>
    </div>
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
