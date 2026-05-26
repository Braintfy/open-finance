// PURPOSE: Универсальная linkable input-ячейка для unit-калькуляторов.
// Click → редактирование вручную; Click по chain-icon → модалка привязки.
// Если есть активная привязка — показываем resolved value и иконку цепочки.
'use client';

import { useState, type CSSProperties } from 'react';
import { Link2, Link2Off } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UnitCellBindingDialog } from './unit-cell-binding-dialog';
import type { UnitCellBinding } from '@/lib/unit-economics/types';
import { rublesToKopecks } from '@/lib/unit-economics/types';
import { isBindingActive, resolveBindingValue } from '@/lib/unit-economics/bindings';
import { useAllBlockValuesFlat } from '@/lib/unit-economics/use-live-block-values';
import { useFormatSettings, formatRublesWithSettings } from '@/lib/format-settings';

type Props = {
  selfBlockId: string;
  fieldLabel: string;
  /** Текущее ручное значение */
  value: number;
  onValueChange: (value: number) => void;
  binding: UnitCellBinding | undefined;
  onBindingChange: (binding: UnitCellBinding | undefined) => void;
  /** Ширина и высота — таблица задаёт CSS извне */
  className?: string;
  style?: CSSProperties;
  /** Тип формата input (₽, %, шт.) — только для подписи */
  unit?: string;
  /** Денежное поле? (определяет money flag по умолчанию) */
  money?: boolean;
  step?: number;
  min?: number;
  max?: number;
  align?: 'left' | 'right';
};

function parseInput(text: string): number {
  const normalized = text.replace(/\s/g, '').replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function LinkableNumberCell({
  selfBlockId,
  fieldLabel,
  value,
  onValueChange,
  binding,
  onBindingChange,
  className,
  style,
  unit,
  money,
  step,
  min,
  max,
  align = 'right',
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const liveValues = useAllBlockValuesFlat();
  const { settings } = useFormatSettings();

  /**
   * Унифицированное форматирование. Раньше для целых чисел возвращался `String(v)`
   * (без разделителей), для float — `Intl.NumberFormat` (с разделителями) →
   * каша в колонках типа «Выручка Ozon» где одни значения целые, другие дробные.
   * Теперь всегда `Intl.NumberFormat`. Для money — `formatRublesWithSettings`
   * (учитывает глобальный `showKopecks`), суффикс ` ₽` срезаем — unit-badge уже в шапке.
   */
  const formatValue = (v: number): string => {
    if (!Number.isFinite(v)) return '';
    if (money) {
      return formatRublesWithSettings(rublesToKopecks(v), settings.showKopecks).replace(/\s?₽$/, '').trim();
    }
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v);
  };

  const isLinked = isBindingActive(binding);
  const linkedValue = isLinked ? resolveBindingValue(binding, liveValues) : null;
  const displayValue = isLinked && linkedValue !== null ? linkedValue : value;

  const inputValue = isLinked
    ? linkedValue === null
      ? '—'
      : formatValue(linkedValue)
    : formatValue(value);

  return (
    <div
      className={cn(
        'group relative flex h-full items-stretch overflow-hidden rounded border border-transparent text-[12px] transition-colors',
        isLinked ? 'bg-amber-50/60 dark:bg-amber-950/30' : 'bg-transparent',
        'focus-within:border-primary/60 hover:border-border/70',
        className,
      )}
      style={style}
      title={
        isLinked
          ? `Привязано: ${binding?.ref?.label ?? 'блок'}${
              linkedValue === null ? ' (источник недоступен — fallback)' : ''
            }`
          : `Введите ${fieldLabel}${unit ? ', ' + unit : ''}`
      }
    >
      <input
        type="text"
        inputMode={isLinked ? undefined : 'decimal'}
        readOnly={isLinked}
        tabIndex={isLinked ? -1 : 0}
        onClick={isLinked ? () => setPickerOpen(true) : undefined}
        value={inputValue}
        onChange={
          isLinked
            ? undefined
            : (e) => {
                let next = parseInput(e.target.value);
                if (typeof min === 'number') next = Math.max(min, next);
                if (typeof max === 'number') next = Math.min(max, next);
                void step;
                onValueChange(next);
              }
        }
        className={cn(
          'h-full flex-1 min-w-0 border-0 bg-transparent px-1.5 tabular-nums outline-none placeholder:text-muted-foreground/60',
          align === 'right' ? 'text-right' : 'text-left',
          isLinked && 'cursor-pointer select-none',
          isLinked && linkedValue === null && 'text-amber-700 dark:text-amber-400',
        )}
      />
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className={cn(
          'flex h-full w-5 shrink-0 items-center justify-center text-muted-foreground transition-colors',
          isLinked ? 'opacity-100 text-amber-600 dark:text-amber-400' : 'opacity-0 group-hover:opacity-100',
          'hover:text-primary',
        )}
        title={isLinked ? 'Изменить или отменить привязку' : 'Привязать к блоку'}
      >
        {isLinked ? <Link2 className="h-3 w-3" /> : <Link2Off className="h-3 w-3" />}
      </button>
      <UnitCellBindingDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selfBlockId={selfBlockId}
        fieldLabel={fieldLabel}
        binding={binding}
        money={money}
        currentManualValue={value}
        onSave={onBindingChange}
      />
    </div>
  );
}
