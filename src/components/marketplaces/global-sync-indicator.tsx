// PURPOSE: Глобальный sticky-индикатор активных sync-jobs. Поллит
// /api/marketplaces/jobs/active каждые 5 секунд; показывает мини-карточку
// в правом нижнем углу с прогрессом текущего стейджа.
//
// Видим на всех страницах приложения после mount'а в (app)/layout.tsx —
// пользователь запускает sync с /settings/integrations или из header
// /marketplaces/ozon и видит прогресс не уходя со страницы дашборда.

'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronRight, Loader2, X } from 'lucide-react';
import type { SyncStageState } from '@/lib/db/schema/marketplaces';

const STAGE_TITLES: Record<string, string> = {
  full: 'Полная синхронизация',
  products: 'Каталог товаров',
  prices: 'Цены и комиссии',
  stocks: 'Остатки',
  orders: 'Заказы',
  realization: 'Реализация',
  transactions: 'Транзакции',
  perfCampaigns: 'Рекламные кампании',
  perfSkuStats: 'Статистика рекламы',
  perfPhrases: 'Поисковые фразы',
  turnover: 'Оборачиваемость',
  analyticsData: 'Аналитика продаж',
};

type ActiveJob = {
  jobId: string;
  accountId: string;
  accountName: string;
  kind: string;
  status: 'pending' | 'running';
  startedAt: string | null;
  itemsProcessed: number;
  itemsTotal: number;
  currentStage: string | null;
  currentStageProcessed: number;
  currentStageTotal: number;
  stages: Record<string, SyncStageState>;
};

const POLL_INTERVAL_MS = 5_000;

export function GlobalSyncIndicator() {
  const [jobs, setJobs] = useState<ActiveJob[]>([]);
  const [completedFlash, setCompletedFlash] = useState<string | null>(null);
  const [dismissedJobs, setDismissedJobs] = useState<Set<string>>(new Set());
  const previousJobIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const res = await fetch('/api/marketplaces/jobs/active', {
          cache: 'no-store',
        });
        if (cancelled) return;
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.ok || cancelled) return;
        const next = (data.jobs ?? []) as ActiveJob[];

        // Если предыдущая итерация имела jobs, а сейчас нет — показываем флеш «Готово» на 4с.
        if (previousJobIds.current.size > 0 && next.length === 0) {
          const lastJobId = Array.from(previousJobIds.current)[0];
          setCompletedFlash(lastJobId);
          setTimeout(() => setCompletedFlash(null), 4000);
        }
        previousJobIds.current = new Set(next.map((j) => j.jobId));
        setJobs(next);
      } catch {
        // тихо игнорируем — не критично
      }
    };

    tick();
    intervalId = setInterval(tick, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, []);

  const visibleJobs = jobs.filter((j) => !dismissedJobs.has(j.jobId));

  if (visibleJobs.length === 0 && !completedFlash) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {visibleJobs.map((job) => (
        <SyncJobCard
          key={job.jobId}
          job={job}
          onDismiss={() =>
            setDismissedJobs((prev) => new Set(prev).add(job.jobId))
          }
        />
      ))}
      {visibleJobs.length === 0 && completedFlash && <SyncCompletedCard />}
    </div>
  );
}

function SyncJobCard({
  job,
  onDismiss,
}: {
  job: ActiveJob;
  onDismiss: () => void;
}) {
  const stageTitle = job.currentStage
    ? STAGE_TITLES[job.currentStage] ?? job.currentStage
    : 'Подготовка…';
  const stageProgress =
    job.currentStageTotal > 0
      ? `${job.currentStageProcessed.toLocaleString('ru-RU')} / ${job.currentStageTotal.toLocaleString('ru-RU')}`
      : job.currentStageProcessed > 0
        ? `${job.currentStageProcessed.toLocaleString('ru-RU')}`
        : null;

  const completed = countStages(job.stages, ['success', 'skipped']);
  const total = Object.keys(job.stages).length;
  const overallPct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <div className="pointer-events-auto w-80 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/40 px-3 py-2">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold">
            Синхронизация · {job.accountName}
          </div>
          <div className="text-[10px] text-muted-foreground">
            {STAGE_TITLES[job.kind] ?? job.kind} · {overallPct}%
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Скрыть (sync продолжается в фоне)"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="px-3 py-2">
        <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
          <span className="truncate font-medium">{stageTitle}</span>
          {stageProgress && (
            <span className="shrink-0 text-muted-foreground">{stageProgress}</span>
          )}
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${overallPct}%` }}
          />
        </div>
        <Link
          href="/settings/integrations"
          className="mt-2 inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline"
        >
          Подробнее <ChevronRight className="h-2.5 w-2.5" />
        </Link>
      </div>
    </div>
  );
}

function SyncCompletedCard() {
  return (
    <div className="pointer-events-auto w-80 overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50 shadow-lg dark:border-emerald-900 dark:bg-emerald-950/60">
      <div className="flex items-center gap-2 px-3 py-2">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-200">
            Синхронизация завершена
          </div>
          <div className="text-[10px] text-emerald-700/80 dark:text-emerald-300/70">
            Обновите блоки — данные актуализированы.
          </div>
        </div>
      </div>
    </div>
  );
}

function countStages(
  stages: Record<string, SyncStageState>,
  statuses: Array<SyncStageState['status']>,
): number {
  let count = 0;
  for (const s of Object.values(stages)) {
    if (statuses.includes(s.status)) count += 1;
  }
  return count;
}
