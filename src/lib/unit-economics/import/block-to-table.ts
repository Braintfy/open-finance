// PURPOSE: Нормализация конфигов блоков-таблиц → ImportTable для умного импорта
// в блок «Мой магазин · таблица». Поддержка:
//   - unit.my-store-table  → колонки/строки/формулы копируются как есть (та же схема);
//   - sheet                → cells[][] → колонки/строки + конвертация Excel-формул;
//   - custom.data          → колонки/строки, только значения (формулы движка иные);
//   - unit.ozon-multi-table→ курируемые input-поля, только значения.
//
// Чистый серверный модуль (без client-only зависимостей).

import type { BlockInstance } from '@/lib/blocks/types';
import {
  convertExcelFormula,
  guessTypeFromLabel,
  slugifyIdentifier,
  type ImportColumn,
  type ImportColumnType,
  type ImportRow,
  type ImportTable,
} from '../table-import';

/** Типы блоков, которые можно использовать как источник таблицы. */
export const IMPORTABLE_SOURCE_TYPES = [
  'unit.my-store-table',
  'sheet',
  'custom.data',
  'unit.ozon-multi-table',
] as const;

export type ImportableSourceType = (typeof IMPORTABLE_SOURCE_TYPES)[number];

export function isImportableSource(type: string): type is ImportableSourceType {
  return (IMPORTABLE_SOURCE_TYPES as readonly string[]).includes(type);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
}

function asNumberOrString(v: unknown): number | string | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    if (!trimmed) return null;
    return trimmed;
  }
  return null;
}

// ============================================================================
// unit.my-store-table → ImportTable (полная копия колонок/формул)
// ============================================================================

function fromMyStore(block: BlockInstance): ImportTable {
  const cfg = (block.config ?? {}) as Record<string, unknown>;
  const rawCols = asArray(cfg.columns);
  const rawRows = asArray(cfg.rows);

  const columns: ImportColumn[] = [];
  for (const rc of rawCols) {
    if (typeof rc !== 'object' || rc === null) continue;
    const c = rc as Record<string, unknown>;
    const id = asString(c.id);
    if (!id) continue;
    const type = asString(c.type) as string;
    if (type === 'identity') {
      columns.push({
        key: id,
        label: asString(c.label) || id,
        type: 'text',
        role: id === 'article' ? 'article' : 'name',
      });
      continue;
    }
    const importType: ImportColumnType =
      type === 'percent' || type === 'money' || type === 'text' || type === 'formula'
        ? (type as ImportColumnType)
        : 'number';
    columns.push({
      key: id,
      label: asString(c.label) || id,
      type: importType === 'formula' ? 'number' : importType,
      unit: c.unit ? asString(c.unit) : undefined,
      formula: type === 'formula' && c.formula ? asString(c.formula) : undefined,
    });
  }

  const rows: ImportRow[] = [];
  for (const rr of rawRows) {
    if (typeof rr !== 'object' || rr === null) continue;
    const r = rr as Record<string, unknown>;
    const values: Record<string, number | string> = {};
    const rawValues = (r.values ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(rawValues)) {
      const nv = asNumberOrString(v);
      if (nv !== null) values[k] = nv;
    }
    rows.push({
      article: asString(r.article),
      name: asString(r.name),
      values,
    });
  }

  return {
    columns,
    rows,
    source: { kind: 'block', label: asString(cfg.title) || 'Мой магазин', blockType: block.type },
  };
}

// ============================================================================
// sheet → ImportTable (cells[][] + конвертация Excel-формул)
// ============================================================================

