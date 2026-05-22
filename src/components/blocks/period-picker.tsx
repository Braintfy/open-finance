// PURPOSE: Универсальный селектор периода для Ozon-аналитики и других
// блоков с временным окном. Пресеты: сегодня / вчера / 7д / 14д / 30д /
// MTD / custom.
//
// v0.20.1: pure-функции вынесены в `@/lib/blocks/period-resolver` (SSR-safe).
// Этот файл — `'use client'` UI-пикер; функции переэкспортируются сюда для
// backward-compat существующих клиентских импортов.

'use client';

import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
};

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
}: PeriodPickerProps) {
  const [showCustom, setShowCustom] = useState(value.preset === 'custom');

  function selectPreset(preset: PeriodPreset) {
    if (preset === 'custom') {
      setShowCustom(true);
      onChange({ ...value, preset });
      return;
    }
    setShowCustom(false);
    onChange({ preset });
  }

  const size = compact ? 'sm' : 'sm';

  return (
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
}
