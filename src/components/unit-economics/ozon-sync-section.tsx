// PURPOSE: Shared компонент «Синхронизация Ozon» для блоков Аналитика/Динамика/KPI.
// Выделен из ozon-analytics-settings-form, чтобы не дублировать UI настроек sync
// между блоками. Содержит:
//  - чекбоксы стейджей (products/prices/stocks/orders/transactions + Performance API).
//  - стейдж `analyticsData` (Seller `/v1/analytics/data` — primary для аналитики).
//  - кнопку «Запустить синхронизацию» с polling статуса.
//  - pre-flight check для `analyticsData` (предупреждение если не выгружено).

'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';
import type { AccountPublic } from '@/lib/marketplaces/types';

/** Ключи стейджей синхронизации (соответствуют OzonSyncSettings). */
export type SyncStageKey =
  | 'products'
  | 'prices'
  | 'stocks'
  | 'orders'
  | 'transactions'
  | 'analyticsData'
  | 'perfCampaigns'
  | 'perfSkuStats'
  | 'perfCpoDaily'
  | 'perfPhrases';

type StageMeta = {
  key: SyncStageKey;
  label: string;
  /** Требует Performance API. Disabled если perf-креды не подключены. */
  perf?: boolean;
  /** Метка «РЕКОМЕНДУЕТСЯ» — критично для точности цифр. */
  recommended?: boolean;
  /** Tooltip-объяснение что даёт этот стейдж. */
  hint?: string;
};

const STAGE_OPTIONS: StageMeta[] = [
  {
    key: 'products',
    label: 'Каталог товаров',
    hint: 'Артикулы, названия, SKU, штрихкоды, изображения, габариты.',
  },
  {
    key: 'prices',
    label: 'Цены и комиссии',
    hint: 'Цены, комиссии FBO/FBS, marketing_price (с СПП).',
  },
  {
    key: 'stocks',
    label: 'Остатки',
    hint: 'Остатки FBO (Ozon) + FBS (свой склад) + crossborder.',
  },
  {
    key: 'orders',
    label: 'Заказы',
    hint: 'История заказов FBO/FBS — для FBO/FBS-разделения и legacy-аналитики.',
  },
  {
    key: 'transactions',
    label: 'Транзакции',
    hint: 'Финансовые операции (выплаты, удержания, реклама-эвристика).',
  },
  {
    key: 'analyticsData',
    label: 'Аналитика продаж (Seller API)',
    recommended: true,
    hint: 'Родной аналитический endpoint Ozon /v1/analytics/data. Без этого цифры расходятся с Seller-кабинетом на 20-60%.',
  },
  {
    key: 'perfCampaigns',
    label: 'Рекламные кампании',
    perf: true,
    hint: 'Список активных кампаний с типом продвижения (CPC/CPM/CPO).',
  },
  {
    key: 'perfSkuStats',
    label: 'Статистика рекламы по товарам',
    perf: true,
    recommended: true,
    hint: 'CPC/CPM расход per-SKU per-day. Без этого «Расход» и «ДРР» в таблице пустые.',
  },
  {
    key: 'perfCpoDaily',
    label: 'CPO рекламы (Оплата за заказ)',
    perf: true,
    hint: 'Дневной агрегат CPO по магазину (всё что не CPC/CPM).',
  },
  {
    key: 'perfPhrases',
    label: 'Поисковые фразы',
    perf: true,
    hint: 'Отчёт по поисковым фразам. Может быть недоступен у некоторых аккаунтов.',
  },
];

/** Дефолтный набор включённых стейджей при первом открытии. */
const DEFAULT_ENABLED_STAGES: Record<SyncStageKey, boolean> = {
  products: true,
  prices: true,
  stocks: true,
  orders: true,
  transactions: false,
  analyticsData: true,
  perfCampaigns: true,
  perfSkuStats: true,
  perfCpoDaily: true,
  perfPhrases: false,
};

