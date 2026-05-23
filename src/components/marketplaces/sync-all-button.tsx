// PURPOSE: Кнопка «Синхронизировать с Ozon» в header'е /marketplaces/ozon.
// v0.22.2: вместо собственного popover'а с чекбоксами теперь открывает
// универсальный `OzonSyncDialog` — единый UI для sync с поддержкой
// incremental backfill (диапазон дат), smart auto-preset (с последнего
// sync), всех 15 стейджей и force-перезаписи.
//
// Поведение:
// - Если магазинов нет → ссылка «Подключить Ozon»
// - Если магазинов 1 → кнопка → диалог с этим магазином
// - Если магазинов >1 → select для выбора + кнопка → диалог с выбранным

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CloudDownload, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';
import { OzonSyncDialog } from './ozon-sync-dialog';

export function SyncAllButton() {
  const { accounts, loading: accountsLoading } = useMarketplaceAccounts({
    marketplace: 'ozon',
  });
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (!selectedAccountId && accounts.length > 0) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts, selectedAccountId]);

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
      />
    </div>
  );
}
