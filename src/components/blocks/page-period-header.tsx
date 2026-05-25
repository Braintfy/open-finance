// PURPOSE: Компактный inline-контрол страничного периода и источника.
// Рендерится прямо в тулбаре BlockGrid (в одну строку с «Связи»/«Настроить»).
// PeriodPicker — в режиме collapsed (одна кнопка + Popover).
// SourceFilter — один кнопка + Popover с чипами, если showSourceFilter=true.
// «N свой» — кнопка сброса локальных override'ов блоков.
//
// v0.23.10: переработан из sticky-полосы в компактный inline вид.
// Backward-compat: принимает старые пропы (description, collapsed,
// onToggleCollapsed) но игнорирует их — layout теперь управляет BlockGrid.

'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronDown, Info, Layers3, Unlock } from 'lucide-react';
import { PeriodPicker, type PeriodValue } from '@/components/blocks/period-picker';
import { usePagePeriod } from '@/lib/blocks/page-period-context';
import { usePageSource } from '@/lib/blocks/page-source-context';
import { SourceFilterChips, SOURCE_LABELS } from '@/components/blocks/source-filter-chips';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

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
  showSourceFilter = false,
  // Backward-compat — accepted but unused in the new inline layout
  description: _description,
  collapsed: _collapsed,
  onToggleCollapsed: _onToggleCollapsed,
}: {
  description?: string;
  showSourceFilter?: boolean;
  /** @deprecated Ignored — layout is now always inline. */
  collapsed?: boolean;
  /** @deprecated Ignored — layout is now always inline. */
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
  const [sourceOpen, setSourceOpen] = useState(false);

  const overriddenCount = useSyncExternalStore(
    subscribeRegistry,
    countOverridden,
    () => 0,
  );

  const [warningHidden, setWarningHidden] = useState(true);
  useEffect(() => {
    setWarningHidden(readWarningDismissed());
  }, []);

  function onChange(v: PeriodValue) {
    setValue({
      preset: v.preset,
      customFrom: v.customFrom ?? null,
      customTo: v.customTo ?? null,
    });
  }

  const currentSourceLabel =
    sourceCtx.value
      ? (SOURCE_LABELS[sourceCtx.value]?.label ?? sourceCtx.value)
      : 'Все источники';

  return (
    <div className="flex items-center gap-1.5">
      {/* Период — collapsed: одна кнопка [📅 30 дней ↓] + Popover */}
      <PeriodPicker value={value} onChange={onChange} compact collapsed />

      {/* Источник — только для cashflow-страниц */}
      {showSourceFilter && sourceCtx.pageKey && (
        <Popover open={sourceOpen} onOpenChange={setSourceOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 text-[11px] font-medium text-foreground hover:bg-accent"
            >
              <Layers3 className="h-3 w-3 text-muted-foreground" />
              <span>{currentSourceLabel}</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-2">
            <div className="mb-1.5 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Источник
            </div>
            <SourceFilterChips
              value={sourceCtx.value}
              onChange={(v) => {
                sourceCtx.setValue(v);
                setSourceOpen(false);
              }}
              size="xs"
            />
          </PopoverContent>
        </Popover>
      )}

      {/* N-свой: сброс override'ов блоков на страничный период */}
      {overriddenCount > 0 && (
        <button
          type="button"
          onClick={() => resetAllOverrides()}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 text-[11px] font-medium text-amber-700 transition hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900/30"
          title={`Сбросить локальные периоды у ${overriddenCount} ${overriddenCount === 1 ? 'блока' : 'блоков'} — все вернутся к периоду страницы.`}
        >
          <Unlock className="h-3 w-3" />
          {overriddenCount} свой
        </button>
      )}

      {/* Подсказка «Мастер-настройка» — компактная иконка, dismissable */}
      {!warningHidden && (
        <button
          type="button"
          onClick={() => {
            setWarningHidden(true);
            writeWarningDismissed(true);
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-sky-200 bg-sky-50 text-sky-700 transition hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300"
          title="Мастер-настройка: переключает период всех блоков страницы. Нажмите чтобы скрыть эту подсказку."
        >
          <Info className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
