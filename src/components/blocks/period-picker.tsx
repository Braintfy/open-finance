// PURPOSE: Универсальный селектор периода для Ozon-аналитики и других
// блоков с временным окном. Пресеты: сегодня / вчера / 7д / 14д / 30д /
// MTD / custom. Pure-функции resolvePeriod() и getPreviousPeriod()
// экспортируются для использования в API routes и тестах.

'use client';

import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  describeOzonQueryPeriod,
  getPreviousOzonQueryPeriod,
  ozonQueryPeriodToLegacyDates,
  resolveOzonQueryPeriod,
  type OzonPeriodPreset,
} from '@/lib/marketplaces/ozon/query-period';

export type PeriodPreset = OzonPeriodPreset;

export type Period = { from: Date; to: Date };

export type PeriodValue = {
  preset: PeriodPreset;
  /** Только при preset='custom' (ISO YYYY-MM-DD). */
  customFrom?: string | null;
  customTo?: string | null;
};

const PRESET_LABELS: Record<Exclude<PeriodPreset, 'custom'>, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  '7d': '7 дней',
  '14d': '14 дней',
  '30d': '30 дней',
  mtd: 'Текущий месяц',
};

export type ResolvePeriodOptions = {
  now?: Date;
  /** Исключить сегодня (MSC) — для chart. */
  excludeToday?: boolean;
};

/**
 * Pure-функция: разрешить пресет в диапазон (legacy Date + MSC dates внутри).
 * Границы — календарные дни Europe/Moscow; `to` exclusive для SQL `<`.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  customFrom?: string | null,
  customTo?: string | null,
  nowOrOptions: Date | ResolvePeriodOptions = new Date(),
): Period {
  const options =
    nowOrOptions instanceof Date ? { now: nowOrOptions } : nowOrOptions;
  const msc = resolveOzonQueryPeriod(preset, customFrom, customTo, options);
  return ozonQueryPeriodToLegacyDates(msc);
}

/** MSC-период для API query params (`fromDate`, `toDateExclusive`). */
export function resolveOzonPeriod(
  preset: PeriodPreset,
  customFrom?: string | null,
  customTo?: string | null,
  options: ResolvePeriodOptions = {},
) {
  return resolveOzonQueryPeriod(preset, customFrom, customTo, options);
}

/**
 * Pure-функция: получить предыдущий период такой же длины (для «vs прошлый»).
 */
export function getPreviousPeriod(period: Period): Period {
  const fromDate = period.from.toISOString().slice(0, 10);
  const toDateExclusive = period.to.toISOString().slice(0, 10);
  const prev = getPreviousOzonQueryPeriod({
    fromDate,
    toDateExclusive,
    timezone: 'Europe/Moscow',
  });
  return ozonQueryPeriodToLegacyDates(prev);
}

/** Формирует короткое описание периода в MSC. */
export function describePeriod(period: Period): string {
  return describeOzonQueryPeriod({
    fromDate: period.from.toISOString().slice(0, 10),
    toDateExclusive: period.to.toISOString().slice(0, 10),
    timezone: 'Europe/Moscow',
  });
}

export {
  ozonPeriodToSearchParams,
} from '@/lib/marketplaces/ozon/query-period';

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
