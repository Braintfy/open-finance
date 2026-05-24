// PURPOSE: Sticky header сверху страницы — содержит PagePeriodPicker и
// (опц.) SourceFilterChips для page-level периода/источника.
// Блоки страницы автоматически наследуют этот период/source через
// `useEffectivePeriod` / `useEffectiveSource`, если не имеют per-block override.
//
// v0.22.0: добавлены `collapsed` (узкая полоска-summary с chevron'ом для
// разворачивания) и `onToggleCollapsed`. BlockGrid использует эти пропсы
// чтобы скрыть/показать панель по умолчанию (auto-detect) или по toggle'у
// в edit-mode toolbar.
//
// v0.23: warning-чип «Мастер-настройка» (dismissable) + кнопка «Сбросить
// локальные периоды (N)» — массовый mass-reset для блоков, отвязавшихся
// через `useBlockPeriod` (override).

'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { CalendarRange, ChevronDown, ChevronUp, Info, Unlock, X } from 'lucide-react';
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

const WARNING_STORAGE_KEY = 'page-period-header:warning-dismissed:v1';

function readWarningDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(WARNING_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeWarningDismissed(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.localStorage.setItem(WARNING_STORAGE_KEY, '1');
    else window.localStorage.removeItem(WARNING_STORAGE_KEY);
  } catch {
    // ignore quota errors
  }
}

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
  const {
    value,
    setValue,
    countOverridden,
    subscribeRegistry,
    resetAllOverrides,
  } = usePagePeriod();
  const sourceCtx = usePageSource();

  // useSyncExternalStore — реактивный счётчик overridden-блоков. Header
  // re-render'ится при изменении registry (registerBlock / unregisterBlock).
  const overriddenCount = useSyncExternalStore(
    subscribeRegistry,
    countOverridden,
    () => 0,
  );

  // Warning dismissable. localStorage флаг читается после mount (SSR-safe).
  const [warningHidden, setWarningHidden] = useState(true);
  useEffect(() => {
    setWarningHidden(readWarningDismissed());
  }, []);
  function dismissWarning() {
    setWarningHidden(true);
    writeWarningDismissed(true);
  }

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
        {overriddenCount > 0 && (
          <span
            className="ml-1 inline-flex shrink-0 items-center gap-0.5 rounded-full bg-amber-100 px-1.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
            title={`${overriddenCount} блоков со своим периодом (не синхронизированы с настройкой страницы)`}
          >
            {overriddenCount} свой
          </span>
        )}
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
      {/* Row 2 (wrap): source-чипы + period-picker + reset-overrides */}
      <div className="flex flex-wrap items-center gap-2">
        {showSourceFilter && sourceCtx.pageKey ? (
          <SourceFilterChips
            value={sourceCtx.value}
            onChange={sourceCtx.setValue}
            size="xs"
          />
        ) : null}
        <PeriodPicker value={value} onChange={onChange} compact />
        {overriddenCount > 0 && (
          <button
            type="button"
            onClick={() => resetAllOverrides()}
            className="inline-flex h-6 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 text-[11px] font-medium text-amber-700 transition hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900/30"
            title={`Сбросить локальные периоды у ${overriddenCount} ${overriddenCount === 1 ? 'блока' : 'блоков'} → все вернутся к периоду страницы.`}
          >
            <Unlock className="h-3 w-3" />
            Сбросить локальные ({overriddenCount})
          </button>
        )}
      </div>
      {/* Row 3: warning chip — dismissable */}
      {!warningHidden && (
        <div className="flex items-start gap-1.5 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[11px] text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="flex-1">
            <strong className="font-semibold">Мастер-настройка:</strong>{' '}
            переключает период во всех блоках, которые наследуют его. Блоки со
            своим периодом (lock-badge) остаются как есть — сбросьте их кнопкой
            «Сбросить локальные», чтобы все блоки синхронизировались.
          </span>
          <button
            type="button"
            onClick={dismissWarning}
            className="shrink-0 rounded p-0.5 text-sky-700 transition hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-900"
            title="Больше не показывать это уведомление"
            aria-label="Скрыть подсказку"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
