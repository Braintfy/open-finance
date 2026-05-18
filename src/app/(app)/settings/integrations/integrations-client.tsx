// PURPOSE: Клиентский UI интеграций маркетплейсов.
// - Список аккаунтов (Ozon)
// - Создание/удаление/правка
// - Тогглы «что синхронизировать»
// - Тест подключения, ручная синхронизация, история job'ов
//
// Premium-gate: tenant.plan ∈ {pro, business, enterprise} → можно добавить
// несколько магазинов. Иначе кнопка disabled с tooltip.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  RefreshCcw,
  Trash2,
  Check,
  AlertTriangle,
  Loader2,
  ShoppingBag,
  ChevronDown,
  ChevronRight,
  Save,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DEFAULT_OZON_SYNC_SETTINGS,
  isPremiumPlan,
  OZON_FULL_STAGES,
  type OzonStageKind,
  type OzonSyncSettings,
} from '@/lib/marketplaces/types';
import { OzonKeyHelp } from '@/components/integrations/ozon-key-help';

type AccountPublic = {
  id: string;
  marketplace: 'ozon' | 'yandex' | 'wb';
  name: string;
  clientId: string;
  apiKeyMasked: string;
  /** Performance API подключён (есть и client_id, и secret). */
  perfConnected: boolean;
  perfClientId: string | null;
  perfSecretMasked: string | null;
  perfStatus: string | null;
  perfLastSyncAt: string | null;
  perfLastSyncError: string | null;
  status: 'active' | 'error' | 'disabled';
  syncSettings: OzonSyncSettings;
  companyInfo: Record<string, unknown>;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  lastSyncSummary: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

type Job = {
  id: string;
  kind: string;
  status: 'pending' | 'running' | 'success' | 'partial' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  itemsProcessed: number;
  itemsTotal: number;
  stages: Record<string, {
    status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
    itemsProcessed?: number;
    itemsTotal?: number;
    durationMs?: number;
    error?: string;
  }>;
  errors: Array<{ stage?: string; message: string; at: string }>;
  createdAt: string;
  updatedAt?: string;
};

const STAGE_LABELS: Record<OzonStageKind, { title: string; hint: string }> = {
  products: {
    title: 'Каталог товаров',
    hint: 'Название, штрихкод, габариты, изображения',
  },
  prices: {
    title: 'Цены и комиссии',
    hint: 'Текущая цена, цена с СПП, комиссии FBO/FBS',
  },
  stocks: {
    title: 'Остатки',
    hint: 'FBO, FBS и по складам продавца',
  },
  orders: {
    title: 'Заказы',
    hint: 'Заказы FBO и FBS за окно (для salesPerMonth)',
  },
  realization: {
    title: 'Реализация',
    hint: 'Помесячный отчёт о реализации (реальные комиссии)',
  },
  transactions: {
    title: 'Транзакции',
    hint: 'Детальные финансовые операции (для аналитики)',
  },
  perfCampaigns: {
    title: 'Рекламные кампании (Performance API)',
    hint: 'Список кампаний, бюджеты, статусы',
  },
  perfSkuStats: {
    title: 'Статистика рекламы по товарам (Performance API)',
    hint: 'Показы, клики, заказы, расход, CTR/CPC/CPO',
  },
  perfPhrases: {
    title: 'Поисковые фразы (Performance API)',
    hint: 'Расход и заказы по поисковым запросам',
  },
  turnover: {
    title: 'Оборачиваемость',
    hint: 'Дни оборачиваемости и индекс IDC',
  },
};

export function IntegrationsClient({
  initialAccounts,
  tenantPlan,
}: {
  initialAccounts: AccountPublic[];
  tenantPlan: string;
}) {
  const [accounts, setAccounts] = useState<AccountPublic[]>(initialAccounts);
  const [showCreate, setShowCreate] = useState(false);

  const isPremium = isPremiumPlan(tenantPlan);
  const hasOzonAccount = accounts.some((a) => a.marketplace === 'ozon');
  const canAddOzon = isPremium || !hasOzonAccount;

  const refreshAccounts = useCallback(async () => {
    try {
      const res = await fetch('/api/marketplaces/accounts');
      const data = await res.json();
      if (data.ok) setAccounts(data.accounts);
    } catch {
      // ignore
    }
  }, []);

  return (
    <div className="mx-auto max-w-[900px] space-y-4">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            Интеграции маркетплейсов
          </h1>
          <p className="text-xs text-muted-foreground">
            Подключите Seller API магазинов для синхронизации цен, остатков и комиссий.
            Ключ хранится в зашифрованном виде (AES-256-GCM).
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setShowCreate(true)}
          disabled={!canAddOzon}
          title={
            !canAddOzon
              ? 'Добавление нескольких магазинов доступно в тарифе Pro и выше'
              : undefined
          }
        >
          <Plus /> Добавить магазин
        </Button>
      </div>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Ozon Seller
          </div>
          {!isPremium && (
            <span className="text-[10px] text-muted-foreground">
              План «{tenantPlan}» · 1 магазин (Pro+ для нескольких)
            </span>
          )}
        </div>

        <div className="mb-3">
          <OzonKeyHelp defaultOpen={accounts.length === 0} />
        </div>

        {accounts.length === 0 ? (
          <Card className="flex flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <ShoppingBag className="h-8 w-8 text-muted-foreground/40" />
            <div>
              Ни один магазин ещё не подключён.
              <br />
              Введите Client-Id и Api-Key из ЛК Ozon (Настройки → Seller API).
            </div>
            <Button size="sm" onClick={() => setShowCreate(true)} className="mt-2">
              <Plus /> Подключить Ozon
            </Button>
          </Card>
        ) : (
          <div className="space-y-3">
            {accounts.map((a) => (
              <AccountCard
                key={a.id}
                account={a}
                onChange={refreshAccounts}
              />
            ))}
          </div>
        )}
      </section>

      <Alert className="text-xs">
        <AlertDescription>
          Read-only ключа достаточно — мы только читаем данные. После
          подключения нажмите «Тест подключения», затем «Синхронизировать сейчас».
          Полная синхронизация большого магазина может занять несколько минут.
        </AlertDescription>
      </Alert>

      {showCreate && (
        <CreateAccountDialog
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            refreshAccounts();
          }}
        />
      )}
    </div>
  );
}

