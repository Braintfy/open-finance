// PURPOSE: Семейство скелетонов по форме блока — для overlay'я загрузки внутри
// уже отмеренной grid-ячейки (через BlockChrome). Density-aware: на xs/sm
// сворачивается до 1-2 баров (как compact у EmptySourcePlaceholder).
//
// Контракт: контент-only (без Card — карточку даёт сам блок/чрома), fill h-full
// w-full, БЕЗ фикс-px → нулевой layout-shift внутри ячейки react-grid-layout.
// Вариант приходит строкой из BLOCK_META.skeletonVariant (RSC-safe, как iconName).
'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { useBlockDensity } from './block-size';

export type BlockSkeletonVariant =
  | 'stat' // stat.income/expense/balance/custom, excel.cell, computed.sum, unit-ozon-kpi (одна метрика)
  | 'kpiGrid' // kpi.grid, unit-ozon-kpi (несколько карточек)
  | 'chart' // chart.cashflow, unit-ozon-chart
  | 'table' // custom.data, unit.my-store, unit-ozon-analytics/multi-table/campaigns/top-ads/...
  | 'list' // cashflow.transactions, inbox.channel-feed, inbox.dashboard
  | 'calculator' // unit-ozon-calculator, unit-yandex-calculator
  | 'map' // unit-ozon-stock/warehouse-clusters
  | 'generic'; // markdown-note, navigate-card, прочее

const WRAP = 'flex h-full w-full min-h-0 flex-col gap-2 overflow-hidden p-3';

export function BlockSkeleton({
  variant = 'generic',
  rows = 6,
}: {
  variant?: BlockSkeletonVariant;
  rows?: number;
}) {
  const density = useBlockDensity();
  const tiny = density === 'xs' || density === 'sm';

  if (density === 'xs') {
    // Только одна полоса по центру — повторяет xs-формат блоков.
    return (
      <div className="flex h-full w-full items-center justify-center p-2">
        <Skeleton className="h-5 w-12" />
      </div>
    );
  }

  switch (variant) {
    case 'stat':
      return (
        <div className={WRAP}>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-28" />
          {!tiny && <Skeleton className="mt-auto h-8 w-full rounded" />}
        </div>
      );

    case 'kpiGrid':
      return (
        <div className={WRAP}>
          <div className="grid flex-1 grid-cols-2 gap-2">
            {Array.from({ length: tiny ? 2 : 4 }).map((_, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-md border border-border/50 p-2">
                <Skeleton className="h-2.5 w-14" />
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        </div>
      );

    case 'chart':
      return (
        <div className={WRAP}>
          <Skeleton className="h-3 w-24" />
          <div className="flex flex-1 items-end gap-1.5">
            {Array.from({ length: tiny ? 6 : 14 }).map((_, i) => (
              <Skeleton
                key={i}
                className="flex-1 rounded-sm"
                style={{ height: `${30 + ((i * 37) % 60)}%` }}
              />
            ))}
          </div>
        </div>
      );

    case 'table':
      return (
        <div className={WRAP}>
          <div className="flex gap-2 border-b border-border/50 pb-1.5">
            {Array.from({ length: tiny ? 3 : 5 }).map((_, i) => (
              <Skeleton key={i} className="h-3 flex-1" />
            ))}
          </div>
          {Array.from({ length: tiny ? 3 : rows }).map((_, r) => (
            <div key={r} className="flex gap-2">
              {Array.from({ length: tiny ? 3 : 5 }).map((_, c) => (
                <Skeleton key={c} className="h-3.5 flex-1" />
              ))}
            </div>
          ))}
        </div>
      );

    case 'list':
      return (
        <div className={WRAP}>
          {Array.from({ length: tiny ? 2 : Math.min(rows, 6) }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Skeleton className="h-3 w-1/2" />
                {!tiny && <Skeleton className="h-2.5 w-3/4" />}
              </div>
            </div>
          ))}
        </div>
      );

    case 'calculator':
      return (
        <div className={WRAP}>
          {Array.from({ length: tiny ? 3 : 6 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-6 w-20 rounded" />
            </div>
          ))}
        </div>
      );

    case 'map':
      return (
        <div className={WRAP}>
          <Skeleton className="h-3 w-28" />
          <div className="grid flex-1 grid-cols-3 gap-2">
            {Array.from({ length: tiny ? 3 : 6 }).map((_, i) => (
              <Skeleton key={i} className="h-full min-h-[36px] rounded" />
            ))}
          </div>
        </div>
      );

    case 'generic':
    default:
      return (
        <div className={WRAP}>
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-3/4" />
          {!tiny && <Skeleton className="h-3 w-2/3" />}
          {!tiny && <Skeleton className="mt-auto h-3 w-1/2" />}
        </div>
      );
  }
}
