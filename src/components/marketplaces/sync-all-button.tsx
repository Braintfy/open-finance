// PURPOSE: Кнопка «Синхронизировать с Ozon» с popover-инструкцией и
// чекбоксами стейджей. Запускает /api/marketplaces/accounts/{id}/sync,
// затем GlobalSyncIndicator подхватывает прогресс.
//
// Используется в header `/marketplaces/ozon` над блоками.

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Info, Loader2, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';
import { OZON_FULL_STAGES, type OzonStageKind } from '@/lib/marketplaces/types';

const STAGE_LABELS: Record<OzonStageKind, string> = {
  products: 'Каталог товаров',
  prices: 'Цены и комиссии',
  stocks: 'Остатки',
  orders: 'Заказы',
  realization: 'Реализация',
  transactions: 'Транзакции',
  perfCampaigns: 'Рекламные кампании',
  perfSkuStats: 'Реклама CPC/CPM (per-SKU)',
  perfCpoDaily: 'Реклама CPO (Оплата за заказ)',
  perfPhrases: 'Поисковые фразы',
  perfExpenseDaily: 'Расход рекламы (эталон)',
  turnover: 'Оборачиваемость',
  analyticsData: 'Аналитика продаж (Seller API)',
  clusters: 'Кластеры (география)',
  warehouseStocks: 'Остатки по складам',
};

export function SyncAllButton() {
  const { accounts, loading: accountsLoading } = useMarketplaceAccounts({
    marketplace: 'ozon',
  });
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [stages, setStages] = useState<Record<OzonStageKind, boolean>>(() =>
    Object.fromEntries(OZON_FULL_STAGES.map((s) => [s, true])) as Record<
      OzonStageKind,
      boolean
    >,
  );
  const [submitting, setSubmitting] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedAccountId && accounts.length > 0) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (!hint) return;
    const id = setTimeout(() => setHint(null), 8_000);
    return () => clearTimeout(id);
  }, [hint]);

  const currentAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;
  const enabledStages = Object.values(stages).filter(Boolean).length;

  async function handleStart() {
    if (!selectedAccountId) return;
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/marketplaces/accounts/${selectedAccountId}/sync`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: 'full', stages }),
        },
      );
      const data = await res.json();
      if (data.ok) {
        setOpen(false);
        setHint(
          `Синхронизация запущена. Это может занять от минут до часов — прогресс виден в индикаторе внизу справа.`,
        );
      } else {
        setHint(data.error ?? 'Не удалось запустить синхронизацию');
      }
    } catch (e) {
      setHint(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  if (accountsLoading) {
    return (
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Магазины…
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <Link
        href="/settings/integrations"
        className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary hover:bg-primary/10"
      >
        Подключить Ozon
      </Link>
    );
  }

  return (
    <div className="relative flex items-center gap-2" ref={popoverRef}>
      {accounts.length > 1 && (
        <select
          value={selectedAccountId ?? ''}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          className="rounded-md border border-border/60 bg-background px-2 py-1 text-[11px]"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      )}
      <Button
        size="sm"
        variant="outline"
        onClick={() => setOpen((v) => !v)}
        disabled={!selectedAccountId}
        className="gap-1"
      >
        <RefreshCcw className="h-3 w-3" />
        Синхронизировать
        <ChevronDown className="h-3 w-3 opacity-60" />
      </Button>

      {open && currentAccount && (
        <div className="absolute right-0 top-full z-40 mt-1 w-80 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
          <div className="mb-2 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-[11px] text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <div>
              Запустит выбранные стейджи синхронизации для{' '}
              <span className="font-medium">{currentAccount.name}</span>.
              Время — от 2 минут (маленький магазин) до 2 часов (&gt;10k
              товаров + Premium Plus). Можно закрыть страницу — sync
              продолжится в фоне.
            </div>
          </div>

          <div className="mb-2 max-h-56 space-y-1 overflow-auto pr-1">
            {OZON_FULL_STAGES.map((stage) => (
              <label
                key={stage}
                className="flex items-center gap-2 text-[11px] hover:bg-accent rounded px-1 py-0.5 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={stages[stage]}
                  onChange={(e) =>
                    setStages((prev) => ({ ...prev, [stage]: e.target.checked }))
                  }
                  className="h-3 w-3"
                />
                <span>{STAGE_LABELS[stage]}</span>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-muted-foreground">
              Выбрано: {enabledStages} / {OZON_FULL_STAGES.length}
            </span>
            <Button
              size="sm"
              onClick={handleStart}
              disabled={submitting || enabledStages === 0}
              className="gap-1"
            >
              {submitting ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCcw className="h-3 w-3" />
              )}
              Запустить
            </Button>
          </div>
        </div>
      )}

      {hint && (
        <div className="absolute right-0 top-full z-30 mt-1 w-80 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] text-emerald-900 shadow dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {hint}
        </div>
      )}
    </div>
  );
}