export function OzonSyncSection({
  accountId,
  /** Если true — пре-flight предупреждение что analyticsData пустая. */
  showPreflightWarning = false,
  /** Префикс заголовка. По умолчанию «Синхронизация». */
  title = 'Синхронизация',
}: {
  accountId: string | null;
  showPreflightWarning?: boolean;
  title?: string;
}) {
  const { accounts } = useMarketplaceAccounts({ marketplace: 'ozon' });
  const account = accounts.find((a) => a.id === accountId);
  const [enabledStages, setEnabledStages] = useState<Record<SyncStageKey, boolean>>(
    () => ({ ...DEFAULT_ENABLED_STAGES }),
  );
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
      const stages = Object.keys(enabledStages)
        .filter((k) => enabledStages[k as SyncStageKey])
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
          {title}
        </span>
      </div>
      {!account ? (
        <div className="rounded border border-border/60 bg-muted/20 p-2 text-[11px] text-muted-foreground">
          Выберите магазин чтобы запустить синхронизацию.
        </div>
      ) : (
        <div className="space-y-2 rounded border border-border/60 bg-card p-2">
          {showPreflightWarning && (
            <div className="rounded border border-amber-400/50 bg-amber-50 p-2 text-[11px] dark:bg-amber-950/40">
              <div className="flex items-start gap-1.5 text-amber-800 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <div className="space-y-0.5">
                  <div className="font-medium">
                    Цифры считаются из postings (legacy).
                  </div>
                  <div className="text-amber-700 dark:text-amber-300">
                    Запустите стейдж <strong>«Аналитика продаж (Seller API)»</strong> —
                    без него цифры расходятся с кабинетом Ozon на 20-60% на коротких
                    окнах.
                  </div>
                </div>
              </div>
            </div>
          )}
          <SilentFailureBanner account={account} />
          <SyncSummaryGrid account={account} />
          <div className="text-[11px] text-muted-foreground">
            Выберите какие данные синхронизировать. Performance API стейджи работают
            только если у магазина подключены perf-креды.
            {!account.perfConnected && (
              <>
                {' '}
                <Link
                  href="/app/settings/integrations"
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
                  title={opt.hint}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 text-[12px] font-medium">
                      <span className="truncate">{opt.label}</span>
                      {opt.perf && (
                        <span className="rounded-full bg-violet-100 px-1.5 text-[9px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300">
                          Performance
                        </span>
                      )}
                      {opt.recommended && (
                        <span className="rounded-full bg-emerald-100 px-1.5 text-[9px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          Рекомендуется
                        </span>
                      )}
                    </div>
                    {opt.hint && (
                      <div className="mt-0.5 text-[10px] text-muted-foreground">
                        {opt.hint}
                      </div>
                    )}
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

/**
 * Подсказка-баннер, если в последнем sync хотя бы один стейдж завершился
 * `ok=true` но `itemsProcessed=0` при `itemsTotal>0` — это silent failure
 * (Ozon вернул отчёт, но parser ничего не записал). Показывает warnings из
 * `lastSyncSummary.stages.<stage>.warnings`.
 */
function SilentFailureBanner({ account }: { account: AccountPublic }) {
  const stages = account.lastSyncSummary?.stages ?? {};
  const silentlyFailed = Object.entries(stages).filter(
    ([, s]) =>
      s.ok === true &&
      (s.itemsTotal ?? 0) > 0 &&
      (s.itemsProcessed ?? 0) === 0,
  );
  if (silentlyFailed.length === 0) return null;
  return (
    <div className="rounded border border-rose-400/60 bg-rose-50 p-2 text-[11px] dark:bg-rose-950/40">
      <div className="flex items-start gap-1.5 text-rose-800 dark:text-rose-200">
        <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
        <div className="space-y-1">
          <div className="font-medium">
            Sync завершился, но не записал данные в БД ({silentlyFailed.length}{' '}
            стейдж{silentlyFailed.length === 1 ? '' : 'а'}).
          </div>
          <ul className="space-y-0.5">
            {silentlyFailed.map(([name, s]) => (
              <li key={name} className="text-rose-700 dark:text-rose-300">
                <strong>{name}</strong>: получено {s.itemsTotal} строк, записано 0.
                {s.warnings && s.warnings.length > 0 && (
                  <details className="ml-3 mt-0.5">
                    <summary className="cursor-pointer text-[10px] underline">
                      Подробнее ({s.warnings.length})
                    </summary>
                    <ul className="ml-3 mt-0.5 list-disc space-y-0.5 text-[10px]">
                      {s.warnings.slice(0, 5).map((w, i) => (
                        <li key={i} className="break-all">
                          {w}
                        </li>
                      ))}
                      {s.warnings.length > 5 && (
                        <li className="italic">
                          ... ещё {s.warnings.length - 5}
                        </li>
                      )}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/**
 * Компактная таблица «что записал последний sync». Для каждого стейджа из
 * lastSyncSummary показывает галочку + count записанных строк. Помогает
 * сразу увидеть «sync ok, но perfSkuStats записал 0».
 */
function SyncSummaryGrid({ account }: { account: AccountPublic }) {
  const stages = account.lastSyncSummary?.stages ?? {};
  const entries = Object.entries(stages);
  if (entries.length === 0) return null;
  return (
    <details className="rounded border border-border/40 bg-muted/10 text-[10px]">
      <summary className="cursor-pointer px-2 py-1 text-muted-foreground hover:bg-muted/30">
        Что записал последний sync ({entries.length} стейдж)
      </summary>
      <div className="px-2 py-1">
        <table className="w-full">
          <thead className="text-muted-foreground">
            <tr className="border-b border-border/40">
              <th className="py-0.5 text-left font-normal">Стейдж</th>
              <th className="py-0.5 text-right font-normal">Записано</th>
              <th className="py-0.5 text-right font-normal">Получено</th>
              <th className="py-0.5 text-right font-normal">Статус</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([name, s]) => {
              const processed = s.itemsProcessed ?? 0;
              const total = s.itemsTotal ?? processed;
              const silent = s.ok === true && total > 0 && processed === 0;
              return (
                <tr key={name} className="border-b border-border/20 last:border-0">
                  <td className="py-0.5">{name}</td>
                  <td className="py-0.5 text-right tabular-nums">{processed}</td>
                  <td className="py-0.5 text-right tabular-nums text-muted-foreground">
                    {total}
                  </td>
                  <td className="py-0.5 text-right">
                    {silent ? (
                      <span className="inline-flex items-center gap-1 text-rose-600">
                        <AlertTriangle className="h-2.5 w-2.5" /> silent
                      </span>
                    ) : s.ok ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <CheckCircle2 className="h-2.5 w-2.5" /> ok
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-rose-600">
                        <AlertCircle className="h-2.5 w-2.5" /> error
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}
