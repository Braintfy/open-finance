// PURPOSE: Утилиты общего назначения (className merging и форматирование)
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Форматирует копейки в строку с символом валюты
 * 47200 → "472 ₽"
 * 4720000 → "47 200 ₽"
 */
export function formatRubles(amountInKopecks: number): string {
  const rubles = Math.round(amountInKopecks / 100);
  const formatted = new Intl.NumberFormat('ru-RU').format(rubles);
  return `${formatted} ₽`;
}

/**
 * Форматирует дату в читабельный вид (учитывая русскую локаль)
 */
export function formatDate(date: Date | string, withTime = false): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime && { hour: '2-digit', minute: '2-digit' }),
  }).format(d);
}
