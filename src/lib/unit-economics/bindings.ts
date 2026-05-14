// PURPOSE: Утилиты для linkable ячеек юнит-калькуляторов.
// Хранит связи `{ fieldKey: UnitCellBinding }` рядом с inputs.

import type { UnitCellBinding } from './types';

export type BindingMap = Record<string, UnitCellBinding | undefined>;

export function isBindingActive(binding?: UnitCellBinding): binding is UnitCellBinding & {
  ref: NonNullable<UnitCellBinding['ref']>;
} {
  return Boolean(binding && binding.mode === 'block_ref' && binding.ref?.blockId);
}

export function bindingScopedKey(binding: UnitCellBinding): string | null {
  if (!isBindingActive(binding)) return null;
  const ref = binding.ref!;
  const field = ref.field ?? 'value';
  const local = field === 'value' ? ref.blockId : `${ref.blockId}.${field}`;
  if (!ref.pageKey || ref.pageKey === 'current') return local;
  return `${ref.pageKey}:${ref.blockId}.${field}`;
}

/**
 * Извлечь итоговое числовое значение для биндинга.
 * Аргумент `liveValues` — это плоская мапа { 'blockId.field' | 'pageKey:blockId.field' -> value }.
 */
export function resolveBindingValue(
  binding: UnitCellBinding | undefined,
  liveValues: Record<string, number | string | null>,
): number | null {
  if (!binding) return null;
  if (binding.mode === 'manual') {
    return typeof binding.fallbackValue === 'number' ? binding.fallbackValue : null;
  }
  const key = bindingScopedKey(binding);
  if (!key) return typeof binding.fallbackValue === 'number' ? binding.fallbackValue : null;
  const v = liveValues[key];
  if (typeof v === 'number') {
    // money flag: при привязке к денежному источнику конвертируем копейки в рубли,
    // потому что калькуляторы работают с рублями.
    return binding.money ? v / 100 : v;
  }
  if (typeof v === 'string') {
    const parsed = Number.parseFloat(v.replace(',', '.'));
    if (Number.isFinite(parsed)) return binding.money ? parsed / 100 : parsed;
  }
  return typeof binding.fallbackValue === 'number' ? binding.fallbackValue : null;
}

/** True если биндинг активен и ссылка resolved к конкретному значению. */
export function bindingHasValue(
  binding: UnitCellBinding | undefined,
  liveValues: Record<string, number | string | null>,
): boolean {
  if (!isBindingActive(binding)) return false;
  const key = bindingScopedKey(binding);
  if (!key) return false;
  return liveValues[key] !== undefined && liveValues[key] !== null;
}
