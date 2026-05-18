// PURPOSE: SettingsForm для блока unit.ozon-analytics. Магазин, период,
// видимые колонки, дефолтный фильтр + секция «Синхронизация» (запустить
// sync с выбранными стейджами).

'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  ShoppingBag,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';
import type { OzonAnalyticsBlockConfig, OzonAnalyticsPeriodPreset } from '@/lib/blocks/catalog/unit-ozon-analytics-types';
import { OZON_ANALYTICS_PERIOD_PRESETS } from '@/lib/blocks/catalog/unit-ozon-analytics-types';
import { COLUMN_DEFS, type TableColumnKey } from './ozon-analytics-table';
import {
  ANALYTICS_FILTERS,
  type AnalyticsFilterId,
} from './ozon-analytics-filters';

const COLUMN_GROUPS: Array<{
  title: string;
  keys: TableColumnKey[];
}> = [
  {
    title: 'Идентификаторы',
    keys: ['article', 'name', 'sku'],
  },
  {
    title: 'Цена и маржа',
    keys: ['priceRub', 'costRub', 'marginRub'],
  },
  {
    title: 'Продажи',
    keys: ['delivered', 'qtyDelivered', 'cancelled', 'returned', 'returnPct', 'revenueRub', 'buyoutPct', 'salesPerDay', 'salesShare'],
  },
  {
    title: 'Реклама',
    keys: ['adsRub', 'drrPct', 'views', 'clicks', 'ctr', 'cartAdds', 'cpc', 'cpm'],
  },
  {
    title: 'Склад',
    keys: ['stock', 'daysOfStock'],
  },
];

