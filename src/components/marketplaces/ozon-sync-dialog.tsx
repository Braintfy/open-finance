// PURPOSE: Универсальная модалка синхронизации Ozon-аккаунта (v0.22.1).
// Поддерживает incremental backfill (диапазон дат), выбор стейджей по группам,
// force-перезапись, polling job-status с прогрессом.
//
// Используется в toolbar блоков unit.ozon-* для inplace-sync без ухода в Settings.
// Пример: «Догрузить вчерашний день» одним кликом.

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  Loader2,
  Sparkles,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { useMarketplaceAccounts } from '@/lib/marketplaces/use-accounts';
import type { AccountPublic } from '@/lib/marketplaces/types';
import {
  describePreset,
  moscowToday,
  PRESET_LABELS,
  resolvePresetRange,
  shiftIsoDate,
  type DateRangePreset,
} from './ozon-sync-presets';

// ---------------------------------------------------------------------------
// Stages metadata
// ---------------------------------------------------------------------------

type StageKey =
  | 'products'
  | 'prices'
  | 'stocks'
  | 'analyticsData'
  | 'orders'
  | 'transactions'
  | 'realization'
  | 'turnover'
  | 'clusters'
  | 'warehouseStocks'
  | 'perfCampaigns'
  | 'perfSkuStats'
  | 'perfCpoDaily'
  | 'perfExpenseDaily'
  | 'perfPhrases';

type StageMeta = {
  key: StageKey;
  label: string;
  /** Зависит от диапазона дат. catalog/snapshot стейджи — false. */
  dateAware: boolean;
  /** Performance API стейдж. */
  perf?: boolean;
  recommended?: boolean;
  hint?: string;
};

const STAGES_CATALOG: StageMeta[] = [
  {
    key: 'products',
    label: 'Каталог товаров',
    dateAware: false,
    hint: 'Артикулы, названия, SKU, штрихкоды, габариты. Не зависит от даты.',
  },
  {
    key: 'prices',
    label: 'Цены и комиссии',
    dateAware: false,
    hint: 'Текущие цены и комиссии FBO/FBS. Не зависит от даты.',
  },
  {
    key: 'stocks',
    label: 'Остатки',
    dateAware: false,
    hint: 'Текущие остатки FBO + FBS. Не зависит от даты.',
  },
  {
    key: 'turnover',
    label: 'Оборачиваемость',
    dateAware: false,
    hint: 'Метаданные оборачиваемости. Не зависит от даты.',
  },
  {
    key: 'clusters',
    label: 'Кластеры регионов',
    dateAware: false,
    hint: 'Справочник кластеров. Не зависит от даты.',
  },
  {
    key: 'warehouseStocks',
    label: 'Остатки по складам',
    dateAware: false,
    hint: 'Снимок остатков по складам Ozon. Не зависит от даты.',
  },
];

const STAGES_SALES: StageMeta[] = [
  {
    key: 'analyticsData',
    label: 'Аналитика продаж (Seller API)',
    dateAware: true,
    recommended: true,
    hint: 'Родной /v1/analytics/data. Primary для блока Аналитики.',
  },
  {
    key: 'orders',
    label: 'Заказы FBO/FBS',
    dateAware: true,
    hint: 'История postings — для FBO/FBS-разделения и fallback-аналитики.',
  },
  {
    key: 'transactions',
    label: 'Транзакции',
    dateAware: true,
    hint: 'Финансовые операции (выплаты, удержания).',
  },
  {
    key: 'realization',
    label: 'Реализация (закрытые месяцы)',
    dateAware: false,
    hint: 'Работает только по календарным месяцам — диапазон дат игнорируется.',
  },
];

const STAGES_ADS: StageMeta[] = [
  {
    key: 'perfCampaigns',
    label: 'Рекламные кампании',
    dateAware: false,
    perf: true,
    hint: 'Список активных кампаний с типом продвижения. Не зависит от даты.',
  },
  {
    key: 'perfSkuStats',
    label: 'Статистика рекламы по товарам',
    dateAware: true,
    perf: true,
    recommended: true,
    hint: 'CPC/CPM расход per-SKU per-day. Без этого «Расход» и «ДРР» пустые.',
  },
  {
    key: 'perfCpoDaily',
    label: 'CPO рекламы',
    dateAware: true,
    perf: true,
    hint: 'Дневной агрегат CPO (Оплата за заказ).',
  },
  {
    key: 'perfExpenseDaily',
    label: 'Дневной расход',
    dateAware: true,
    perf: true,
    hint: 'Performance /statistics/expense. Источник totals «Реклама».',
  },
  {
    key: 'perfPhrases',
    label: 'Поисковые фразы',
    dateAware: true,
    perf: true,
    hint: 'Отчёт поисковых фраз. Может быть недоступен у некоторых аккаунтов.',
  },
];

