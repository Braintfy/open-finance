// PURPOSE: Кнопка «Синхронизировать с Ozon» в header'е /marketplaces/ozon.
// v0.22.2: вместо собственного popover'а с чекбоксами теперь открывает
// универсальный `OzonSyncDialog` — единый UI для sync с поддержкой
// incremental backfill (диапазон дат), smart auto-preset (с последнего
// sync), всех 15 стейджей и force-перезаписи.
//
// v0.26.0: бейдж свежести данных (green/amber/red) + dispatch ozon-sync-completed
// после успешного sync → все Ozon-блоки на странице авторефрешатся.
//
// Поведение:
// - Если магазинов нет → ссылка «Подключить Ozon»
// - Если магазинов 1 → кнопка → диалог с этим магазином
// - Если магазинов >1 → select для выбора + кнопка → диалог с выбранным

'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CloudDownload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';
import { OzonSyncDialog } from './ozon-sync-dialog';

/** Возвращает читаемое время с момента lastSyncAt и CSS-классы для бейджа. */
function useSyncFreshness(lastSyncAt: string | null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (!lastSyncAt) return null;

  const diffMs = now - new Date(lastSyncAt).getTime();
  const diffMin = diffMs / 60_000;
  const diffH = diffMs / 3_600_000;
  const diffD = diffMs / 86_400_000;

  let label: string;
  if (diffMin < 60) label = `${Math.max(1, Math.round(diffMin))} мин`;
  else if (diffH < 24) label = `${Math.round(diffH)} ч`;
  else if (diffD < 2) label = `1 д`;
  else label = `${Math.round(diffD)} дн`;

  let cls: string;
  if (diffD <= 1) cls = 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300';
  else if (diffD <= 3) cls = 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';
  else cls = 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300';

  const full = new Date(lastSyncAt).toLocaleString('ru-RU');
  return { label, cls, full };
}

export function SyncAllButton() {
  const { accounts, loading: accountsLoading, reload: reloadAccounts } = useMarketplaceAccounts({
    marketplace: 'ozon',
  });
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!selectedAccountId && accounts.length > 0) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? accounts[0] ?? null;
  const freshness = useSyncFreshness(selectedAccount?.lastSyncAt ?? null);

  const handleSyncCompleted = useCallback(async () => {
    window.dispatchEvent(new CustomEvent('ozon-sync-completed'));
    await reloadAccounts();
  }, [reloadAccounts]);

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
    <div className="flex items-center gap-2">
      {freshness && (
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium ${freshness.cls}`}
          title={`Последняя синхронизация: ${freshness.full}`}
        >
          {freshness.label}
        </span>
      )}
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
        onClick={() => setDialogOpen(true)}
        disabled={!selectedAccountId}
        className="gap-1"
        title="Открыть диалог синхронизации с настройками диапазона и стейджей"
      >
        <CloudDownload className="h-3 w-3" />
        Синхронизировать
      </Button>

      <OzonSyncDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        accountId={selectedAccountId}
        defaultPreset="auto"
        onCompleted={handleSyncCompleted}
      />
    </div>
  );
}
