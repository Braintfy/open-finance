// PURPOSE: Блок «Ozon · Кампании» — таблица кампаний с расходом и заказами.

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
import { useBlockValuePublisher } from '@/lib/blocks/values';
import { useBlockPeriod } from '@/lib/blocks/use-block-period';
import { autoColumnWidth } from '@/lib/blocks/auto-column-width';
import type {
  BlockDef,
  BlockRenderProps,
  BlockSettingsFormProps,
} from '../types';
import type { OzonCampaignsResponse } from '@/app/api/marketplaces/ozon/campaigns/route';

export const OzonCampaignsBlockConfigSchema = z.object({
  accountId: z.string().nullable().default(null),
  periodPreset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('30d'),
  customFrom: z.string().nullable().default(null),
  customTo: z.string().nullable().default(null),
  /** Скрыть кампании в статусе PAUSED/FINISHED — оставить только RUNNING. */
  onlyActive: z.boolean().default(false),
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
  | 'orders'
  | 'drr';
type SortDir = 'asc' | 'desc';

function RenderOzonCampaigns({ instance }: BlockRenderProps) {
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
    fetchData();
  }, [fetchData]);

  // Публикуем summary (общий расход/заказы/ДРР) для привязок и AI.
  const summary = data?.summary ?? {
    expenseRub: 0,
    orders: 0,
    ordersRub: 0,
    drrPct: null as number | null,
    statsAreAccountWide: false,
  };
  useBlockValuePublisher(instance.id, {
    value: summary.expenseRub,
    totalExpenseRub: summary.expenseRub,
    totalOrders: summary.orders,
    totalOrdersRub: summary.ordersRub,
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
          const av = `${a.paymentType ?? ''} ${a.advObjectType ?? ''}`.toLowerCase();
          const bv = `${b.paymentType ?? ''} ${b.advObjectType ?? ''}`.toLowerCase();
          return av.localeCompare(bv, 'ru') * dir;
        }
        case 'state':
          return (stateOrdinal(a.state) - stateOrdinal(b.state)) * dir;
        case 'budget':
          return ((a.dailyBudgetRub ?? -1) - (b.dailyBudgetRub ?? -1)) * dir;
        case 'expense':
          return (a.expenseRub - b.expenseRub) * dir;
        case 'orders':
          return (a.orders - b.orders) * dir;
        case 'drr':
          return ((a.drrPct ?? -1) - (b.drrPct ?? -1)) * dir;
      }
    };
    filtered.sort(cmp);
    return filtered;
  }, [rows, config.onlyActive, sort]);

  const widths = useMemo(
    () => ({
      campaign: autoColumnWidth(
        'Кампания',
        displayRows.map((r) => `${r.title ?? r.campaignId}\n${r.campaignId}`),
        { min: 160, max: 320 },
      ),
      type: autoColumnWidth(
        'Тип',
        displayRows.map((r) => `${r.paymentType ?? ''}${r.advObjectType ? ' · ' + r.advObjectType : ''}`),
        { min: 100, max: 180 },
      ),
      state: autoColumnWidth(
        'Статус',
        displayRows.map((r) => stateBadge(r.state).label),
        { min: 80, max: 140 },
      ),
      budget: autoColumnWidth(
        'Бюджет/день',
        displayRows.map((r) =>
          r.dailyBudgetRub ? Math.round(r.dailyBudgetRub).toLocaleString('ru-RU') + ' ₽' : '—',
        ),
        { min: 100, max: 150 },
      ),
      expense: autoColumnWidth(
        'Расход',
        displayRows.map((r) => Math.round(r.expenseRub).toLocaleString('ru-RU') + ' ₽'),
        { min: 90, max: 150 },
      ),
      orders: autoColumnWidth('Заказы', displayRows.map((r) => String(r.orders)), {
        min: 70,
        max: 110,
      }),
      drr: autoColumnWidth(
        'ДРР',
        displayRows.map((r) => (r.drrPct !== null ? r.drrPct.toFixed(1) + '%' : '—')),
        { min: 60, max: 100 },
      ),
    }),
    [displayRows],
  );

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
              <col style={{ width: `${widths.campaign}px` }} />
              <col style={{ width: `${widths.type}px` }} />
              <col style={{ width: `${widths.state}px` }} />
              <col style={{ width: `${widths.budget}px` }} />
              <col style={{ width: `${widths.expense}px` }} />
              <col style={{ width: `${widths.orders}px` }} />
              <col style={{ width: `${widths.drr}px` }} />
            </colgroup>
            <thead className="sticky top-0 bg-muted/60 backdrop-blur">
              <tr className="text-left text-muted-foreground">
                <SortableHeader sortKey="campaign" sort={sort} onClick={toggleSort}>
                  Кампания
                </SortableHeader>
                <SortableHeader sortKey="type" sort={sort} onClick={toggleSort}>
                  Тип
                </SortableHeader>
                <SortableHeader sortKey="state" sort={sort} onClick={toggleSort}>
                  Статус
                </SortableHeader>
                <SortableHeader sortKey="budget" sort={sort} onClick={toggleSort} align="right">
                  Бюджет/день
                </SortableHeader>
                <SortableHeader sortKey="expense" sort={sort} onClick={toggleSort} align="right">
                  Расход
                </SortableHeader>
                <SortableHeader sortKey="orders" sort={sort} onClick={toggleSort} align="right">
                  Заказы
                </SortableHeader>
                <SortableHeader sortKey="drr" sort={sort} onClick={toggleSort} align="right">
                  ДРР
                </SortableHeader>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {displayRows.map((c) => {
                const badge = stateBadge(c.state);
                const hasNoStats =
                  c.expenseRub === 0 && c.orders === 0 && !data.summary?.statsAreAccountWide;
                return (
                  <tr key={c.campaignId} className="hover:bg-accent/20">
                    <td className="px-2 py-1.5">
                      <div className="truncate font-medium" title={c.title ?? c.campaignId}>
                        {c.title ?? c.campaignId}
                      </div>
                      <div className="truncate font-mono text-[10px] text-muted-foreground">
                        {c.campaignId}
                      </div>
                    </td>
                    <td className="truncate px-2 py-1.5 text-[11px]" title={c.paymentType ?? '—'}>
                      {c.paymentType ?? '—'}
                      {c.advObjectType ? ` · ${c.advObjectType}` : ''}
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={'rounded-full px-1.5 py-0.5 text-[10px] ' + badge.cls}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {c.dailyBudgetRub
                        ? Math.round(c.dailyBudgetRub).toLocaleString('ru-RU') + ' ₽'
                        : '—'}
                    </td>
                    <td
                      className={
                        'px-2 py-1.5 text-right tabular-nums ' +
                        (hasNoStats ? 'text-muted-foreground italic' : '')
                      }
                      title={hasNoStats ? 'Нет данных perf-sync для этой кампании' : undefined}
                    >
                      {hasNoStats ? '—' : Math.round(c.expenseRub).toLocaleString('ru-RU') + ' ₽'}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{c.orders}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {c.drrPct !== null ? c.drrPct.toFixed(1) + '%' : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
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

function SettingsForm({ config, onChange }: BlockSettingsFormProps) {
  const parsed = parseConfig(config);
  function patch(updates: Partial<typeof parsed>) {
    onChange({ ...parsed, ...updates } as unknown as Record<string, unknown>);
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
            <span className="font-medium">Показывать только активные кампании</span>
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              Скрыть статусы «Пауза» и «Завершена» — оставить только RUNNING.
            </span>
          </span>
          <Switch
            checked={parsed.onlyActive}
            onCheckedChange={(on) => patch({ onlyActive: on })}
          />
        </label>
        <p className="text-[10px] text-muted-foreground">
          Период настраивается в шапке блока (PeriodPicker) — он синхронизирован
          с глобальным периодом страницы.
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
