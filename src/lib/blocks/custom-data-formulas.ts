// PURPOSE: Portable formula engine для блока custom.data — расчёт ячеек
// с поддержкой A1-нотации, именованной ссылки [row].col, cross-block
// @blockId.field, циклических ссылок и money-detection. Используется
// как на клиенте (CustomDataBlock render), так и на сервере
// (/api/blocks/sources route).
//
// Контракт ячейки:
//   - cell.v === null|undefined       → пусто
//   - typeof cell.v === 'number'      → числовой литерал
//   - typeof cell.v === 'string' && !v.startsWith('=') → текстовый литерал
//   - typeof cell.v === 'string' && v.startsWith('=')  → формула
//   - cell.ref присутствует           → binding (приоритет над v)
//
// Адресация:
//   - A1, B2, ... — column letter (A=первая колонка) + row number (1=первая строка)
//   - [Row Label].col_id — именованный alias (case-insensitive trim по row.label, exact по column.id или column.label)
//   - @blockId.field или @blockId — cross-block (резолвится через liveValues)

import FormulaParser, { MAX_ROW, MAX_COLUMN } from 'fast-formula-parser';

// ============================================================================
// Public types
// ============================================================================

export type CellFormat = 'rubles' | 'number' | 'percent' | 'text';

export type FormulaCell = {
  v: number | string | null;
  ref?: string;
  isMoney?: boolean;
};

export type FormulaColumn = {
  id: string;
  label: string;
  format: CellFormat;
};

export type FormulaRow = {
  id: string;
  label: string;
  cells: Record<string, FormulaCell | undefined>;
};

export type FormulaEvalContext = {
  rows: FormulaRow[];
  columns: FormulaColumn[];
  /** Cross-block live values: ключ = blockId либо blockId.field. */
  liveValues?: Record<string, number | string | null>;
  /** Money-флаги для @-ссылок (ключ совпадает с ключом liveValues). */
  moneyRefs?: Record<string, boolean>;
};

export type FormulaResult = {
  /** Литерал (raw value cell) или результат вычисления. */
  value: number | string | null;
  /** Является ли результат денежным (для форматирования). */
  money: boolean;
  /** Тип ячейки: literal | formula | binding. */
  kind: 'literal' | 'formula' | 'binding' | 'empty';
  /** Ошибка вычисления, если есть. */
  error?: '#CYCLE' | '#ERR';
};

// ============================================================================
// Address helpers
// ============================================================================

export function colLabel(i: number): string {
  let s = '';
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

export function colIndex(label: string): number {
  let n = 0;
  for (let i = 0; i < label.length; i++) {
    n = n * 26 + (label.charCodeAt(i) - 64);
  }
  return n - 1;
}

export function cellAddress(rowIdx: number, colIdx: number): string {
  return `${colLabel(colIdx)}${rowIdx + 1}`;
}

// ============================================================================
// Parsing helpers
// ============================================================================

function parseNumberLoose(value: string): number | null {
  const cleaned = value
    .trim()
    .replace(/\s/g, '')
    .replace(/[₽рруб.]/gi, '')
    .replace(',', '.');
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Приводит cell.v к числу. null → 0, "abc" → 0, "1 234,56 ₽" → 1234.56. */
function cellRawAsNumber(v: number | string | null | undefined): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    if (!v) return 0;
    const n = parseNumberLoose(v);
    return n ?? 0;
  }
  return 0;
}

// ============================================================================
// Pre-process: [Row Label].col_id → A1
// ============================================================================

/** Нормализация строки для сравнения labels: trim + lower + collapse-spaces. */
function normalizeLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Заменяет именованные ссылки `[Row Label].col_id` или `[Row].[col]` на A1.
 * Возвращает преобразованную формулу и набор найденных coords для anti-cycle.
 *
 * Алгоритм матчинга колонки:
 *   1) точное совпадение с column.id (предпочтительно)
 *   2) case-insensitive совпадение с column.label (если id не найден)
 *
 * Алгоритм матчинга строки:
 *   1) case-insensitive совпадение с row.label (normalize)
 *   2) точное совпадение с row.id (для программных ссылок)
 */