const ALL_STAGES = [...STAGES_CATALOG, ...STAGES_SALES, ...STAGES_ADS];

/** Стейджи, которые автоматически включаются в режиме «Догрузить день/диапазон». */
const DATE_AWARE_DEFAULT: StageKey[] = [
  'analyticsData',
  'orders',
  'perfExpenseDaily',
  'perfSkuStats',
  'perfCpoDaily',
];

// ---------------------------------------------------------------------------
// Date helpers переехали в `./ozon-sync-presets.ts` (pure-функции, тестируемые).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Job polling
// ---------------------------------------------------------------------------

type JobStatus = 'pending' | 'running' | 'success' | 'partial' | 'error';
type Job = {
  id: string;
  status: JobStatus;
  itemsProcessed: number;
  itemsTotal: number;
  stages: Record<string, { status: string; itemsProcessed?: number }>;
  errors: Array<{ message: string; stage?: string }>;
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export type OzonSyncDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Аккаунт по умолчанию (если задан — disabled-выбор). */
  accountId: string | null;
  /** Дефолтный preset диапазона. По умолчанию `yesterday`. */
  defaultPreset?: DateRangePreset;
  /** Callback при успешном завершении (для refetch блока). */
  onCompleted?: (args: { accountId: string; status: JobStatus }) => void | Promise<void>;
};

