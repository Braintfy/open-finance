// PURPOSE: Sticky header сверху страницы — содержит PagePeriodPicker и
// (опц.) SourceFilterChips для page-level периода/источника.
// Блоки страницы автоматически наследуют этот период/source через
// `useEffectivePeriod` / `useEffectiveSource`, если не имеют per-block override.

'use client';

import { CalendarRange } from 'lucide-react';
import { PeriodPicker, type PeriodValue } from '@/components/blocks/period-picker';
import { usePagePeriod } from '@/lib/blocks/page-period-context';
import { usePageSource } from '@/lib/blocks/page-source-context';
import { SourceFilterChips } from '@/components/blocks/source-filter-chips';

export function PagePeriodHeader({
  description,
  showSourceFilter = false,
}: {
  description?: string;
  /** Показывать чипы выбора источника (transactions.source). */
  showSourceFilter?: boolean;
}) {
  const { value, setValue } = usePagePeriod();
  const sourceCtx = usePageSource();

  function onChange(v: PeriodValue) {
    setValue({
      preset: v.preset,
      customFrom: v.customFrom ?? null,
      customTo: v.customTo ?? null,
    });
  }

  return (
    <div className="sticky top-0 z-30 -mx-1 mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-md border border-border/60 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
        <CalendarRange className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          {description ?? 'Период страницы (наследуется блоками)'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {showSourceFilter && sourceCtx.pageKey ? (
          <SourceFilterChips
            value={sourceCtx.value}
            onChange={sourceCtx.setValue}
            size="xs"
          />
        ) : null}
        <PeriodPicker value={value} onChange={onChange} compact />
      </div>
    </div>
  );
}
