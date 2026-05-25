// PURPOSE: Excel-like fill-handle для блока custom.data.
// Источник: одна ячейка; цель: диапазон вниз/вверх или влево/вправо.
// При копировании формулы A1-ссылки сдвигаются на (dRow, dCol) — относительные
// ссылки (HyperFormula-семантика: copy/paste relative, by-name `[Row].col` —
// абсолютные). @-ссылки на другие блоки и `cell.ref` (binding) — всегда абсолютные.

import { cellAddress, colIndex, type FormulaCell } from './custom-data-formulas';

export type FillDirection = 'vertical' | 'horizontal';

/** Координаты ячейки в логической сетке (rowIdx, colIdx). */
export type FillCoord = { rowIdx: number; colIdx: number };

/**
 * Сдвигает все A1-ссылки в формуле на (dRow, dCol). Пропускает:
 *   - @blockId.field токены (cross-block, не относительные);
 *   - [Row label].col токены (именованные, не относительные);
 *   - идентификаторы функций (SUM, MIN) — у них нет цифр сразу после букв.
 *
 * Если ссылка выходит за границы (`maxRows × maxCols`) — заменяется на `#REF!`.
 */
export function shiftFormulaRefs(
  formula: string,
  dRow: number,
  dCol: number,
  maxRows: number,
  maxCols: number,
): string {
  if (typeof formula !== 'string' || !formula.startsWith('=')) return formula;

  let out = '';
  let i = 0;
  const s = formula;

  while (i < s.length) {
    const ch = s[i];

    if (ch === '@') {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_.:-]/.test(s[j])) j++;
      out += s.slice(i, j);
      i = j;
      continue;
    }

    if (ch === '[') {
      let j = i + 1;
      while (j < s.length && s[j] !== ']') j++;
      if (j < s.length) j++;
      out += s.slice(i, j);
      i = j;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < s.length && s[j] !== quote) j++;
      if (j < s.length) j++;
      out += s.slice(i, j);
      i = j;
      continue;
    }

    const prev = i > 0 ? s[i - 1] : '';
    const isWordBoundaryLeft = !/[A-Za-z0-9_]/.test(prev);

    if (isWordBoundaryLeft && /[A-Z]/.test(ch)) {
      const m = /^([A-Z]+)(\d+)/.exec(s.slice(i));
      if (m) {
        const after = s[i + m[0].length];
        const isWordBoundaryRight = !after || !/[A-Za-z0-9_]/.test(after);
        if (isWordBoundaryRight) {
          const cIdx = colIndex(m[1]);
          const rIdx = Number.parseInt(m[2], 10) - 1;
          const newC = cIdx + dCol;
          const newR = rIdx + dRow;
          if (newC < 0 || newC >= maxCols || newR < 0 || newR >= maxRows) {
            out += '#REF!';
          } else {
            out += cellAddress(newR, newC);
          }
          i += m[0].length;
          continue;
        }
      }
    }

    out += ch;
    i++;
  }

  return out;
}

/**
 * Производит «filled-target» из source-ячейки относительно сдвига (dRow, dCol).
 *   - binding (`cell.ref`) копируется как есть — это явная absolute-ссылка на блок;
 *   - формула — A1-refs сдвигаются на (dRow, dCol);
 *   - литералы (число/текст) копируются как есть.
 */
export function fillCellFromSource(
  source: FormulaCell | undefined,
  dRow: number,
  dCol: number,
  maxRows: number,
  maxCols: number,
): FormulaCell {
  if (!source) return { v: null };

  if (source.ref) {
    return {
      v: source.v ?? null,
      ref: source.ref,
      isMoney: source.isMoney,
    };
  }

  if (typeof source.v === 'string' && source.v.startsWith('=')) {
    const shifted = shiftFormulaRefs(source.v, dRow, dCol, maxRows, maxCols);
    return {
      v: shifted,
      isMoney: source.isMoney,
    };
  }

  return {
    v: source.v ?? null,
    isMoney: source.isMoney,
  };
}

/**
 * Возвращает список координат, в которые надо распространить source. Source-cell
 * в список НЕ включается. Направление определяется автоматически по большей
 * дельте между source и hover — Excel/Handsontable-стиль.
 */
export function computeFillTargets(
  source: FillCoord,
  hover: FillCoord,
): { targets: FillCoord[]; direction: FillDirection } {
  const dR = hover.rowIdx - source.rowIdx;
  const dC = hover.colIdx - source.colIdx;
  const absR = Math.abs(dR);
  const absC = Math.abs(dC);

  if (absR === 0 && absC === 0) {
    return { targets: [], direction: 'vertical' };
  }

  const direction: FillDirection = absR >= absC ? 'vertical' : 'horizontal';
  const targets: FillCoord[] = [];

  if (direction === 'vertical') {
    const step = dR > 0 ? 1 : -1;
    for (let r = source.rowIdx + step; step > 0 ? r <= hover.rowIdx : r >= hover.rowIdx; r += step) {
      targets.push({ rowIdx: r, colIdx: source.colIdx });
    }
  } else {
    const step = dC > 0 ? 1 : -1;
    for (let c = source.colIdx + step; step > 0 ? c <= hover.colIdx : c >= hover.colIdx; c += step) {
      targets.push({ rowIdx: source.rowIdx, colIdx: c });
    }
  }

  return { targets, direction };
}

/** True, если (r, c) находится между source и hover на одной оси (включительно). */
export function isInFillRange(
  source: FillCoord,
  hover: FillCoord,
  r: number,
  c: number,
): boolean {
  if (r === source.rowIdx && c === source.colIdx) return true;
  const dR = hover.rowIdx - source.rowIdx;
  const dC = hover.colIdx - source.colIdx;
  const absR = Math.abs(dR);
  const absC = Math.abs(dC);
  if (absR === 0 && absC === 0) return false;
  const direction: FillDirection = absR >= absC ? 'vertical' : 'horizontal';
  if (direction === 'vertical') {
    if (c !== source.colIdx) return false;
    const [lo, hi] = source.rowIdx <= hover.rowIdx
      ? [source.rowIdx, hover.rowIdx]
      : [hover.rowIdx, source.rowIdx];
    return r >= lo && r <= hi;
  }
  if (r !== source.rowIdx) return false;
  const [lo, hi] = source.colIdx <= hover.colIdx
    ? [source.colIdx, hover.colIdx]
    : [hover.colIdx, source.colIdx];
  return c >= lo && c <= hi;
}
