// PURPOSE: Блок «Ozon · Кампании» — таблица кампаний с расходом и заказами.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { Megaphone, AlertCircle, Info, RefreshCw } from 'lucide-react';
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

function RenderOzonCampaigns({ instance }: BlockRenderProps) {
  const config = useMemo(() => parseConfig(instance.config), [instance.config]);
  const [period, setPeriod] = useState<PeriodValue>({
    preset: config.periodPreset as PeriodPreset,
    customFrom: config.customFrom,
    customTo: config.customTo,
  });
  const [data, setData] = useState<OzonCampaignsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    totalExpenseRub: summary.expenseRub,
    totalOrders: summary.orders,
    totalOrdersRub: summary.ordersRub,
    avgDrrPct: summary.drrPct,
    campaignsCount: data?.rows.length ?? 0,
    activeCampaignsCount: (data?.rows ?? []).filter((r) => r.state?.includes('RUNNING')).length,
  });

  // Авторасчёт ширин таблицы.
  const rows = data?.rows ?? [];
  const widths = useMemo(
    () => ({
      campaign: autoColumnWidth(
        'Кампания',
        rows.map((r) => `${r.title ?? r.campaignId}\n${r.campaignId}`),
        { min: 160, max: 320 },
      ),
      type: autoColumnWidth(
        'Тип',
        rows.map((r) => `${r.paymentType ?? ''}${r.advObjectType ? ' · ' + r.advObjectType : ''}`),
        { min: 100, max: 180 },
      ),
      state: autoColumnWidth(
        'Статус',
        rows.map((r) => stateBadge(r.state).label),
        { min: 80, max: 140 },
      ),
      budget: autoColumnWidth(
        'Бюджет/день',
        rows.map((r) =>
          r.dailyBudgetRub ? Math.round(r.dailyBudgetRub).toLocaleString('ru-RU') + ' ₽' : '—',
        ),
        { min: 100, max: 150 },
      ),
      expense: autoColumnWidth(
        'Расход',
        rows.map((r) => Math.round(r.expenseRub).toLocaleString('ru-RU') + ' ₽'),
        { min: 90, max: 150 },
      ),
      orders: autoColumnWidth('Заказы', rows.map((r) => String(r.orders)), {
        min: 70,
        max: 110,
      }),
      drr: autoColumnWidth(
        'ДРР',
        rows.map((r) => (r.drrPct !== null ? r.drrPct.toFixed(1) + '%' : '—')),
        { min: 60, max: 100 },
      ),
    }),
    [rows],
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
            : currentAccount.perfStatus === 'error'
              ? 'perf-error'
              : data && data.rows.length === 0
                ? 'no-campaigns'
                : null;

  return (
    <Card className="flex h-full flex-col overflow-hidden p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/40 px-3 py-2">
        <PeriodPicker value={period} onChange={setPeriod} compact />
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
                <th className="px-2 py-1.5 font-medium">Кампания</th>
                <th className="px-2 py-1.5 font-medium">Тип</th>
                <th className="px-2 py-1.5 font-medium">Статус</th>
                <th className="px-2 py-1.5 text-right font-medium">Бюджет/день</th>
                <th className="px-2 py-1.5 text-right font-medium">Расход</th>
                <th className="px-2 py-1.5 text-right font-medium">Заказы</th>
                <th className="px-2 py-1.5 text-right font-medium">ДРР</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {data.rows.map((c) => {
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