export function preprocessNamedRefs(
  formula: string,
  ctx: FormulaEvalContext,
): { transformed: string; resolvedCoords: Array<{ rowIdx: number; colIdx: number }> } {
  const rowLabelMap = new Map<string, number>();
  const rowIdMap = new Map<string, number>();
  ctx.rows.forEach((row, idx) => {
    if (row.label) rowLabelMap.set(normalizeLabel(row.label), idx);
    rowIdMap.set(row.id, idx);
  });
  const colIdMap = new Map<string, number>();
  const colLabelMap = new Map<string, number>();
  ctx.columns.forEach((col, idx) => {
    colIdMap.set(col.id, idx);
    if (col.label) colLabelMap.set(normalizeLabel(col.label), idx);
  });

  const coords: Array<{ rowIdx: number; colIdx: number }> = [];

  // Pattern 1: [Row Label].col_id  или  [Row Label].[col with spaces]
  const pattern = /\[([^\]]+)\]\s*\.\s*(?:\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))/g;
  const transformed = formula.replace(pattern, (match, rowRaw: string, colBracketed: string | undefined, colBare: string | undefined) => {
    const rowKey = normalizeLabel(rowRaw);
    let rowIdx = rowLabelMap.get(rowKey);
    if (rowIdx === undefined) rowIdx = rowIdMap.get(rowRaw.trim());
    if (rowIdx === undefined) return match;

    const colRaw = colBracketed ?? colBare ?? '';
    let colIdx = colIdMap.get(colRaw);
    if (colIdx === undefined) colIdx = colLabelMap.get(normalizeLabel(colRaw));
    if (colIdx === undefined) return match;

    coords.push({ rowIdx, colIdx });
    return cellAddress(rowIdx, colIdx);
  });

  return { transformed, resolvedCoords: coords };
}

// ============================================================================
// Pre-process: @blockId.field → numeric value
// ============================================================================

/**
 * Заменяет @-токены на числовые значения из liveValues. Возвращает
 * преобразованную формулу + признак, есть ли money-ссылки внутри.
 */
export function preprocessBlockRefs(
  formula: string,
  ctx: FormulaEvalContext,
): { transformed: string; hasMoneyRef: boolean } {
  const liveValues = ctx.liveValues ?? {};
  const moneyRefs = ctx.moneyRefs ?? {};
  let hasMoneyRef = false;

  const transformed = formula.replace(/@([A-Za-z0-9_.:-]+)/g, (_match, ref: string) => {
    const val = liveValues[ref];
    if (moneyRefs[ref]) hasMoneyRef = true;
    if (val === null || val === undefined) return '0';
    if (typeof val === 'number') return Number.isFinite(val) ? String(val) : '0';
    const parsed = parseNumberLoose(String(val));
    return parsed === null ? '0' : String(parsed);
  });

  return { transformed, hasMoneyRef };
}

// ============================================================================
// Simple math eval (fast path for =1+2, =A1*B1 after substitution)
// ============================================================================

