// PURPOSE: Универсальный селектор периода для Ozon-аналитики и других
// блоков с временным окном. Пресеты: сегодня / вчера / 7д / 14д / 30д /
// MTD / custom. Pure-функции resolvePeriod() и getPreviousPeriod()
// экспортируются для использования в API routes и тестах.

'use client';

import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export type PeriodPreset =
  | 'today'
  | 'yesterday'
  | '7d'
  | '14d'
  | '30d'
  | 'mtd'
  | 'custom';

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

/**
 * Pure-функция: разрешить пресет в реальный диапазон. UTC.
 * `to` всегда — конец сегодняшнего дня (или конец customTo) — exclusive
 * сравнивать через `<` в SQL и `< to` в JS.
 */
export function resolvePeriod(
  preset: PeriodPreset,
  customFrom?: string | null,
  customTo?: string | null,
  now: Date = new Date(),
): Period {
  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  if (preset === 'custom') {
    const from = customFrom ? new Date(customFrom + 'T00:00:00Z') : todayStart;
    const toDate = customTo ? new Date(customTo + 'T00:00:00Z') : tomorrowStart;
    // to — exclusive (плюс один день).
    const to = new Date(toDate.getTime() + 24 * 60 * 60 * 1000);
    return { from, to };
  }

  if (preset === 'today') return { from: todayStart, to: tomorrowStart };
  if (preset === 'yesterday') {
    return {
      from: new Date(todayStart.getTime() - 24 * 60 * 60 * 1000),
      to: todayStart,
    };
  }
  if (preset === '7d') {
    return {
      from: new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000),
      to: tomorrowStart,
    };
  }
  if (preset === '14d') {
    return {
      from: new Date(todayStart.getTime() - 13 * 24 * 60 * 60 * 1000),
      to: tomorrowStart,
    };
  }
  if (preset === '30d') {
    return {
      from: new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000),
      to: tomorrowStart,
    };
  }
  // mtd: с первого числа этого месяца.
  return {
    from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    to: tomorrowStart,
  };
}

/**
 * Pure-функция: получить предыдущий период такой же длины (для «vs прошлый»).
 *   period.to - period.from = 7 дней → previous = [from-7, to-7).
 */
export function getPreviousPeriod(period: Period): Period {
  const length = period.to.getTime() - period.from.getTime();
  return {
    from: new Date(period.from.getTime() - length),
    to: new Date(period.from.getTime()),
  };
}

/**
 * Формирует короткое человеко-читаемое описание периода.
 */
export function describePeriod(period: Period): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  // to — exclusive, для отображения вычитаем сутки.
  const inclusiveTo = new Date(period.to.getTime() - 24 * 60 * 60 * 1000);
  const sameDay =
    period.from.toISOString().slice(0, 10) === inclusiveTo.toISOString().slice(0, 10);
  if (sameDay) return fmt(period.from);
  return `${fmt(period.from)} — ${fmt(inclusiveTo)}`;
}

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