function colLetter(i: number): string {
  let s = '';
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function colIndexFromLetter(label: string): number {
  let n = 0;
  for (let i = 0; i < label.length; i++) n = n * 26 + (label.charCodeAt(i) - 64);
  return n - 1;
}

function parseSheetNumber(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function fromSheet(block: BlockInstance): ImportTable {
  const cfg = (block.config ?? {}) as Record<string, unknown>;
  const rawCells = asArray(cfg.cells);
  const cells: string[][] = rawCells.map((row) =>
    Array.isArray(row) ? row.map((c) => asString(c)) : [],
  );
  if (cells.length === 0) {
    return { columns: [], rows: [], source: { kind: 'block', label: asString(cfg.title) || 'Таблица', blockType: block.type } };
  }
  const colCount = Math.max(...cells.map((r) => r.length));
  const headerRowIdx = 0;
  const header = cells[headerRowIdx] ?? [];

  const taken = new Set<string>();
  const letterToKey = new Map<string, string>();
  type ColMeta = { ci: number; letter: string; label: string; key: string };
  const cols: ColMeta[] = [];
  for (let ci = 0; ci < colCount; ci++) {
    const letter = colLetter(ci);
    const label = (header[ci] ?? '').trim() || `Колонка ${letter}`;
    const key = slugifyIdentifier((header[ci] ?? '').trim() || letter, taken);
    letterToKey.set(letter, key);
    cols.push({ ci, letter, label, key });
  }

  // Первая текстовая колонка → name.
  let nameCol: ColMeta | undefined;
  for (const col of cols) {
    let textRows = 0;
    for (let r = 1; r < cells.length; r++) {
      const v = cells[r]?.[col.ci] ?? '';
      if (v && !v.startsWith('=') && parseSheetNumber(v) === null) textRows++;
    }
    if (textRows > 0) {
      nameCol = col;
      break;
    }
  }

  // Тип + формула колонки.
  const importColumns: ImportColumn[] = [];
  const dataColMeta = new Map<string, { type: ImportColumnType; ci: number }>();
  for (const col of cols) {
    if (nameCol && col.ci === nameCol.ci) {
      importColumns.push({ key: col.key, label: col.label, type: 'text', role: 'name' });
      continue;
    }
    let firstFormula: { raw: string; excelRow: number } | undefined;
    let numCount = 0;
    let textCount = 0;
    for (let r = 1; r < cells.length; r++) {
      const v = cells[r]?.[col.ci] ?? '';
      if (!v) continue;
      if (v.startsWith('=')) {
        if (!firstFormula) firstFormula = { raw: v.slice(1), excelRow: r + 1 };
      } else if (parseSheetNumber(v) !== null) numCount++;
      else textCount++;
    }
    const type: ImportColumnType =
      textCount > numCount && !firstFormula ? 'text' : guessTypeFromLabel(col.label);
    let formula: string | undefined;
    if (firstFormula) {
      const conv = convertExcelFormula(
        firstFormula.raw,
        firstFormula.excelRow,
        letterToKey,
        (letter, row) => {
          const v = cells[row - 1]?.[colIndexFromLetter(letter)] ?? '';
          return v.startsWith('=') ? null : parseSheetNumber(v);
        },
      );
      if (conv.ok) formula = conv.formula;
    }
    importColumns.push({
      key: col.key,
      label: col.label,
      type: type === 'formula' ? 'number' : type,
      unit: type === 'money' ? '₽' : type === 'percent' ? '%' : undefined,
      formula,
    });
    dataColMeta.set(col.key, { type, ci: col.ci });
  }

  const rows: ImportRow[] = [];
  for (let r = 1; r < cells.length; r++) {
    const name = nameCol ? (cells[r]?.[nameCol.ci] ?? '').trim() : '';
    const values: Record<string, number | string> = {};
    let anyValue = Boolean(name);
    for (const col of cols) {
      if (nameCol && col.ci === nameCol.ci) continue;
      const v = cells[r]?.[col.ci] ?? '';
      if (!v || v.startsWith('=')) continue;
      const meta = dataColMeta.get(col.key);
      if (meta?.type === 'text') {
        values[col.key] = v;
      } else {
        const n = parseSheetNumber(v);
        if (n === null) continue;
        values[col.key] = n;
      }
      anyValue = true;
    }
    if (!anyValue) continue;
    rows.push({ article: '', name, values });
  }

  return {
    columns: importColumns,
    rows,
    source: { kind: 'block', label: asString(cfg.title) || 'Таблица', blockType: block.type },
  };
}

// ============================================================================
// custom.data → ImportTable (значения)
// ============================================================================

function fromCustomData(block: BlockInstance): ImportTable {
  const cfg = (block.config ?? {}) as Record<string, unknown>;
  const rawCols = asArray(cfg.columns);
  const rawRows = asArray(cfg.rows);

  const columns: ImportColumn[] = [];
  for (const rc of rawCols) {
    if (typeof rc !== 'object' || rc === null) continue;
    const c = rc as Record<string, unknown>;
    const id = asString(c.id);
    if (!id) continue;
    const fmt = asString(c.format);
    const type: ImportColumnType =
      fmt === 'rubles' ? 'money' : fmt === 'percent' ? 'percent' : fmt === 'text' ? 'text' : 'number';
    columns.push({
      key: id,
      label: asString(c.label) || id,
      type,
      unit: type === 'money' ? '₽' : type === 'percent' ? '%' : undefined,
    });
  }

  const rows: ImportRow[] = [];
  for (const rr of rawRows) {
    if (typeof rr !== 'object' || rr === null) continue;
    const r = rr as Record<string, unknown>;
    const cellsObj = (r.cells ?? {}) as Record<string, unknown>;
    const values: Record<string, number | string> = {};
    for (const [colId, cell] of Object.entries(cellsObj)) {
      if (typeof cell !== 'object' || cell === null) continue;
      const v = asNumberOrString((cell as Record<string, unknown>).v);
      if (v !== null) values[colId] = v;
    }
    rows.push({ article: '', name: asString(r.label), values });
  }

  return {
    columns,
    rows,
    source: { kind: 'block', label: asString(cfg.title) || 'Данные', blockType: block.type },
  };
}

// ============================================================================
// unit.ozon-multi-table → ImportTable (курируемые input-поля, значения)
// ============================================================================

const OZON_MULTI_FIELDS: Array<{ key: string; label: string; type: ImportColumnType }> = [
  { key: 'price', label: 'Цена', type: 'money' },
  { key: 'discountPct', label: 'Скидка', type: 'percent' },
  { key: 'cost', label: 'Себестоимость', type: 'money' },
  { key: 'packaging', label: 'Упаковка', type: 'money' },
  { key: 'logistics', label: 'Логистика', type: 'money' },
  { key: 'stock', label: 'Остаток', type: 'number' },
  { key: 'volumeL', label: 'Объём, л', type: 'number' },
  { key: 'commissionPct', label: 'Комиссия', type: 'percent' },
  { key: 'buyoutPct', label: 'Выкуп', type: 'percent' },
  { key: 'drrPct', label: 'ДРР', type: 'percent' },
  { key: 'salesPerMonth', label: 'Продаж/мес', type: 'number' },
];

function fromOzonMulti(block: BlockInstance): ImportTable {
  const cfg = (block.config ?? {}) as Record<string, unknown>;
  const rawRows = asArray(cfg.rows);

  // Какие поля реально присутствуют хотя бы в одной строке.
  const present = new Set<string>();
  for (const rr of rawRows) {
    if (typeof rr !== 'object' || rr === null) continue;
    const inputs = ((rr as Record<string, unknown>).inputs ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(inputs)) present.add(k);
  }

  const fields = OZON_MULTI_FIELDS.filter((f) => present.has(f.key));
  const columns: ImportColumn[] = fields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
    unit: f.type === 'money' ? '₽' : f.type === 'percent' ? '%' : undefined,
  }));

  const rows: ImportRow[] = [];
  for (const rr of rawRows) {
    if (typeof rr !== 'object' || rr === null) continue;
    const r = rr as Record<string, unknown>;
    const inputs = (r.inputs ?? {}) as Record<string, unknown>;
    const values: Record<string, number | string> = {};
    for (const f of fields) {
      const v = asNumberOrString(inputs[f.key]);
      if (v !== null) values[f.key] = v;
    }
    rows.push({ article: asString(r.article), name: asString(r.name), values });
  }

  return {
    columns,
    rows,
    source: { kind: 'block', label: asString(cfg.title) || 'Ozon · юнит-таблица', blockType: block.type },
  };
}

/** Главная функция: BlockInstance → ImportTable (или null для неподдерживаемого типа). */
export function blockToImportTable(block: BlockInstance): ImportTable | null {
  switch (block.type) {
    case 'unit.my-store-table':
      return fromMyStore(block);
    case 'sheet':
      return fromSheet(block);
    case 'custom.data':
      return fromCustomData(block);
    case 'unit.ozon-multi-table':
      return fromOzonMulti(block);
    default:
      return null;
  }
}

/** Краткая сводка источника для discovery-листинга. */
export function summarizeSource(block: BlockInstance): { columnCount: number; rowCount: number } {
  const t = blockToImportTable(block);
  if (!t) return { columnCount: 0, rowCount: 0 };
  return {
    columnCount: t.columns.filter((c) => !c.role).length,
    rowCount: t.rows.length,
  };
}
