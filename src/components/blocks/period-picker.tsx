// PURPOSE: Универсальный селектор периода для Ozon-аналитики и других
// блоков с временным окном. Пресеты: сегодня / вчера / 7д / 14д / 30д /
// MTD / custom.
//
// v0.20.1: pure-функции вынесены в `@/lib/blocks/period-resolver` (SSR-safe).
// Этот файл — `'use client'` UI-пикер; функции переэкспортируются сюда для
// backward-compat существующих клиентских импортов.

'use client';

import { useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export {
  resolvePeriod,
  resolveOzonPeriod,
  getPreviousPeriod,
  describePeriod,
  ozonPeriodToSearchParams,
  type PeriodPreset,
  type Period,
  type PeriodValue,
  type ResolvePeriodOptions,
} from '@/lib/blocks/period-resolver';

import type { PeriodPreset, PeriodValue } from '@/lib/blocks/period-resolver';

const PRESET_LABELS: Record<Exclude<PeriodPreset, 'custom'>, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  '7d': '7 дней',
  '14d': '14 дней',
  '30d': '30 дней',
  mtd: 'Текущий месяц',
};

export type PeriodPickerProps = {
  value: PeriodValue;
  onChange: (v: PeriodValue) => void;
  /** Какие пресеты показывать (default: все). */
  presets?: PeriodPreset[];
  /** Компактный режим для маленьких блоков. */
  compact?: boolean;
  /**
   * Свёрнутый режим: одна кнопка-триггер с label текущего пресета, все
   * chips и custom-dates рендерятся в Popover. Применяется в in-block
   * headers (узкие блоки), чтобы 6 chips не выдавливали другие контролы.
   */
  collapsed?: boolean;
};

function describePresetLabel(value: PeriodValue): string {
  if (value.preset === 'custom') {
    if (value.customFrom && value.customTo)
      return `${value.customFrom} → ${value.customTo}`;
    return 'Произвольный';
  }
  return PRESET_LABELS[value.preset];
}

const DEFAULT_PRESETS: PeriodPreset[] = [
  'today',
  'yesterday',
  '7d',
  '14d',
  '30d',
  'mtd',
  'custom',
];

export function PeriodPicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  compact = false,
  collapsed = false,
}: PeriodPickerProps) {
  const [showCustom, setShowCustom] = useState(value.preset === 'custom');
  const [popoverOpen, setPopoverOpen] = useState(false);

  function selectPreset(preset: PeriodPreset) {
    if (preset === 'custom') {
      setShowCustom(true);
      onChange({ ...value, preset });
      return;
    }
    setShowCustom(false);
    onChange({ preset });
    // В collapsed-режиме закрываем popover после выбора пресета.
    if (collapsed) setPopoverOpen(false);
  }

  const size = compact ? 'sm' : 'sm';

  const chipsAndCustom = (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {presets.map((preset) => {
          if (preset === 'custom') return null;
          const active = value.preset === preset;
          return (
            <button
              key={preset}
              type="button"
              onClick={() => selectPreset(preset)}
              className={
                'inline-flex items-center rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors ' +
                (active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border/60 bg-background text-muted-foreground hover:text-foreground')
              }
            >
              {PRESET_LABELS[preset]}
            </button>
          );
        })}
        {presets.includes('custom') && (
          <Button
            variant="outline"
            size={size}
            className={
              'h-7 gap-1 text-[11px] ' +
              (value.preset === 'custom' ? 'border-primary text-primary' : '')
            }
            onClick={() => selectPreset('custom')}
          >
            <Calendar className="h-3 w-3" />
            Произвольный
          </Button>
        )}
      </div>
      {showCustom && value.preset === 'custom' && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={value.customFrom ?? ''}
            onChange={(e) =>
              onChange({
                preset: 'custom',
                customFrom: e.target.value,
                customTo: value.customTo,
              })
            }
            className="h-7 w-[140px] text-[11px]"
          />
          <span className="text-[11px] text-muted-foreground">—</span>
          <Input
            type="date"
            value={value.customTo ?? ''}
            onChange={(e) =>
              onChange({
                preset: 'custom',
                customFrom: value.customFrom,
                customTo: e.target.value,
              })
            }
            className="h-7 w-[140px] text-[11px]"
          />
        </div>
      )}
    </div>
  );

  if (collapsed) {
    const triggerLabel = describePresetLabel(value);
    const triggerTitle =
      value.preset === 'custom' && value.customFrom && value.customTo
        ? `Период: ${value.customFrom} → ${value.customTo}`
        : `Период: ${PRESET_LABELS[value.preset as Exclude<PeriodPreset, 'custom'>] ?? triggerLabel}`;
    return (
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={triggerTitle}
            className="inline-flex h-7 max-w-[200px] items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Calendar className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">{triggerLabel}</span>
            <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[340px] p-2">
          <div className="mb-1 px-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Период
          </div>
          {chipsAndCustom}
        </PopoverContent>
      </Popover>
    );
  }

  return chipsAndCustom;
}
