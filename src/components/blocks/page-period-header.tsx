// PURPOSE: Sticky header сверху страницы — содержит PagePeriodPicker и
// (опц.) SourceFilterChips для page-level периода/источника.
// Блоки страницы автоматически наследуют этот период/source через
// `useEffectivePeriod` / `useEffectiveSource`, если не имеют per-block override.
//
// v0.22.0: добавлены `collapsed` (узкая полоска-summary с chevron'ом для
// разворачивания) и `onToggleCollapsed`. BlockGrid использует эти пропсы
// чтобы скрыть/показать панель по умолчанию (auto-detect) или по toggle'у
// в edit-mode toolbar.

'use client';

import { CalendarRange, ChevronDown, ChevronUp } from 'lucide-react';
import { PeriodPicker, type PeriodValue } from '@/components/blocks/period-picker';
import { usePagePeriod } from '@/lib/blocks/page-period-context';
import { usePageSource } from '@/lib/blocks/page-source-context';
import { SourceFilterChips } from '@/components/blocks/source-filter-chips';

const PRESET_LABELS: Record<string, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  '7d': '7 дней',
  '14d': '14 дней',
  '30d': '30 дней',
  mtd: 'Текущий месяц',
  custom: 'Произвольный',
};

export function PagePeriodHeader({
  description,
  showSourceFilter = false,
  collapsed = false,
  onToggleCollapsed,
}: {
  description?: string;
  /** Показывать чипы выбора источника (transactions.source). */
  showSourceFilter?: boolean;
  /** Свёрнутое состояние: узкая полоска-summary с chevron'ом. */
  collapsed?: boolean;
  /** Callback toggle (только если хотим показать chevron-разворачивание). */
  onToggleCollapsed?: (next: boolean) => void;
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

  if (collapsed) {
    const presetLabel = PRESET_LABELS[value.preset] ?? value.preset;
    const sourceLabel =
      sourceCtx.pageKey && sourceCtx.value
        ? sourceCtx.value
        : 'Все источники';
    return (
      <button
        type="button"
        onClick={() => onToggleCollapsed?.(false)}
        className="sticky top-0 z-30 -mx-1 mb-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-md border border-border/40 bg-background/80 px-3 py-1 text-left text-[11px] text-muted-foreground backdrop-blur transition hover:bg-background hover:text-foreground"
        title="Развернуть панель периода и источника"
      >
        <CalendarRange className="h-3 w-3 shrink-0" />
        <span className="truncate">
          {presetLabel} · {sourceLabel}
        </span>
        <ChevronDown className="ml-auto h-3 w-3 shrink-0" />
      </button>
    );
  }

  return (
    <div className="sticky top-0 z-30 -mx-1 mb-1 flex flex-col gap-1.5 rounded-md border border-border/60 bg-background/95 px-3 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/85">
      {/* Row 1 (nowrap): иконка + описание (truncate) + chevron всегда top-right */}
      <div className="flex min-w-0 items-center gap-2 text-[12px] text-muted-foreground">
        <CalendarRange className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {description ?? 'Период страницы (наследуется блоками)'}
        </span>
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={() => onToggleCollapsed(true)}
            className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="Свернуть панель"
            aria-label="Свернуть панель периода"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {/* Row 2 (wrap): source-чипы + period-picker */}
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