export function OzonSyncDialog({
  open,
  onOpenChange,
  accountId: pinnedAccountId,
  defaultPreset = 'yesterday',
  onCompleted,
}: OzonSyncDialogProps) {
  const { accounts, loading: accountsLoading } = useMarketplaceAccounts({ marketplace: 'ozon' });

  const account = useMemo<AccountPublic | null>(() => {
    if (!pinnedAccountId) return accounts[0] ?? null;
    return accounts.find((a) => a.id === pinnedAccountId) ?? null;
  }, [accounts, pinnedAccountId]);

  const [preset, setPreset] = useState<DateRangePreset>(defaultPreset);
  const [customFrom, setCustomFrom] = useState<string>(() => shiftIsoDate(moscowToday(), -1));
  const [customTo, setCustomTo] = useState<string>(() => shiftIsoDate(moscowToday(), -1));
  const [force, setForce] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  // Stage selection — defaults в зависимости от preset.
  const [enabled, setEnabled] = useState<Record<StageKey, boolean>>(() => initialStages(defaultPreset));

  // Reset когда меняется preset (auto-toggle date-aware vs all).
  useEffect(() => {
    setEnabled(initialStages(preset));
  }, [preset]);

  // Reset когда модалка закрывается.
  useEffect(() => {
    if (!open) {
      setActiveJobId(null);
      setProgress(0);
      setError(null);
      setSuccess(null);
      setSubmitting(false);
    }
  }, [open]);

  // Sync job
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const resolvedRange = resolvePresetRange(preset, account?.lastSyncAt ?? null);
  const effectiveFrom = preset === 'custom' ? customFrom : (resolvedRange?.from ?? null);
  const effectiveTo = preset === 'custom' ? customTo : (resolvedRange?.to ?? null);
  const sendDateOverride = preset !== 'window';
  const dateRangeInvalid = sendDateOverride && (!effectiveFrom || !effectiveTo || effectiveFrom > effectiveTo);

  const selectedStages = (Object.keys(enabled) as StageKey[]).filter((k) => enabled[k]);
  const selectedCount = selectedStages.length;

  const runSync = useCallback(async () => {
    if (!account) {
      setError('Магазин не выбран');
      return;
    }
    if (selectedCount === 0) {
      setError('Выберите хотя бы один стейдж');
      return;
    }
    if (dateRangeInvalid) {
      setError('Некорректный диапазон дат');
      return;
    }
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    setProgress(0);
    setProgressStage(null);
    try {
      const stages = selectedStages.reduce<Record<string, boolean>>((acc, s) => {
        acc[s] = true;
        return acc;
      }, {});
      const body: Record<string, unknown> = { stages, kind: 'full' };
      if (sendDateOverride && effectiveFrom && effectiveTo) {
        body.fromDate = effectiveFrom;
        body.toDate = effectiveTo;
      }
      if (force) body.force = true;

      const res = await fetch(`/api/marketplaces/accounts/${account.id}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!mountedRef.current) return;
      if (!data.ok) {
        setError(data.error ?? 'Не удалось запустить синхронизацию');
        setSubmitting(false);
        return;
      }
      setActiveJobId(data.jobId);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Network error');
      setSubmitting(false);
    }
  }, [
    account,
    selectedStages,
    selectedCount,
    sendDateOverride,
    effectiveFrom,
    effectiveTo,
    dateRangeInvalid,
    force,
  ]);

  // Poll active job
  useEffect(() => {
    if (!activeJobId || !account) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/marketplaces/accounts/${account.id}/jobs/${activeJobId}`);
        const data = await res.json();
        if (cancelled || !mountedRef.current) return;
        if (!data.ok) return;
        const job: Job = data.job;
        setProgress(job.itemsProcessed);
        // Найти текущий running-стейдж
        const runningEntry = Object.entries(job.stages ?? {}).find(([, s]) => s.status === 'running');
        setProgressStage(runningEntry ? runningEntry[0] : null);
        if (['success', 'partial', 'error'].includes(job.status)) {
          setActiveJobId(null);
          setSubmitting(false);
          if (job.status === 'error') {
            setError(job.errors?.[0]?.message ?? 'Синхронизация завершилась с ошибкой');
          } else {
            const label = job.status === 'partial' ? 'Готово с предупреждениями' : 'Готово';
            setSuccess(`${label} · ${job.itemsProcessed} элементов`);
          }
          if (onCompleted) {
            await onCompleted({ accountId: account.id, status: job.status });
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
  }, [activeJobId, account, onCompleted]);

  const lastSync = account?.lastSyncAt
    ? new Date(account.lastSyncAt).toLocaleString('ru-RU')
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CloudDownload className="h-4 w-4" />
            Синхронизация Ozon
            {account && <span className="text-muted-foreground">· {account.name}</span>}
          </DialogTitle>
          <DialogDescription>
            Загрузка данных из Ozon Seller API и Performance API. Поддерживает
            «догрузить вчерашний день» одним кликом.
          </DialogDescription>
        </DialogHeader>

        {accountsLoading ? (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Загрузка магазинов…
          </div>
        ) : !account ? (
          <div className="rounded border border-amber-400/60 bg-amber-50 p-3 text-[12px] text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            Ozon-магазин не подключён. Откройте Настройки → Интеграции.
          </div>
        ) : (
          <div className="space-y-3">
            {/* Section 1 — Диапазон дат */}
            <section className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays className="h-3 w-3" />
                  Диапазон дат
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(PRESET_LABELS) as DateRangePreset[]).map((p) => {
                  const tooltipText =
                    p === 'auto'
                      ? describePreset('auto', account?.lastSyncAt ?? null)
                      : PRESET_LABELS[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPreset(p)}
                      title={tooltipText}
                      className={
                        'rounded-md border px-2 py-1 text-[11px] transition ' +
                        (preset === p
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border/60 text-muted-foreground hover:border-border hover:text-foreground')
                      }
                    >
                      {p === 'auto' ? (
                        <span className="inline-flex items-center gap-1">
                          <Sparkles className="h-3 w-3" />
                          {PRESET_LABELS[p]}
                        </span>
                      ) : (
                        PRESET_LABELS[p]
                      )}
                    </button>
                  );
                })}
              </div>
              {preset === 'custom' && (
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    type="date"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    max={moscowToday()}
                    className="h-7 text-[11px]"
                  />
                  <span className="text-muted-foreground">→</span>
                  <Input
                    type="date"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    max={moscowToday()}
                    className="h-7 text-[11px]"
                  />
                </div>
              )}
              <div className="text-[10px] text-muted-foreground">
                {preset === 'window'
                  ? 'Используется sliding-window из настроек аккаунта (90 дней для аналитики, 30 для рекламы).'
                  : preset === 'auto'
                    ? describePreset('auto', account?.lastSyncAt ?? null) +
                      (effectiveFrom && effectiveTo
                        ? '. Date-aware стейджи загрузят только это окно.'
                        : '')
                    : effectiveFrom && effectiveTo
                      ? `Диапазон: ${effectiveFrom} → ${effectiveTo} (MSC). Date-aware стейджи загрузят только это окно.`
                      : 'Выберите даты'}
              </div>
            </section>

            {/* Section 2 — Стейджи (collapsible) */}
            <section className="rounded border border-border/60 bg-card/50">
              <button
                type="button"
                onClick={() => setStagesOpen(!stagesOpen)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] font-medium hover:bg-accent/40"
              >
                {stagesOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <Zap className="h-3 w-3" />
                <span>
                  Стейджи: <strong>{selectedCount}</strong> из {ALL_STAGES.length}
                </span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {selectedCount === 0 ? 'выберите ≥ 1' : 'настроить'}
                </span>
              </button>
              {stagesOpen && (
                <div className="space-y-3 border-t border-border/40 px-2 py-2">
                  <StageGroup
                    title="Каталог · snapshot (не зависит от даты)"
                    stages={STAGES_CATALOG}
                    enabled={enabled}
                    setEnabled={setEnabled}
                    perfConnected={account.perfConnected}
                  />
                  <StageGroup
                    title="Продажи / финансы"
                    stages={STAGES_SALES}
                    enabled={enabled}
                    setEnabled={setEnabled}
                    perfConnected={account.perfConnected}
                  />
                  <StageGroup
                    title="Реклама (Performance API)"
                    stages={STAGES_ADS}
                    enabled={enabled}
                    setEnabled={setEnabled}
                    perfConnected={account.perfConnected}
                  />
                  {!account.perfConnected && (
                    <div className="rounded border border-amber-400/40 bg-amber-50 p-2 text-[10px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                      Performance API не подключён — perf-стейджи пропустятся.
                      Подключите в Настройки → Интеграции для полной аналитики.
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Section 3 — Опции (collapsible) */}
            <section className="rounded border border-border/60 bg-card/50">
              <button
                type="button"
                onClick={() => setOptionsOpen(!optionsOpen)}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11px] font-medium hover:bg-accent/40"
              >
                {optionsOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span>Опции</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {force ? 'force' : 'по умолчанию'}
                </span>
              </button>
              {optionsOpen && (
                <div className="space-y-2 border-t border-border/40 px-2 py-2">
                  <label className="flex cursor-pointer items-start gap-2 text-[11px]">
                    <Switch checked={force} onCheckedChange={setForce} />
                    <span className="flex-1">
                      <span className="font-medium">Принудительно перезаписать</span>
                      <span className="block text-[10px] text-muted-foreground">
                        Daily-таблицы (аналитика, perf) и так перезаписываются в окне.
                        Флаг — задел под будущую оптимизацию skip-if-already-loaded
                        для orders/transactions.
                      </span>
                    </span>
                  </label>
                </div>
              )}
            </section>

            {/* Status line */}
            <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
              <span>{lastSync ? `Последний sync: ${lastSync}` : 'Ещё не синхронизировано'}</span>
              {submitting && progressStage && (
                <span className="inline-flex items-center gap-1 text-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {progressStage} · {progress}
                </span>
              )}
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded border border-rose-400/60 bg-rose-50 p-2 text-[11px] text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{error}</span>
              </div>
            )}
            {success && (
              <div className="flex items-start gap-2 rounded border border-emerald-400/60 bg-emerald-50 p-2 text-[11px] text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{success}</span>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            {success ? 'Закрыть' : 'Отмена'}
          </Button>
          <Button
            size="sm"
            onClick={runSync}
            disabled={!account || submitting || dateRangeInvalid || selectedCount === 0}
          >
            {submitting ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Синхронизация…
              </>
            ) : success ? (
              <>
                <Check className="h-3 w-3" />
                Запустить ещё раз
              </>
            ) : (
              <>
                <CloudDownload className="h-3 w-3" />
                Запустить
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initialStages(preset: DateRangePreset): Record<StageKey, boolean> {
  const out = ALL_STAGES.reduce<Record<StageKey, boolean>>((acc, s) => {
    acc[s.key] = false;
    return acc;
  }, {} as Record<StageKey, boolean>);
  if (preset === 'window') {
    // Full sync — все стейджи включены.
    for (const s of ALL_STAGES) out[s.key] = true;
  } else {
    // Incremental (auto / yesterday / last3 / last7 / last30 / custom) —
    // только date-aware (analyticsData/orders/perf*). Каталог-стейджи
    // (products/prices/stocks) — opt-in, обычно их не нужно перегружать
    // при «догрузить вчера».
    for (const k of DATE_AWARE_DEFAULT) out[k] = true;
  }
  return out;
}

function StageGroup({
  title,
  stages,
  enabled,
  setEnabled,
  perfConnected,
}: {
  title: string;
  stages: StageMeta[];
  enabled: Record<StageKey, boolean>;
  setEnabled: (n: Record<StageKey, boolean>) => void;
  perfConnected: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="divide-y divide-border/40">
        {stages.map((opt) => {
          const disabled = opt.perf && !perfConnected;
          return (
            <label
              key={opt.key}
              className="flex cursor-pointer items-center gap-2 py-1.5 first:pt-0 last:pb-0"
              title={opt.hint}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px] font-medium">
                  <span className="truncate">{opt.label}</span>
                  {!opt.dateAware && (
                    <span className="rounded-full bg-slate-100 px-1.5 text-[9px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      без даты
                    </span>
                  )}
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
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{opt.hint}</div>
                )}
              </div>
              <Switch
                checked={enabled[opt.key] && !disabled}
                disabled={disabled}
                onCheckedChange={(on) => setEnabled({ ...enabled, [opt.key]: on })}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