export function OzonAnalyticsSettingsForm({
  value,
  onChange,
}: {
  value: OzonAnalyticsBlockConfig;
  onChange: (next: OzonAnalyticsBlockConfig) => void;
}) {
  const { accounts, loading } = useMarketplaceAccounts({ marketplace: 'ozon' });

  // Авто-выбор первого аккаунта если сохранённый исчез / отсутствует.
  useEffect(() => {
    if (loading || accounts.length === 0) return;
    const stillExists = value.accountId && accounts.some((a) => a.id === value.accountId);
    if (!stillExists && accounts[0]) {
      onChange({ ...value, accountId: accounts[0].id });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, accounts.length]);

  function toggleColumn(key: TableColumnKey, on: boolean) {
    const next = on
      ? Array.from(new Set([...value.visibleColumns, key]))
      : value.visibleColumns.filter((k) => k !== key);
    onChange({ ...value, visibleColumns: next });
  }

  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <ShoppingBag className="h-3 w-3" />
            Магазин
          </span>
        </div>
        {loading ? (
          <div className="flex items-center gap-2 rounded border border-border/60 bg-muted/20 p-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка магазинов…
          </div>
        ) : accounts.length === 0 ? (
          <div className="space-y-2 rounded border border-amber-400/50 bg-amber-50 p-2 text-[12px] dark:bg-amber-950/40">
            <div className="flex items-center gap-1.5 text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              Ни один Ozon-магазин не подключён.
            </div>
            <Link
              href="/settings/integrations"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-primary hover:underline"
            >
              <LinkIcon className="h-3 w-3" />
              Подключить в Настройках → Интеграции
            </Link>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {accounts.map((a) => {
              const active = value.accountId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onChange({ ...value, accountId: a.id })}
                  className={
                    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors ' +
                    (active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border/60 bg-background hover:bg-accent')
                  }
                >
                  <span
                    className={
                      'h-2 w-2 rounded-full ' +
                      (a.status === 'active'
                        ? 'bg-emerald-500'
                        : a.status === 'error'
                          ? 'bg-red-500'
                          : 'bg-muted')
                    }
                  />
                  <span className="font-medium">{a.name}</span>
                  <span className="text-muted-foreground">· {a.clientId}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Дефолтный период
        </div>
        <div className="flex flex-wrap gap-1.5">
          {OZON_ANALYTICS_PERIOD_PRESETS.map((preset) => {
            const active = value.periodPreset === preset.id;
            return (
              <button
                key={preset.id}
                type="button"
                onClick={() =>
                  onChange({ ...value, periodPreset: preset.id as OzonAnalyticsPeriodPreset })
                }
                className={
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] transition-colors ' +
                  (active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 bg-background hover:bg-accent')
                }
              >
                {preset.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Пользователь сможет переключать период прямо в блоке.
        </p>
      </section>

      <section className="space-y-1.5">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Дефолтный фильтр
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ANALYTICS_FILTERS.map((f) => {
            const active = value.defaultFilter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => onChange({ ...value, defaultFilter: f.id as AnalyticsFilterId })}
                className={
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors ' +
                  (active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 bg-background hover:bg-accent')
                }
                title={f.hint}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </section>

      <SyncSection accountId={value.accountId} />

      <section className="space-y-1.5" id="visible-columns-section">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Видимые колонки
        </div>
        <div className="space-y-2">
          {COLUMN_GROUPS.map((g) => (
            <div key={g.title} className="rounded-md border border-border/60 bg-card">
              <div className="border-b border-border/40 px-2 py-1">
                <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.title}
                </Label>
              </div>
              <div className="divide-y divide-border/40">
                {g.keys.map((key) => {
                  const col = COLUMN_DEFS.find((c) => c.key === key);
                  if (!col) return null;
                  const enabled = value.visibleColumns.includes(key);
                  return (
                    <div key={key} className="flex items-center gap-2 px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-medium">{col.label}</div>
                        {col.hint && (
                          <div className="text-[11px] text-muted-foreground">{col.hint}</div>
                        )}
                      </div>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(on) => toggleColumn(key, on)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

type StageKey =
  | 'products'
  | 'prices'
  | 'stocks'
  | 'orders'
  | 'transactions'
  | 'perfCampaigns'
  | 'perfSkuStats'
  | 'perfPhrases';

const STAGE_OPTIONS: Array<{ key: StageKey; label: string; perf?: boolean }> = [
  { key: 'products', label: 'Каталог товаров' },
  { key: 'prices', label: 'Цены и комиссии' },
  { key: 'stocks', label: 'Остатки' },
  { key: 'orders', label: 'Заказы' },
  { key: 'transactions', label: 'Транзакции' },
  { key: 'perfCampaigns', label: 'Рекламные кампании', perf: true },
  { key: 'perfSkuStats', label: 'Статистика рекламы по товарам', perf: true },
  { key: 'perfPhrases', label: 'Поисковые фразы', perf: true },
];

function SyncSection({ accountId }: { accountId: string | null }) {
  const { accounts } = useMarketplaceAccounts({ marketplace: 'ozon' });
  const account = accounts.find((a) => a.id === accountId);
  const [enabledStages, setEnabledStages] = useState<Record<StageKey, boolean>>(() => ({
    products: true,
    prices: true,
    stocks: true,
    orders: true,
    transactions: false,
    perfCampaigns: true,
    perfSkuStats: true,
    perfPhrases: false,
  }));
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function runSync() {
    if (!accountId) {
      setErrorMessage('Сначала выберите магазин');
      return;
    }
    setRunning(true);
    setMessage(null);
    setErrorMessage(null);
    try {
      // Только включённые стейджи. Поле `stages` будет применено как override.
      const stages = Object.keys(enabledStages)
        .filter((k) => enabledStages[k as StageKey])
        .reduce<Record<string, boolean>>((acc, k) => {
          acc[k] = true;
          return acc;
        }, {});
      const res = await fetch(`/api/marketplaces/accounts/${accountId}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'full', stages }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage('Синхронизация запущена. Прогресс — на странице Интеграции.');
      } else {
        setErrorMessage(data.error ?? 'Не удалось запустить sync');
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : 'Network error');
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <Zap className="h-3 w-3" />
          Синхронизация
        </span>
      </div>
      {!account ? (
        <div className="rounded border border-border/60 bg-muted/20 p-2 text-[11px] text-muted-foreground">
          Выберите магазин чтобы запустить синхронизацию.
        </div>
      ) : (
        <div className="space-y-2 rounded border border-border/60 bg-card p-2">
          <div className="text-[11px] text-muted-foreground">
            Выберите какие данные синхронизировать. Performance API стейджи
            работают только если у магазина подключены perf-креды.
            {!account.perfConnected && (
              <>
                {' '}
                <Link
                  href="/settings/integrations"
                  className="text-primary hover:underline"
                >
                  Подключить Performance API →
                </Link>
              </>
            )}
          </div>
          <div className="divide-y divide-border/40">
            {STAGE_OPTIONS.map((opt) => {
              const disabled = opt.perf && !account.perfConnected;
              return (
                <div
                  key={opt.key}
                  className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium">
                      {opt.label}
                      {opt.perf && (
                        <span className="ml-1 rounded-full bg-violet-100 px-1.5 text-[9px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                          Performance
                        </span>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={enabledStages[opt.key] && !disabled}
                    disabled={disabled}
                    onCheckedChange={(on) =>
                      setEnabledStages({ ...enabledStages, [opt.key]: on })
                    }
                  />
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2">
            <Button size="sm" variant="default" onClick={runSync} disabled={running}>
              {running ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Запустить синхронизацию
            </Button>
            {account.lastSyncAt && (
              <span className="text-[10px] text-muted-foreground">
                Последний sync: {new Date(account.lastSyncAt).toLocaleString('ru-RU')}
              </span>
            )}
          </div>
          {message && (
            <div className="rounded bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              {message}
            </div>
          )}
          {errorMessage && (
            <div className="rounded bg-rose-50 px-2 py-1 text-[11px] text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              {errorMessage}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
