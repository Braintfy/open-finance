// PURPOSE: Input для ввода денежных сумм с автоподставкой запятой (ATM-style).
// Последние 2 цифры — всегда копейки. Запятая появляется автоматически.
// Хранит значение в копейках (integer).
'use client';

import { useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

type CurrencyInputProps = {
  /** Значение в копейках (integer) */
  value: number;
  /** Callback при изменении — передаёт значение в копейках */
  onChange: (valueInKopecks: number) => void;
  /** Показывать дробную часть (копейки) — ATM-style auto-comma */
  showKopecks?: boolean;
  className?: string;
  placeholder?: string;
};

/**
 * ATM-style форматирование: "20 000,44" для 2000044 копеек.
 * Запятая всегда фиксирована перед последними 2 цифрами.
 */
function formatKopecks(kopecks: number): string {
  const abs = Math.abs(kopecks);
  const sign = kopecks < 0 ? '-' : '';
  const rubles = Math.floor(abs / 100);
  const kop = abs % 100;
  const rublesStr = rubles.toLocaleString('ru-RU');
  const kopStr = kop.toString().padStart(2, '0');
  return `${sign}${rublesStr},${kopStr}`;
}

/** Форматирование только рублей (без копеек) */
function formatRubles(kopecks: number): string {
  const rubles = Math.round(kopecks / 100);
  if (rubles === 0 && kopecks === 0) return '0';
  return rubles.toLocaleString('ru-RU');
}

export function CurrencyInput({
  value,
  onChange,
  showKopecks = true,
  className,
  placeholder,
}: CurrencyInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const internalRef = useRef(value);

  // Sync display when value changes externally
  useEffect(() => {
    if (internalRef.current !== value) {
      internalRef.current = value;
      if (inputRef.current && document.activeElement !== inputRef.current) {
        inputRef.current.value = showKopecks ? formatKopecks(value) : formatRubles(value);
      }
    }
  }, [value, showKopecks]);

  // Set initial display value
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.value = showKopecks ? formatKopecks(value) : formatRubles(value);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showKopecks]);

  const handleInput = useCallback(
    (e: React.FormEvent<HTMLInputElement>) => {
      const input = e.currentTarget;
      // Extract only digits from input
      const digits = input.value.replace(/[^\d]/g, '');

      if (showKopecks) {
        // ATM-style: all digits represent kopecks amount
        const kopecks = parseInt(digits, 10) || 0;
        internalRef.current = kopecks;
        onChange(kopecks);
        // Reformat with comma
        input.value = formatKopecks(kopecks);
      } else {
        // No kopecks: digits are rubles
        const rubles = parseInt(digits, 10) || 0;
        const kopecks = rubles * 100;
        internalRef.current = kopecks;
        onChange(kopecks);
        input.value = formatRubles(kopecks);
      }
    },
    [showKopecks, onChange]
  );

  const handleFocus = useCallback(() => {
    const input = inputRef.current;
    if (input) {
      // Select all on focus for easy replacement
      requestAnimationFrame(() => input.select());
    }
  }, []);

  const handleBlur = useCallback(() => {
    const input = inputRef.current;
    if (input) {
      // Ensure clean display on blur
      input.value = showKopecks
        ? formatKopecks(internalRef.current)
        : formatRubles(internalRef.current);
    }
  }, [showKopecks]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // Allow: backspace, delete, tab, escape, enter, arrows, home, end, select all
      const allowed = [
        'Backspace', 'Delete', 'Tab', 'Escape', 'Enter',
        'ArrowLeft', 'ArrowRight', 'Home', 'End',
      ];
      if (allowed.includes(e.key)) return;
      // Allow Ctrl+A, Ctrl+C, Ctrl+V, Ctrl+X
      if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x'].includes(e.key)) return;
      // Only allow digits
      if (!/^\d$/.test(e.key)) {
        e.preventDefault();
      }
    },
    []
  );

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      defaultValue={showKopecks ? formatKopecks(value) : formatRubles(value)}
      onInput={handleInput}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder ?? (showKopecks ? '0,00' : '0')}
      className={cn(
        'flex h-7 w-24 rounded-md border border-input bg-transparent px-1 text-right text-xs tabular-nums shadow-none transition-colors',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:bg-background',
        className
      )}
    />
  );
}
