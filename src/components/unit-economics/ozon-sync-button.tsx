// PURPOSE: Кнопка «Загрузить из Ozon» для unit-блоков.
// Логика:
// 1. Если активных Ozon-аккаунтов 0 — disabled с tooltip "Подключите магазин".
// 2. Если 1 — простой клик → запуск sync.
// 3. Если >1 (Pro+) — DropdownMenu для выбора магазина.
// 4. Poll job каждые 1.5s, по завершении вызывает onCompleted().
//
// Прогресс рендерится inline-текстом (без блокировки UI).

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Cloud, Loader2, AlertTriangle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';

type Job = {
  id: string;
  status: 'pending' | 'running' | 'success' | 'partial' | 'error';
  itemsProcessed: number;
  itemsTotal: number;
  stages: Record<string, { status: string }>;
  errors: Array<{ message: string }>;
};

export function OzonSyncButton({
  onCompleted,
  size = 'sm',
  className,
  labelIdle = 'Загрузить из Ozon',
  labelRunning = 'Синхронизация…',
  accountId: pinnedAccountIdRaw,
}: {
  onCompleted: (args: { accountId: string; status: Job['status'] }) => void | Promise<void>;
  size?: 'sm' | 'default' | 'lg';
  className?: string;
  labelIdle?: string;
  labelRunning?: string;
  /**
   * Если задан — синхронизация работает только с этим аккаунтом, DropdownMenu
   * прячется. Если аккаунт не существует (удалён) — fallback к первому
   * доступному, либо empty-state.
   */
  accountId?: string | null;
}) {
  const { accounts, loading } = useMarketplaceAccounts({ marketplace: 'ozon' });
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [completedMessage, setCompletedMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const activeAccounts = accounts.filter((a) => a.status !== 'disabled');
  // Резолвим pinned accountId: если он существует — используем, иначе fallback
  const pinnedAccount = pinnedAccountIdRaw
    ? activeAccounts.find((a) => a.id === pinnedAccountIdRaw) ?? null
    : null;
  const pinnedAccountMissing = Boolean(pinnedAccountIdRaw) && !pinnedAccount;

  const startSync = useCallback(
    async (accountId: string) => {
      setSyncingAccountId(accountId);
      setActiveJobId(null);
      setProgress(0);
      setCompletedMessage(null);
      setErrorMessage(null);
      try {
        const res = await fetch(`/api/marketplaces/accounts/${accountId}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        const data = await res.json();
        if (!mountedRef.current) return;
        if (data.ok) {
          setActiveJobId(data.jobId);
        } else {
          setErrorMessage(data.error ?? 'Ошибка запуска синхронизации');
          setSyncingAccountId(null);
        }
      } catch (e) {
        if (!mountedRef.current) return;
        setErrorMessage(e instanceof Error ? e.message : 'Network error');
        setSyncingAccountId(null);
      }
    },
    [],
  );

  // Poll active job
  useEffect(() => {
    if (!activeJobId || !syncingAccountId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(
          `/api/marketplaces/accounts/${syncingAccountId}/jobs/${activeJobId}`,
        );
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) {
          const job: Job = data.job;
          setProgress(job.itemsProcessed);
          if (['success', 'partial', 'error'].includes(job.status)) {
            setSyncingAccountId(null);
            setActiveJobId(null);
            if (job.status === 'error') {
              setErrorMessage(job.errors?.[0]?.message ?? 'Синхронизация завершилась с ошибкой');
            } else {
              setCompletedMessage(
                job.status === 'partial'
                  ? `Готово с предупреждениями · ${job.itemsProcessed} элементов`
                  : `Готово · ${job.itemsProcessed} элементов`,
              );
              setTimeout(() => setCompletedMessage(null), 5000);
            }
            await onCompleted({
              accountId: syncingAccountId!,
              status: job.status,
            });
          }
        }
      } catch {
        // ignore
      }
    };
    tick();
    pollRef.current = window.setInterval(tick, 1500);
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [activeJobId, syncingAccountId, onCompleted]);

  const isRunning = Boolean(syncingAccountId);

  if (loading) {
    return (
      <Button size={size} variant="outline" disabled className={className}>
        <Loader2 className="animate-spin" /> {labelIdle}
      </Button>
    );
  }

  if (activeAccounts.length === 0) {
    return (
      <Link
        href="/app/settings/integrations"
        className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
        title="Подключить Ozon Seller API в настройках"
      >
        <Cloud className="h-3 w-3" /> Подключить Ozon
      </Link>
    );
  }

  // Если задан pinned accountId — синхронизируем только его, dropdown не нужен.
  // Если pinned потерялся — рендерим обычное поведение (single/multi-account
  // fallback), плюс показываем warning под кнопкой.
  if (pinnedAccount) {
    return (
      <div className="flex flex-col items-end gap-0.5">
        <Button
          size={size}
          variant="outline"
          disabled={isRunning}
          onClick={() => startSync(pinnedAccount.id)}
          className={className}
          title={`Магазин: ${pinnedAccount.name}`}
        >
          {isRunning ? <Loader2 className="animate-spin" /> : <Cloud />}
          {isRunning ? `${labelRunning} (${progress})` : labelIdle}
        </Button>
        {completedMessage && (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
            <Check className="h-3 w-3" /> {completedMessage}
          </span>
        )}
        {errorMessage && (
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> {errorMessage}
          </span>
        )}
      </div>
    );
  }

  if (activeAccounts.length === 1) {
    const account = activeAccounts[0];
    return (
      <div className="flex flex-col items-end gap-0.5">
        <Button
          size={size}
          variant="outline"
          disabled={isRunning}
          onClick={() => startSync(account.id)}
          className={className}
          title={`Магазин: ${account.name}`}
        >
          {isRunning ? <Loader2 className="animate-spin" /> : <Cloud />}
          {isRunning ? `${labelRunning} (${progress})` : labelIdle}
        </Button>
        {pinnedAccountMissing && (
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> Сохранённый магазин удалён —
            используем {account.name}
          </span>
        )}
        {completedMessage && (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
            <Check className="h-3 w-3" /> {completedMessage}
          </span>
        )}
        {errorMessage && (
          <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-3 w-3" /> {errorMessage}
          </span>
        )}
      </div>
    );
  }

  // Multi-account (Pro+)
  return (
    <div className="flex flex-col items-end gap-0.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size={size} variant="outline" disabled={isRunning} className={className}>
            {isRunning ? <Loader2 className="animate-spin" /> : <Cloud />}
            {isRunning ? `${labelRunning} (${progress})` : labelIdle}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Выбрать магазин</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {activeAccounts.map((a) => (
            <DropdownMenuItem key={a.id} onClick={() => startSync(a.id)}>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{a.name}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  Client-Id {a.clientId}
                </div>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {completedMessage && (
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 dark:text-emerald-400">
          <Check className="h-3 w-3" /> {completedMessage}
        </span>
      )}
      {errorMessage && (
        <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3" /> {errorMessage}
        </span>
      )}
    </div>
  );
}