export function simpleMathEval(expr: string): number | null {
  if (!/^[\d\s+\-*/().,%-]+$/.test(expr)) return null;
  try {
    const fn = new Function('return (' + expr + ')');
    const result = fn();
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

/**
 * Evaluate простое выражение с подстановкой переменных a, b, c, ... → значения.
 * Используется в computed.sum aggregation='formula' для выражений типа `(a + b) * 0.13`.
 *
 * Безопасность: только латинские буквы как переменные, операторы + - * / ( ) % и числа.
 * Возвращает `null` если выражение невалидно, переменная не определена или результат не finite.
 */
export function evalFormulaVars(
  expression: string,
  vars: Record<string, number>,
): number | null {
  if (!expression || typeof expression !== 'string') return null;
  if (!/^[a-zA-Z\d\s+\-*/().,%-]+$/.test(expression)) return null;
  let substituted = expression;
  const varNames = Object.keys(vars).sort((a, b) => b.length - a.length);
  for (const name of varNames) {
    if (!/^[a-zA-Z]+$/.test(name)) return null;
    const re = new RegExp(`\\b${name}\\b`, 'g');
    substituted = substituted.replace(re, `(${vars[name]})`);
  }
  if (/[a-zA-Z]/.test(substituted)) return null;
  return simpleMathEval(substituted);
}

// ============================================================================
// A1-cell lookup + recursive evaluation
// ============================================================================

type EvalCache = Map<string, FormulaResult>;

function evaluateA1Address(
  rowIdx: number,
  colIdx: number,
  ctx: FormulaEvalContext,
  cache: EvalCache,
  visiting: Set<string>,
): number {
  const addr = cellAddress(rowIdx, colIdx);
  if (visiting.has(addr)) return 0;
  const cached = cache.get(addr);
  if (cached) {
    if (cached.error) return 0;
    if (typeof cached.value === 'number') return cached.value;
    if (typeof cached.value === 'string') return parseNumberLoose(cached.value) ?? 0;
    return 0;
  }
  const row = ctx.rows[rowIdx];
  if (!row) return 0;
  const col = ctx.columns[colIdx];
  if (!col) return 0;
  const cell = row.cells[col.id];
  const newVisiting = new Set(visiting);
  newVisiting.add(addr);
  const result = evaluateCellInternal(cell, { rowIdx, colIdx }, ctx, cache, newVisiting);
  cache.set(addr, result);
  if (result.error) return 0;
  if (typeof result.value === 'number') return result.value;
  if (typeof result.value === 'string') return parseNumberLoose(result.value) ?? 0;
  return 0;
}

// ============================================================================
// Main evaluator (internal — used recursively)
// ============================================================================

function evaluateCellInternal(
  cell: FormulaCell | undefined,
  coord: { rowIdx: number; colIdx: number },
  ctx: FormulaEvalContext,
  cache: EvalCache,
  visiting: Set<string>,
): FormulaResult {
  const col = ctx.columns[coord.colIdx];
  const columnIsMoney = col?.format === 'rubles';

  if (!cell || (cell.v === null && !cell.ref)) {
    return { value: null, money: columnIsMoney, kind: 'empty' };
  }

  // Binding (ref) — приоритет над v, но v используется как fallback (cached value)
  if (cell.ref) {
    const liveValues = ctx.liveValues ?? {};
    const live = liveValues[cell.ref];
    const value = live !== undefined && live !== null ? live : cell.v;
    const money = cell.isMoney ?? columnIsMoney;
    return { value: value ?? null, money, kind: 'binding' };
  }

  // Literal (число/строка без =)
  if (typeof cell.v === 'number') {
    return { value: cell.v, money: columnIsMoney, kind: 'literal' };
  }
  if (typeof cell.v !== 'string') {
    return { value: null, money: columnIsMoney, kind: 'empty' };
  }
  if (!cell.v.startsWith('=')) {
    const trimmed = cell.v.trim();
    if (!trimmed) return { value: null, money: columnIsMoney, kind: 'empty' };
    const num = parseNumberLoose(trimmed);
    if (num !== null) return { value: num, money: columnIsMoney, kind: 'literal' };
    return { value: cell.v, money: false, kind: 'literal' };
  }

  // Formula
  const raw = cell.v.slice(1);
  return evaluateFormulaString(raw, coord, ctx, cache, visiting, columnIsMoney);
}

function evaluateFormulaString(
  raw: string,
  coord: { rowIdx: number; colIdx: number },
  ctx: FormulaEvalContext,
  cache: EvalCache,
  visiting: Set<string>,
  columnIsMoney: boolean,
): FormulaResult {
  try {
    // 1) Named refs → A1
    const named = preprocessNamedRefs(raw, ctx);
    // 2) @blockId.field → numbers
    const blockSub = preprocessBlockRefs(named.transformed, ctx);

    // Money detection — формула денежная, если:
    //   а) задействует хоть один @-ref с money: true,
    //   б) задействует ячейку из rubles-колонки (через A1 или [row].col),
    //   в) сама колонка хранения денежная.
    let money = blockSub.hasMoneyRef || columnIsMoney;
    if (!money) {
      // Поверхностный сканер A1-адресов в формуле — ищем "BUKVA(N)"
      const a1Re = /\b([A-Z]+)(\d+)\b/g;
      let m: RegExpExecArray | null;
      while ((m = a1Re.exec(blockSub.transformed)) !== null) {
        const cIdx = colIndex(m[1]);
        const refCol = ctx.columns[cIdx];
        if (refCol?.format === 'rubles') {
          money = true;
          break;
        }
      }
      // resolvedCoords из named (уже преобразованы в A1, но мы и так пройдём по a1Re)
      for (const c of named.resolvedCoords) {
        const refCol = ctx.columns[c.colIdx];
        if (refCol?.format === 'rubles') {
          money = true;
          break;
        }
      }
    }

    // 3) Fast path — простая математика без cell-refs
    const simple = simpleMathEval(blockSub.transformed);
    if (simple !== null) {
      return { value: simple, money, kind: 'formula' };
    }

    // 4) fast-formula-parser с onCell/onRange callbacks
    const maxRowConst = MAX_ROW ?? FormulaParser.MAX_ROW ?? 1048576;
    const maxColConst = MAX_COLUMN ?? FormulaParser.MAX_COLUMN ?? 16384;

    const parser = new FormulaParser({
      onCell: ({ row, col }: { sheet: string; row: number; col: number }) =>
        evaluateA1Address(row - 1, col - 1, ctx, cache, visiting),
      onRange: (ref: { from: { row: number; col: number }; to: { row: number; col: number } }) => {
        const maxRow = ref.to.row >= maxRowConst ? ctx.rows.length : ref.to.row;
        const maxCol = ref.to.col >= maxColConst ? ctx.columns.length : ref.to.col;
        const arr: number[][] = [];
        for (let r = ref.from.row; r <= maxRow; r++) {
          const inner: number[] = [];
          for (let c = ref.from.col; c <= maxCol; c++) {
            inner.push(evaluateA1Address(r - 1, c - 1, ctx, cache, visiting));
          }
          arr.push(inner);
        }
        return arr;
      },
    });

    const position = {
      row: coord.rowIdx + 1,
      col: coord.colIdx + 1,
      sheet: 'CustomData',
    };
    const parsed = parser.parse(blockSub.transformed, position);

    if (typeof parsed === 'number') {
      if (!Number.isFinite(parsed)) return { value: '#ERR', money, kind: 'formula', error: '#ERR' };
      return { value: parsed, money, kind: 'formula' };
    }
    if (typeof parsed === 'string') {
      return { value: parsed, money: false, kind: 'formula' };
    }
    if (typeof parsed === 'boolean') {
      return { value: parsed ? 1 : 0, money, kind: 'formula' };
    }
    if (parsed === null || parsed === undefined) {
      return { value: 0, money, kind: 'formula' };
    }
    if (parsed instanceof Error || (typeof parsed === 'object' && 'message' in (parsed as object))) {
      return { value: '#ERR', money, kind: 'formula', error: '#ERR' };
    }
    return { value: String(parsed), money: false, kind: 'formula' };
  } catch {
    // Fallback last-chance simple math
    const fallback = simpleMathEval(raw);
    if (fallback !== null) {
      return { value: fallback, money: columnIsMoney, kind: 'formula' };
    }
    return { value: '#ERR', money: false, kind: 'formula', error: '#ERR' };
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Вычисляет одну ячейку. Для batch-расчёта всей таблицы используйте
 * `evaluateAllCells` — он переиспользует кэш между вызовами.
 */
export function evaluateCustomCell(
  cell: FormulaCell | undefined,
  coord: { rowIdx: number; colIdx: number },
  ctx: FormulaEvalContext,
  cache?: EvalCache,
): FormulaResult {
  const c = cache ?? new Map();
  return evaluateCellInternal(cell, coord, ctx, c, new Set());
}

/**
 * Batch-расчёт всех ячеек таблицы. Возвращает Map { "A1" → FormulaResult }.
 * Использует общий кэш и cycle-detection для всех формул.
 */
export function evaluateAllCells(ctx: FormulaEvalContext): EvalCache {
  const cache: EvalCache = new Map();
  for (let r = 0; r < ctx.rows.length; r++) {
    for (let c = 0; c < ctx.columns.length; c++) {
      const addr = cellAddress(r, c);
      if (cache.has(addr)) continue;
      const cell = ctx.rows[r].cells[ctx.columns[c].id];
      const result = evaluateCellInternal(cell, { rowIdx: r, colIdx: c }, ctx, cache, new Set());
      cache.set(addr, result);
    }
  }
  return cache;
}

/**
 * Удобный хелпер: вернуть только числовое значение (для агрегатов).
 * Возвращает null для текста, ошибок и пустых ячеек.
 */
export function resultAsNumber(result: FormulaResult): number | null {
  if (result.error) return null;
  if (result.value === null || result.value === undefined) return null;
  if (typeof result.value === 'number') return Number.isFinite(result.value) ? result.value : null;
  if (typeof result.value === 'string') {
    return parseNumberLoose(result.value);
  }
  return null;
}

/** Удобный хелпер: вернуть строку для отображения (без форматирования). */
export function resultAsRaw(result: FormulaResult): number | string | null {
  if (result.error) return result.error;
  return result.value;
}

// Re-export для удобства потребителей
export { cellRawAsNumber };
