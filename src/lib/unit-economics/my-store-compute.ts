// PURPOSE: Чистое вычисление значений строки блока «Мой магазин · таблица»
// (manual-скоуп + per-cell/column формулы). Вынесено из catalog-компонента,
// чтобы покрывать smoke-тестами без React/клиентских импортов (см. правило
// в MEMORY: «Pure-helper'ы для smoke-тестов — выносить в отдельный модуль»).
//
// Ключевой инвариант (v0.39.0): per-cell override ФОРМУЛЬНОЙ колонки — ТОЛЬКО
// строка-формула с `=`. Сырые ЧИСЛА в `row.values` формульной колонки
// «осиротевшие» (остались после смены типа money→formula или повторного
// импорта) и ИГНОРИРУЮТСЯ, иначе они затеняют column-formula.

import { evalRowFormulas } from './store-formula';

/** Структурный минимум колонки, нужный для вычисления значений строки. */
export interface MyStoreComputeColumn {
  id: string;
  type: 'number' | 'percent' | 'money' | 'text' | 'formula' | 'identity';
  default?: number | string;
}

/** Структурный минимум строки. */
export interface MyStoreComputeRow {
  values: Record<string, number | string>;
  bindings: Record<string, unknown>;
}

/**
 * Per-cell формула (Excel-режим) — строковое значение `row.values[colId]`,
 * начинающееся с `=`. Тот же контракт, что и `cell.v` в блоке «Данные»;
 * именно так формулы сохраняет/читает XLSX-адаптер (`my-store-table.ts`).
 */
export function isCellFormulaValue(v: unknown): boolean {
  return typeof v === 'string' && v.trim().startsWith('=');
}

/**
 * Вычисляет значения строки: manual-скоуп (значения/привязки/дефолты) + формулы.
 * ЕДИНЫЙ источник правды для рендера строки (MyStoreRow) и агрегатов (computedRows).
 * `boundForRow` — заранее разрешённые block_ref-привязки строки (colId → число),
 * чтобы per-row компонент не подписывался на стор сам.
 */
export function computeRowValues(
  row: MyStoreComputeRow,
  columns: MyStoreComputeColumn[],
  vatPct: number,
  taxRatePct: number,
  formulasMap: Record<string, string | undefined>,
  boundForRow: Record<string, number> | undefined,
): Record<string, number | string> {
  const manual: Record<string, number | string> = { vatPct, taxRatePct };
  // Per-cell формулы этой строки (Excel-режим): colId → формула. Накладываются
  // поверх column-formula в `formulasMap` через `evalRowFormulas`. Работают и
  // для НЕ-формульных колонок (импортированное число → формула), и для
  // формульных (переопределение column-formula в одной строке).
  //
  // ВАЖНО: per-cell override формульной колонки — ТОЛЬКО строка с `=`. Сырые
  // ЧИСЛА в `row.values` формульной колонки игнорируются (осиротевшие), иначе
  // они затеняют формулу («показывает старое число вместо расчёта»).
  let cellFormulas: Record<string, string> | null = null;
  for (const col of columns) {
    if (col.type === 'identity') continue;
    const raw = row.values[col.id];
    // Per-cell формула: значение-строка с `=` → в formulas, не в manual,
    // чтобы движок её вычислил (а не трактовал как литерал → NaN → 0).
    if (isCellFormulaValue(raw)) {
      (cellFormulas ??= {})[col.id] = String(raw).trim();
      continue;
    }
    // Формульная колонка без `=`-override → значение даёт column-formula.
    // Сырые числа/строки в её row.values — осиротевшие, игнорируем.
    if (col.type === 'formula') continue;
    const bound = boundForRow?.[col.id];
    if (bound !== undefined) {
      manual[col.id] = bound;
      continue;
    }
    if (raw === undefined || raw === null || raw === '') {
      manual[col.id] = (col.default as number | string | undefined) ?? (col.type === 'text' ? '' : 0);
    } else {
      manual[col.id] = raw;
    }
  }
  const effectiveFormulas = cellFormulas ? { ...formulasMap, ...cellFormulas } : formulasMap;
  const computed = evalRowFormulas(manual, effectiveFormulas);
  const merged: Record<string, number | string> = { ...manual };
  for (const [k, v] of Object.entries(computed)) merged[k] = v;
  return merged;
}
