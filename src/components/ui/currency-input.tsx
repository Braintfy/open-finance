// PURPOSE: Input для ввода денежных сумм с автоподставкой запятой (копейки).
// Хранит значение в копейках (integer), отображает с разделителем дробной части.
'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

type CurrencyInputProps = {
  /** Значение в копейках (integer) */
  value: number;
  /** Callback при изменении — передаёт значение в копейках */
  onChange: (valueInKopecks: number) => void;
  /** Показывать дробную часть (копейки) */
  showKopecks?: boolean;
  className?: string;
  placeholder?: string;
};

/**
 * Форматирует число копеек в строку для отображения в инпуте.
 * showKopecks=true: "1 234,56"
 * showKopecks=false: "1 234"
 */
function formatForDisplay(kopecks: number, showKopecks: boolean): string {
  if (showKopecks) {
    const rubles = Math.floor(Math.abs(kopecks) / 100);
    const kop = Math.abs(kopecks) % 100;
    const sign = kopecks < 0 ? '-' : '';
    const rublesStr = rubles.toLocaleString('ru-RU');
    const kopStr = kop.toString().padStart(2, '0');
    return `${sign}${rublesStr},${kopStr}`;
  }
  const rubles = Math.round(kopecks / 100);
  return rubles.toLocaleString('ru-RU');
}

/**
 * Парсит строку ввода пользователя в копейки.
 * Принимает: "1234,56", "1 234,56", "1234.56", "1234"
 */
function parseToKopecks(input: string, showKopecks: boolean): number {
  // Убираем пробелы (разделители тысяч)
  let cleaned = input.replace(/\s/g, '').replace(/\u00a0/g, '');
  
  // Определяем знак
  const negative = cleaned.startsWith('-');
  if (negative) cleaned = cleaned.slice(1);
  
  // Заменяем точку на запятую для единообразия
  cleaned = cleaned.replace('.', ',');
  
  // Убираем всё кроме цифр и запятой
  cleaned = cleaned.replace(/[^\d,]/g, '');
  
  if (!cleaned) return 0;

  if (showKopecks) {
    const parts = cleaned.split(',');
    const rublesPart = parseInt(parts[0] || '0', 10) || 0;
    let kopecksPart = 0;
    if (parts[1] !== undefined) {
      // Берём первые 2 цифры после запятой
      const kopStr = parts[1].slice(0, 2).padEnd(2, '0');
      kopecksPart = parseInt(kopStr, 10) || 0;
    }
    const total = rublesPart * 100 + kopecksPart;
    return negative ? -total : total;
  }
  
  // Без копеек — вводим рубли целиком
  const rubles = parseInt(cleaned.replace(',', ''), 10) || 0;
  return negative ? -(rubles * 100) : rubles * 100;
}

export function CurrencyInput({
  value,
  onChange,
  showKopecks = false,
  className,
  placeholder,
}: CurrencyInputProps) {
  const [displayValue, setDisplayValue] = useState(() => formatForDisplay(value, showKopecks));
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastValueRef = useRef(value);

  // Синхронизация при внешнем изменении value
  useEffect(() => {
    if (!isFocused && value !== lastValueRef.current) {
      setDisplayValue(formatForDisplay(value, showKopecks));
      lastValueRef.current = value;
    }
  }, [value, showKopecks, isFocused]);

  // При смене showKopecks переформатировать
  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(formatForDisplay(value, showKopecks));
    }
  }, [showKopecks, value, isFocused]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    // При фокусе показываем "чистое" число для удобства редактирования
    if (showKopecks) {
      const rubles = Math.floor(Math.abs(value) / 100);
      const kop = Math.abs(value) % 100;
      const sign = value < 0 ? '-' : '';
      const kopStr = kop.toString().padStart(2, '0');
      setDisplayValue(kop > 0 ? `${sign}${rubles},${kopStr}` : `${sign}${rubles}`);
    } else {
      const rubles = Math.round(value / 100);
      setDisplayValue(rubles === 0 ? '' : rubles.toString());
    }
  }, [value, showKopecks]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    const parsed = parseToKopecks(displayValue, showKopecks);
    lastValueRef.current = parsed;
    onChange(parsed);
    setDisplayValue(formatForDisplay(parsed, showKopecks));
  }, [displayValue, showKopecks, onChange]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setDisplayValue(raw);
      
      // Realtime parse для live update
      const parsed = parseToKopecks(raw, showKopecks);
      if (parsed !== lastValueRef.current) {
        lastValueRef.current = parsed;
        onChange(parsed);
      }
    },
    [showKopecks, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      // При вводе запятой в режиме showKopecks — если запятой ещё нет, подставить
      if (showKopecks && (e.key === ',' || e.key === '.')) {
        if (displayValue.includes(',')) {
          e.preventDefault(); // Запрещаем вторую запятую
        }
      }
    },
    [showKopecks, displayValue]
  );

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={handleChange}
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
