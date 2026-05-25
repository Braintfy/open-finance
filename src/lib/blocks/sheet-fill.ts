// PURPOSE: Excel-like fill-handle для блока sheet. Sheet хранит ячейки как
// плоские строки (`string[][]`), а не FormulaCell-объекты, поэтому здесь —
// тонкий адаптер поверх pure-helpers из `custom-data-fill.ts`.
//
// Семантика идентична custom.data (v0.23.4):
//   - formula (`startsWith('=')`) — A1-ссылки сдвигаются relative.
//   - литерал (число/текст) — копируется как есть.
//   - out-of-bounds A1 → `#REF!`.
//   - `@blockRef`, `[Row].col`, идентификаторы функций (SUM/MIN), строковые
//     литералы — пропускаются (см. `shiftFormulaRefs`).
//
// Также экспортируем helper'ы для reorder/delete-индексации highlights:
// rowHighlights/colHighlights хранятся в Record<string, HighlightId>,
// где ключи — индексы строк/колонок (строкой). При DnD-reorder или удалении
// колонки/строки нужно переиндексировать ключи.

import {
  shiftFormulaRefs,
  computeFillTargets,
  isInFillRange,
  type FillCoord,
  type FillDirection,
} from './custom-data-fill';

export {
  shiftFormulaRefs,
  computeFillTargets,
  isInFillRange,
  type FillCoord,
  type FillDirection,
};

/**
 * Sheet-адаптер `fillCellFromSource`: source — плоская строка ячейки.
 *   - `=...` — A1-shift на (dRow, dCol) через `shiftFormulaRefs`.
 *   - литерал/пусто — копируется as-is.
 *
 * NB: out-of-bounds A1 заменяется на `#REF!` внутри `shiftFormulaRefs`.
 */
export function fillSheetCellFromSource(
  source: string | undefined,
  dRow: number,
  dCol: number,
  maxRows: number,
  maxCols: number,
): string {
  if (!source) return '';
  if (source.startsWith('=')) {
    return shiftFormulaRefs(source, dRow, dCol, maxRows, maxCols);
  }
  return source;
}

/**
 * Переиндексирует highlights-map при DnD-reorder колонок/строк.
 * `fromIdx` → `toIdx` (как в `arrayMove`). Не мутирует исходный объект.
 *
 *   { "0": "yellow", "2": "blue" }   reorder 2 → 0   →   { "0": "blue", "1": "yellow" }
 */
export function reindexHighlightsOnMove(
  highlights: Record<string, string> | undefined,
  fromIdx: number,
  toIdx: number,
  total: number,
): Record<string, string> | undefined {
  if (!highlights || fromIdx === toIdx) return highlights;
  // Преобразуем sparse Record в плоский массив длиной `total`,
  // применяем arrayMove, конвертируем обратно.
  const arr: Array<string | undefined> = Array.from({ length: total }, (_, i) =>
    highlights[String(i)],
  );
  const moved = arr.splice(fromIdx, 1)[0];
  arr.splice(toIdx, 0, moved);
  const next: Record<string, string> = {};
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) next[String(i)] = arr[i] as string;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * Удаляет ключи из highlights-map, соответствующие удалённым индексам.
 * Оставшиеся индексы сдвигаются вниз. Пример:
 *
 *   { "0": "yellow", "2": "blue", "4": "red" }  remove [2]  →
 *   { "0": "yellow", "3": "red" }
 *
 * `removedIdx` — массив исходных индексов (до удаления), отсортированный
 * по возрастанию или нет, нам всё равно.
 */
export function reindexHighlightsOnRemove(
  highlights: Record<string, string> | undefined,
  removedIdx: number[],
  total: number,
): Record<string, string> | undefined {
  if (!highlights || removedIdx.length === 0) return highlights;
  const removed = new Set(removedIdx);
  const kept: Array<string | undefined> = [];
  for (let i = 0; i < total; i++) {
    if (removed.has(i)) continue;
    kept.push(highlights[String(i)]);
  }
  const next: Record<string, string> = {};
  for (let i = 0; i < kept.length; i++) {
    if (kept[i]) next[String(i)] = kept[i] as string;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}