function AccountCard({
  account,
  onChange,
}: {
  account: AccountPublic;
  onChange: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [settings, setSettings] = useState<OzonSyncSettings>({
    ...DEFAULT_OZON_SYNC_SETTINGS,
    ...account.syncSettings,
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [savedSettingsAt, setSavedSettingsAt] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [history, setHistory] = useState<Job[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showEditKey, setShowEditKey] = useState(false);
  const [showEditPerf, setShowEditPerf] = useState(false);
  const [testingPerf, setTestingPerf] = useState(false);
  const [perfTestResult, setPerfTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Apply server's syncSettings if account refreshes.
  useEffect(() => {
    setSettings({ ...DEFAULT_OZON_SYNC_SETTINGS, ...account.syncSettings });
  }, [account.syncSettings]);

  // Poll active job
  useEffect(() => {
    if (!activeJobId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/marketplaces/accounts/${account.id}/jobs/${activeJobId}`);
        const data = await res.json();
        if (cancelled) return;
        if (data.ok) {
          setActiveJob(data.job);
          if (['success', 'partial', 'error'].includes(data.job.status)) {
            setSyncing(false);
            setActiveJobId(null);
            onChange();
            loadHistory();
          }
        }
      } catch {
        // ignore single tick
      }
    };
    tick();
    const interval = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId]);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/marketplaces/accounts/${account.id}/jobs`);
      const data = await res.json();
      if (data.ok) setHistory(data.jobs);
      setHistoryLoaded(true);
    } catch {
      // ignore
    }
  }, [account.id]);

  useEffect(() => {
    if (expanded && !historyLoaded) loadHistory();
  }, [expanded, historyLoaded, loadHistory]);

  const dirtySettings = useMemo(() => {
    return JSON.stringify(settings) !== JSON.stringify({
      ...DEFAULT_OZON_SYNC_SETTINGS,
      ...account.syncSettings,
    });
  }, [settings, account.syncSettings]);

  async function saveSettings() {
    setSavingSettings(true);
    try {
      const res = await fetch(`/api/marketplaces/accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncSettings: settings }),
      });
      const data = await res.json();
      if (data.ok) {
        setSavedSettingsAt(new Date().toLocaleTimeString('ru-RU'));
        onChange();
      }
    } finally {
      setSavingSettings(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/marketplaces/accounts/${account.id}/test`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.ok) {
        const companyName =
          (data.companyInfo as Record<string, unknown> | undefined)?.name ??
          'компания';
        setTestResult({ ok: true, message: `Подключение работает: ${companyName}` });
        onChange();
      } else {
        setTestResult({ ok: false, message: data.error ?? 'Не удалось подключиться' });
      }
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : 'Network error',
      });
    } finally {
      setTesting(false);
    }
  }

  async function startSync() {
    setSyncing(true);
    setActiveJob(null);
    try {
      const res = await fetch(`/api/marketplaces/accounts/${account.id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json();
      if (data.ok) {
        setActiveJobId(data.jobId);
      } else {
        setSyncing(false);
        setTestResult({ ok: false, message: data.error ?? 'Sync failed' });
      }
    } catch (e) {
      setSyncing(false);
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : 'Network error',
      });
    }
  }

  async function removeAccount() {
    await fetch(`/api/marketplaces/accounts/${account.id}`, { method: 'DELETE' });
    onChange();
  }

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-3 py-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 items-center gap-2 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <StatusChip status={account.status} />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{account.name}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              Client-Id {account.clientId} ·{' '}
              {account.lastSyncAt
                ? `Последняя синхронизация ${new Date(account.lastSyncAt).toLocaleString('ru-RU')}`
                : 'Ещё не синхронизировано'}
            </div>
          </div>
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={testConnection}
            disabled={testing}
          >
            {testing ? <Loader2 className="animate-spin" /> : <Check />}
            Тест
          </Button>
          <Button size="sm" onClick={startSync} disabled={syncing}>
            {syncing ? <Loader2 className="animate-spin" /> : <RefreshCcw />}
            {syncing ? 'Синхронизация…' : 'Синхронизировать'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-600 hover:text-red-700"
            onClick={() => setShowDelete(true)}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {testResult && (
        <div
          className={
            'flex items-start gap-2 border-b border-border/60 px-3 py-1.5 text-[11px] ' +
            (testResult.ok
              ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
              : 'bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200')
          }
        >
          {testResult.ok ? (
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          )}
          <span>{testResult.message}</span>
        </div>
      )}

      {activeJob && (
        <div className="border-b border-border/60 bg-muted/10 px-3 py-2 text-[11px]">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-semibold">
              Синхронизация {syncing ? '(идёт)' : ''} ·{' '}
              {jobStatusLabel(activeJob.status)}
            </span>
            <span className="text-muted-foreground">
              Обработано: {activeJob.itemsProcessed}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2 md:grid-cols-3">
            {(Object.keys(activeJob.stages) as OzonStageKind[]).map((stage) => {
              const s = activeJob.stages[stage];
              return (
                <div key={stage} className="flex items-center gap-1.5">
                  <StageIcon status={s.status} />
                  <span className="truncate">{STAGE_LABELS[stage]?.title ?? stage}</span>
                  {s.itemsProcessed !== undefined && s.status !== 'skipped' && (
                    <span className="text-muted-foreground">
                      ({s.itemsProcessed})
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {activeJob.errors.length > 0 && (
            <JobErrorsBlock errors={activeJob.errors} />
          )}
        </div>
      )}

      {expanded && (
        <div className="space-y-4 p-3">
          <section>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Авторизация · Seller API
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <Label className="text-[11px] text-muted-foreground">Client-Id</Label>
                <Input value={account.clientId} readOnly className="h-8 font-mono text-xs" />
              </div>
              <div>
                <Label className="text-[11px] text-muted-foreground">Api-Key</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={account.apiKeyMasked}
                    readOnly
                    className="h-8 font-mono text-xs"
                  />
                  <Button size="sm" variant="outline" onClick={() => setShowEditKey(true)}>
                    Изменить
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Авторизация · Performance API (реклама)
              </div>
              {account.perfConnected ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <Check className="h-2.5 w-2.5" />
                  Подключено
                </span>
              ) : (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                  Не подключено
                </span>
              )}
            </div>
            {account.perfConnected ? (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <Label className="text-[11px] text-muted-foreground">Client ID</Label>
                  <Input
                    value={account.perfClientId ?? ''}
                    readOnly
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground">Client Secret</Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={account.perfSecretMasked ?? '••••••••'}
                      readOnly
                      className="h-8 font-mono text-xs"
                    />
                    <Button size="sm" variant="outline" onClick={() => setShowEditPerf(true)}>
                      Изменить
                    </Button>
                  </div>
                </div>
                <div className="sm:col-span-2 flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={testingPerf}
                    onClick={async () => {
                      setTestingPerf(true);
                      setPerfTestResult(null);
                      try {
                        const res = await fetch(
                          `/api/marketplaces/accounts/${account.id}/test-perf`,
                          { method: 'POST' },
                        );
                        const data = await res.json();
                        setPerfTestResult({
                          ok: Boolean(data.ok),
                          message: data.ok
                            ? `Токен получен. TTL ~${data.expiresIn ?? '?'} сек.`
                            : data.error ?? 'Тест не удался',
                        });
                      } catch (e) {
                        setPerfTestResult({
                          ok: false,
                          message: e instanceof Error ? e.message : 'Network error',
                        });
                      } finally {
                        setTestingPerf(false);
                      }
                    }}
                  >
                    {testingPerf && <Loader2 className="animate-spin" />}
                    Тест Performance
                  </Button>
                  {account.perfLastSyncAt && (
                    <span className="text-[10px] text-muted-foreground">
                      Последний perf-sync: {new Date(account.perfLastSyncAt).toLocaleString('ru-RU')}
                    </span>
                  )}
                  {perfTestResult && (
                    <span
                      className={
                        'text-[10px] ' +
                        (perfTestResult.ok ? 'text-emerald-700' : 'text-red-700')
                      }
                    >
                      {perfTestResult.message}
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-md border border-dashed border-border/60 p-3">
                <div className="text-[11px] text-muted-foreground">
                  Подключите Performance API, чтобы получить рекламную аналитику
                  (CTR/CPC/CPO, поисковые фразы, кампании).
                </div>
                <Button size="sm" variant="outline" onClick={() => setShowEditPerf(true)}>
                  Подключить
                </Button>
              </div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Что синхронизировать
              </div>
              <div className="flex items-center gap-1.5">
                {savedSettingsAt && (
                  <span className="text-[10px] text-muted-foreground">
                    Сохранено в {savedSettingsAt}
                  </span>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={saveSettings}
                  disabled={!dirtySettings || savingSettings}
                >
                  <Save /> {savingSettings ? 'Сохраняем…' : 'Сохранить'}
                </Button>
              </div>
            </div>
            <div className="divide-y divide-border/60 overflow-hidden rounded-lg border bg-card">
              {OZON_FULL_STAGES.map((stage) => {
                const enabled = (settings as Record<string, unknown>)[stage] !== false;
                const meta = STAGE_LABELS[stage];
                return (
                  <div
                    key={stage}
                    className="flex items-center gap-3 px-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{meta.title}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {meta.hint}
                      </div>
                    </div>
                    {stage === 'orders' && (
                      <WindowInput
                        value={settings.ordersWindowDays ?? 30}
                        onChange={(v) => setSettings({ ...settings, ordersWindowDays: v })}
                        disabled={!enabled}
                      />
                    )}
                    {stage === 'transactions' && (
                      <WindowInput
                        value={settings.transactionsWindowDays ?? 30}
                        onChange={(v) =>
                          setSettings({ ...settings, transactionsWindowDays: v })
                        }
                        disabled={!enabled}
                      />
                    )}
                    <Switch
                      checked={enabled}
                      onCheckedChange={(v) =>
                        setSettings({ ...settings, [stage]: v })
                      }
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 text-[10px] text-muted-foreground">
              Авто-синхронизация по расписанию будет добавлена в следующей
              итерации (запланировано).
            </div>
          </section>

          <section>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              История синхронизаций
            </div>
            {history.length === 0 ? (
              <div className="rounded-lg border bg-muted/20 p-3 text-[11px] text-muted-foreground">
                Пока пусто — запустите первую синхронизацию.
              </div>
            ) : (
              <div className="divide-y divide-border/40 overflow-hidden rounded-lg border bg-card text-[11px]">
                {history.slice(0, 5).map((j) => (
                  <details key={j.id} className="px-3 py-2">
                    <summary className="flex cursor-pointer items-center gap-2">
                      <StatusChip status={mapJobStatus(j.status)} />
                      <span className="font-medium">
                        {j.kind === 'full' ? 'Полная' : (STAGE_LABELS[j.kind as OzonStageKind]?.title ?? j.kind)}
                      </span>
                      <span className="text-muted-foreground">
                        · {jobStatusLabel(j.status)} · {j.itemsProcessed} элементов
                      </span>
                      <span className="ml-auto text-muted-foreground">
                        {j.startedAt
                          ? new Date(j.startedAt).toLocaleString('ru-RU')
                          : new Date(j.createdAt).toLocaleString('ru-RU')}
                      </span>
                    </summary>
                    <div className="mt-1.5 grid grid-cols-1 gap-x-3 gap-y-0.5 pl-5 sm:grid-cols-2 md:grid-cols-3">
                      {(Object.keys(j.stages) as OzonStageKind[]).map((stage) => {
                        const s = j.stages[stage];
                        return (
                          <div key={stage} className="flex items-center gap-1.5">
                            <StageIcon status={s.status} />
                            <span className="truncate">{STAGE_LABELS[stage]?.title ?? stage}</span>
                            {s.itemsProcessed !== undefined &&
                              s.status !== 'skipped' && (
                                <span className="text-muted-foreground">
                                  ({s.itemsProcessed})
                                </span>
                              )}
                            {s.error && (
                              <span
                                className="truncate text-amber-700 dark:text-amber-400"
                                title={s.error}
                              >
                                · {truncate(s.error, 40)}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {j.errors.length > 0 && (
                      <div className="mt-1.5 pl-5">
                        <JobErrorsBlock errors={j.errors} />
                      </div>
                    )}
                  </details>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {showDelete && (
        <AlertDialog open onOpenChange={(o) => !o && setShowDelete(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить магазин «{account.name}»?</AlertDialogTitle>
              <AlertDialogDescription>
                Будет удалена связь с Ozon. Уже синхронизированные товары в
                «Юнит-экономике» останутся, но потеряют привязку к источнику.
                Действие не отменить.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await removeAccount();
                  setShowDelete(false);
                }}
                className="bg-red-600 hover:bg-red-700"
              >
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {showEditKey && (
        <EditApiKeyDialog
          accountId={account.id}
          onClose={() => setShowEditKey(false)}
          onSaved={() => {
            setShowEditKey(false);
            onChange();
          }}
        />
      )}

      {showEditPerf && (
        <EditPerfApiDialog
          accountId={account.id}
          currentClientId={account.perfClientId}
          onClose={() => setShowEditPerf(false)}
          onSaved={() => {
            setShowEditPerf(false);
            onChange();
          }}
        />
      )}
    </Card>
  );
}

function WindowInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        min={1}
        max={365}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
        className="h-7 w-14 text-right text-[11px] tabular-nums"
      />
      <span className="text-[11px] text-muted-foreground">дн.</span>
    </div>
  );
}

function StageIcon({
  status,
}: {
  status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
}) {
  if (status === 'success')
    return <Check className="h-3 w-3 text-emerald-600" />;
  if (status === 'error')
    return <AlertTriangle className="h-3 w-3 text-red-600" />;
  if (status === 'running')
    return <Loader2 className="h-3 w-3 animate-spin text-blue-600" />;
  if (status === 'skipped')
    return <span className="inline-block h-3 w-3 rounded-full bg-muted" />;
  return <span className="inline-block h-3 w-3 rounded-full border border-muted-foreground/40" />;
}

function StatusChip({
  status,
}: {
  status: 'active' | 'error' | 'disabled' | 'success' | 'partial' | 'pending' | 'running';
}) {
  const map: Record<string, { label: string; cls: string }> = {
    active: { label: 'Активен', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
    success: { label: 'Готово', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
    partial: { label: 'Частично', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
    error: { label: 'Ошибка', cls: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
    disabled: { label: 'Отключён', cls: 'bg-muted text-muted-foreground' },
    pending: { label: 'Ожидание', cls: 'bg-muted text-muted-foreground' },
    running: { label: 'Идёт', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  };
  const m = map[status] ?? { label: status, cls: 'bg-muted text-muted-foreground' };
  return (
    <span
      className={
        'inline-flex h-5 items-center rounded-full px-2 text-[10px] font-medium ' +
        m.cls
      }
    >
      {m.label}
    </span>
  );
}

function truncate(s: string, len: number): string {
  if (!s) return '';
  return s.length > len ? s.slice(0, len - 1) + '…' : s;
}

/**
 * Развёрнутый список ошибок job'a с stage/path/message. Schema-mismatch
 * получает info-подсказку, потому что после lenient-mode такие ошибки
 * по сути предупреждения — sync должен был всё равно завершиться.
 */
function JobErrorsBlock({
  errors,
}: {
  errors: Array<{ stage?: string; message: string; at: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!errors || errors.length === 0) return null;
  const visible = expanded ? errors : errors.slice(0, 3);
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      <div className="mb-0.5 flex items-center justify-between">
        <span className="font-semibold">Ошибки ({errors.length})</span>
        {errors.length > 3 && (
          <button
            type="button"
            className="text-[10px] underline hover:no-underline"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? 'свернуть' : `показать все ${errors.length}`}
          </button>
        )}
      </div>
      <ul className="space-y-0.5">
        {visible.map((e, i) => {
          const isValidation = /не прошёл валидацию|schema mismatch/i.test(e.message);
          return (
            <li key={i} className="flex items-start gap-1">
              {e.stage && (
                <span className="shrink-0 rounded bg-amber-200/60 px-1 font-mono text-[10px] text-amber-900 dark:bg-amber-800/60 dark:text-amber-100">
                  {e.stage}
                </span>
              )}
              <span className="min-w-0 flex-1 break-words">{e.message}</span>
              {isValidation && (
                <span
                  className="shrink-0 cursor-help text-[10px] underline decoration-dotted"
                  title="После v0.17.1 lenient-режим: такие ошибки логируются как warning и не должны прерывать sync. Если sync всё равно упал — проверьте сетевые ошибки и rate-limit."
                >
                  ?
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function jobStatusLabel(s: Job['status']): string {
  if (s === 'pending') return 'Ожидание';
  if (s === 'running') return 'Идёт';
  if (s === 'success') return 'Готово';
  if (s === 'partial') return 'Частично';
  return 'Ошибка';
}

function mapJobStatus(s: Job['status']): 'success' | 'partial' | 'error' | 'pending' | 'running' {
  return s;
}

function CreateAccountDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('Главный магазин');
  const [clientId, setClientId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showPerf, setShowPerf] = useState(false);
  const [perfClientId, setPerfClientId] = useState('');
  const [perfSecret, setPerfSecret] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        marketplace: 'ozon',
        name,
        clientId: clientId.trim(),
        apiKey: apiKey.trim(),
      };
      if (showPerf && perfClientId.trim() && perfSecret.trim()) {
        body.perfClientId = perfClientId.trim();
        body.perfClientSecret = perfSecret.trim();
      }
      const res = await fetch('/api/marketplaces/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        onCreated();
      } else {
        setError(data.error ?? 'Не удалось подключить магазин');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Подключить магазин Ozon</DialogTitle>
          <DialogDescription>
            Ключи берутся в ЛК Ozon: Настройки → Seller API → создать ключ
            (роль <b>Admin read only</b>, 238 методов).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <OzonKeyHelp variant="compact" />
          <div>
            <Label>Название магазина</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Главный магазин"
            />
          </div>
          <div>
            <Label>Client-Id (Seller)</Label>
            <Input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder="12345"
              className="font-mono"
            />
          </div>
          <div>
            <Label>Api-Key (Seller)</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="0123abcd-..."
              className="font-mono"
            />
          </div>

          <div className="rounded-md border border-border/60 bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm font-medium">Performance API</div>
                <div className="text-[11px] text-muted-foreground">
                  Опционально — для рекламной аналитики (CTR/CPC/CPO/расход).
                </div>
              </div>
              <Switch checked={showPerf} onCheckedChange={setShowPerf} />
            </div>
            {showPerf && (
              <div className="mt-3 space-y-2.5">
                <a
                  href="https://seller.ozon.ru/app/settings/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  Создать Performance API ключ →
                </a>
                <div>
                  <Label className="text-[11px]">Client ID (Performance)</Label>
                  <Input
                    value={perfClientId}
                    onChange={(e) => setPerfClientId(e.target.value)}
                    placeholder="12345-67890"
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <div>
                  <Label className="text-[11px]">Client Secret (Performance)</Label>
                  <Input
                    type="password"
                    value={perfSecret}
                    onChange={(e) => setPerfSecret(e.target.value)}
                    placeholder="••••••••••••"
                    className="h-8 font-mono text-xs"
                  />
                </div>
                <div className="text-[10px] text-muted-foreground">
                  Креды можно добавить позже. Без них блоки аналитики
                  работают, но без рекламной части.
                </div>
              </div>
            )}
          </div>

          {error && (
            <Alert className="text-xs">
              <AlertDescription className="text-red-700 dark:text-red-300">
                {error}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={!clientId || !apiKey || apiKey.length < 8 || submitting}
          >
            {submitting && <Loader2 className="animate-spin" />}
            Подключить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditApiKeyDialog({
  accountId,
  onClose,
  onSaved,
}: {
  accountId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/marketplaces/accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (data.ok) onSaved();
      else setError(data.error ?? 'Не удалось сохранить ключ');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Изменить Api-Key</DialogTitle>
          <DialogDescription>
            Старый ключ будет заменён. После сохранения запустите «Тест подключения».
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Новый Api-Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono"
            />
          </div>
          {error && (
            <Alert className="text-xs">
              <AlertDescription className="text-red-700 dark:text-red-300">
                {error}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={apiKey.length < 8 || saving}>
            {saving && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Диалог для редактирования Performance API кредов отдельно от Seller.
 * Можно: задать новый client_id+secret, заменить secret, отключить совсем.
 */
function EditPerfApiDialog({
  accountId,
  currentClientId,
  onClose,
  onSaved,
}: {
  accountId: string;
  currentClientId: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [perfClientId, setPerfClientId] = useState(currentClientId ?? '');
  const [perfSecret, setPerfSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/marketplaces/accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          perfClientId: perfClientId.trim(),
          perfClientSecret: perfSecret.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) onSaved();
      else setError(data.error ?? 'Не удалось сохранить креды');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    if (!confirm('Отключить Performance API? Все рекламные данные останутся в БД до следующего sync.'))
      return;
    setSaving(true);
    try {
      const res = await fetch(`/api/marketplaces/accounts/${accountId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ perfClientId: null, perfClientSecret: null }),
      });
      const data = await res.json();
      if (data.ok) onSaved();
      else setError(data.error ?? 'Не удалось отключить');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Network error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Performance API</DialogTitle>
          <DialogDescription>
            Креды для рекламной аналитики Ozon (CTR/CPC/CPO/расход).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <a
            href="https://seller.ozon.ru/app/settings/api-keys"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
          >
            Создать Performance API ключ в ЛК Ozon →
          </a>
          <div>
            <Label className="text-[11px]">Client ID</Label>
            <Input
              value={perfClientId}
              onChange={(e) => setPerfClientId(e.target.value)}
              placeholder="12345-67890"
              className="h-8 font-mono text-xs"
            />
          </div>
          <div>
            <Label className="text-[11px]">Client Secret (новый)</Label>
            <Input
              type="password"
              value={perfSecret}
              onChange={(e) => setPerfSecret(e.target.value)}
              placeholder="••••••••••••"
              className="h-8 font-mono text-xs"
            />
          </div>
          {error && (
            <Alert className="text-xs">
              <AlertDescription className="text-red-700 dark:text-red-300">
                {error}
              </AlertDescription>
            </Alert>
          )}
        </div>
        <DialogFooter className="flex items-center justify-between gap-2">
          <Button variant="outline" onClick={disconnect} disabled={saving || !currentClientId}>
            Отключить
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Отмена
            </Button>
            <Button
              onClick={submit}
              disabled={!perfClientId.trim() || perfSecret.length < 8 || saving}
            >
              {saving && <Loader2 className="animate-spin" />}
              Сохранить
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
