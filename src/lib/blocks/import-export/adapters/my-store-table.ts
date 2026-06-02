// PURPOSE: XLSX-адаптер для `unit.my-store-table`. Identity-колонки
// (`article`, `name`) + пользовательские. Cell.f используется для формул.
// Bindings (ссылки на другие блоки) в XLSX не сохраняются — при импорте
// они зачищаются (см. refs-scrubber).

import * as XLSX from 'xlsx';
import type { BlockDef, BlockInstance } from '../../types';
import {
  buildWorkbook,
  metaFromSheet,
  metaToSheet,
  readWorkbook,
  XLSX_CELL_LIMIT,
} from '../xlsx-utils';
import { buildJsonPayload, buildJsonPreview } from '../json-adapter';
import { blockHasUserData, scrubCrossRefs } from '../refs-scrubber';
import { containsAtRef, substituteAtRefs } from '../formula-utils';
import type {
  BlockImportExportAdapter,
  ExportXlsxOptions,
  ImportPreview,
} from '../types';

const IDENTITY_ARTICLE_ID = 'article';
const IDENTITY_NAME_ID = 'name';

/**
 * Резолвит значение `UnitCellBinding`-подобной структуры через `liveValues`.
 * Возвращает `number | null`. Не используем `resolveBindingValue` из
 * `@/lib/unit-economics/bindings` чтобы не тащить runtime-зависимость в
 * import-export модуль (адаптер должен быть портативным).
 */
function resolveBinding(
  binding: unknown,
  liveValues: Record<string, number | string | null> | undefined,
): number | null {
  if (!binding || typeof binding !== 'object') return null;
  const b = binding as {
    mode?: string;
    ref?: { blockId?: string; field?: string; pageKey?: string };
    fallbackValue?: unknown;
  };
  if (b.mode !== 'block_ref' || !b.ref?.blockId) {
    return typeof b.fallbackValue === 'number' ? b.fallbackValue : null;
  }
  if (!liveValues) return null;
  const field = b.ref.field ?? 'value';
  const blockId = b.ref.blockId;
  const pageKey = b.ref.pageKey;
  // Совпадает с conventions из bindings.ts/use-live-block-values.ts:
  //   field === 'value' → ключ = blockId (или pageKey:blockId)
  //   иначе              → ключ = blockId.field (или pageKey:blockId.field)
  const base = field === 'value' ? blockId : `${blockId}.${field}`;
  const key = pageKey ? `${pageKey}:${base}` : base;
  const v = liveValues[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const num = Number(v.replace(',', '.'));
    if (Number.isFinite(num)) return num;
  }
  return typeof b.fallbackValue === 'number' ? b.fallbackValue : null;
}

type RawColumn = {
  id: string;
  label: string;
  type?: string;
  unit?: string;
  default?: number | string;
  width?: number;
  formula?: string;
  hidden?: boolean;
  decimals?: number;
};

type RawRow = {
  id: string;
  article: string;
  name: string;
  values: Record<string, unknown>;
  bindings: Record<string, unknown>;
};

const COLUMN_TYPES = new Set(['number', 'percent', 'money', 'text', 'formula', 'identity']);

function makeId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function readCfg(instance: BlockInstance): Record<string, unknown> {
  return (instance.config ?? {}) as Record<string, unknown>;
}

function exportXlsx(
  instance: BlockInstance,
  _def: BlockDef,
  opts?: ExportXlsxOptions,
): Uint8Array {
  const cfg = readCfg(instance);
  const columns = Array.isArray(cfg.columns) ? (cfg.columns as RawColumn[]) : [];
  const rows = Array.isArray(cfg.rows) ? (cfg.rows as RawRow[]) : [];
  const liveValues = opts?.liveValues;

  // Колонки в порядке: identity, остальные. Identity-колонки имеют type === 'identity'.
  const visibleColumns = columns.filter((c) => !c.hidden);

  const headerRow: string[] = visibleColumns.map((c) => c.label || c.id);
  const aoa: unknown[][] = [headerRow];

  for (const row of rows) {
    const tuple: unknown[] = [];
    for (const col of visibleColumns) {
      if (col.id === IDENTITY_ARTICLE_ID) {
        tuple.push(row.article ?? '');
        continue;
      }
      if (col.id === IDENTITY_NAME_ID) {
        tuple.push(row.name ?? '');
        continue;
      }
      // Formula-колонка: per-cell override в row.values (Excel-режим, v0.39.0)
      // ИМЕЕТ приоритет над общей col.formula. Без override — берём col.formula.
      if (col.type === 'formula') {
        const override = row.values?.[col.id];
        if (typeof override === 'string' && override.startsWith('=')) {
          const body = override.slice(1);
          const out = containsAtRef(body) ? substituteAtRefs(body, liveValues).result : body;
          tuple.push({ __formula: out });
        } else if (typeof override === 'number') {
          tuple.push(override); // жёсткий литерал-override ячейки
        } else if (typeof override === 'string' && override.trim() !== '') {
          tuple.push(override);
        } else if (typeof col.formula === 'string' && col.formula.trim() !== '') {
          const body = col.formula.startsWith('=') ? col.formula.slice(1) : col.formula;
          // Подставляем @-refs (формула может содержать `@blockId.field`).
          const out = containsAtRef(body) ? substituteAtRefs(body, liveValues).result : body;
          tuple.push({ __formula: out });
        } else {
          tuple.push('');
        }
        continue;
      }
      // 1) Если у ячейки есть binding на другой блок — берём resolved value
      //    из liveValues и пишем как НАСТОЯЩЕЕ ЧИСЛО (не формулу с @-ref).
      //    Без liveValues binding не резолвится → пустая ячейка.
      const binding = row.bindings?.[col.id];
      if (binding && typeof binding === 'object') {
        const resolved = resolveBinding(binding, liveValues);
        tuple.push(resolved !== null ? resolved : '');
        continue;
      }
      // 2) Сырое значение из values — может быть число, текст или формула.
      const v = row.values?.[col.id];
      if (v === null || v === undefined) {
        tuple.push('');
      } else if (typeof v === 'string' && v.startsWith('=')) {
        // 2a) Если формула содержит @-ref — подставляем числовое значение.
        //     Excel не понимает `@blockId.field`.
        const body = v.slice(1);
        const out = containsAtRef(body) ? substituteAtRefs(body, liveValues).result : body;
        tuple.push({ __formula: out });
      } else {
        tuple.push(v);
      }
    }
    aoa.push(tuple);
  }

  const ws: XLSX.WorkSheet = {};
  let maxCol = 0;
  for (let r = 0; r < aoa.length; r += 1) {
    const row = aoa[r] ?? [];
    if (row.length > maxCol) maxCol = row.length;
    for (let c = 0; c < row.length; c += 1) {
      const val = row[c];
      const addr = XLSX.utils.encode_cell({ r, c });
      if (val === '' || val === null || val === undefined) continue;
      if (typeof val === 'object' && val !== null && '__formula' in val) {
        ws[addr] = {
          t: 'n',
          f: (val as { __formula: string }).__formula,
          v: 0,
        } as XLSX.CellObject;
      } else if (typeof val === 'number') {
        ws[addr] = { t: 'n', v: val } as XLSX.CellObject;
      } else {
        ws[addr] = { t: 's', v: String(val) } as XLSX.CellObject;
      }
    }
  }
  if (aoa.length > 0 && maxCol > 0) {
    ws['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: aoa.length - 1, c: maxCol - 1 },
    });
  }

  const meta: Record<string, unknown> = {
    title: cfg.title ?? 'Мой магазин',
    global: cfg.global ?? { vatPct: 0 },
    decimals: cfg.decimals ?? null,
    columns: visibleColumns.map((c) => ({
      id: c.id,
      label: c.label,
      type: c.type ?? 'number',
      unit: c.unit,
      width: c.width,
      formula: c.formula,
      default: c.default,
      decimals: c.decimals,
    })),
    pinnedColumns: cfg.pinnedColumns ?? [IDENTITY_ARTICLE_ID, IDENTITY_NAME_ID],
  };

  return buildWorkbook([
    { name: 'Data', ws },
    { name: '_meta', ws: metaToSheet(meta) },
  ]);
}

function importXlsx(buffer: ArrayBuffer, current: BlockInstance): ImportPreview {
  let wb: XLSX.WorkBook;
  try {
    wb = readWorkbook(buffer);
  } catch (err) {
    return { ok: false, error: `Не удалось прочитать XLSX: ${(err as Error).message}` };
  }
  const dataSheet = wb.Sheets[wb.SheetNames[0] ?? ''];
  if (!dataSheet) return { ok: false, error: 'В файле нет листов' };

  const ref = dataSheet['!ref'];
  if (!ref) return { ok: false, error: 'Первый лист пустой' };

  const range = XLSX.utils.decode_range(ref);
  const rowCount = range.e.r - range.s.r + 1;
  const colCount = range.e.c - range.s.c + 1;
  if (rowCount * colCount > XLSX_CELL_LIMIT) {
    return {
      ok: false,
      error: `Лимит — ${XLSX_CELL_LIMIT} ячеек, в файле ${rowCount}×${colCount}.`,
    };
  }

  // Парсим header row
  const headerLabels: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const cell = dataSheet[addr] as XLSX.CellObject | undefined;
    headerLabels.push(cell?.v !== undefined && cell?.v !== null ? String(cell.v) : '');
  }
  if (headerLabels.length === 0) {
    return { ok: false, error: 'Не удалось прочитать заголовки таблицы' };
  }

  // Парсим _meta
  const meta = metaFromSheet(wb.Sheets['_meta']);
  const metaCols = Array.isArray(meta.columns) ? (meta.columns as Array<Record<string, unknown>>) : [];

  // Мапим header labels → columns. Identity-колонки распознаём по label
  // («Артикул»/«Название товара»/«Article»/«Name») или по meta.id.
  const columns: RawColumn[] = [];
  for (let i = 0; i < headerLabels.length; i += 1) {
    const label = headerLabels[i] || `Колонка ${i + 1}`;
    const metaMatch =
      metaCols.find((mc) => mc.label === label) ?? metaCols[i];

    let id: string;
    let type = 'number';
    if (metaMatch && typeof metaMatch.id === 'string') {
      id = metaMatch.id;
      if (typeof metaMatch.type === 'string' && COLUMN_TYPES.has(metaMatch.type)) {
        type = metaMatch.type;
      }
    } else if (/артикул|article/i.test(label)) {
      id = IDENTITY_ARTICLE_ID;
      type = 'identity';
    } else if (/название|name/i.test(label) && i < 3) {
      id = IDENTITY_NAME_ID;
      type = 'identity';
    } else {
      id = makeId('col');
    }

    const col: RawColumn = {
      id,
      label,
      type,
    };
    if (metaMatch && typeof metaMatch.unit === 'string') col.unit = metaMatch.unit;
    if (metaMatch && typeof metaMatch.width === 'number') col.width = metaMatch.width;
    if (metaMatch && typeof metaMatch.formula === 'string') col.formula = metaMatch.formula;
    if (metaMatch && (typeof metaMatch.default === 'number' || typeof metaMatch.default === 'string')) {
      col.default = metaMatch.default;
    }
    if (metaMatch && typeof metaMatch.decimals === 'number') col.decimals = metaMatch.decimals;
    columns.push(col);
  }

  // Парсим data rows
  const rows: RawRow[] = [];
  let formulaCount = 0;
  let nonEmptyCells = 0;
  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const row: RawRow = {
      id: makeId('row'),
      article: '',
      name: '',
      values: {},
      bindings: {},
    };
    for (let i = 0; i < columns.length; i += 1) {
      const c = range.s.c + i;
      if (c > range.e.c) break;
      const col = columns[i];
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = dataSheet[addr] as XLSX.CellObject | undefined;
      if (!cell) continue;
      if (col.id === IDENTITY_ARTICLE_ID) {
        row.article = String(cell.v ?? '');
        nonEmptyCells += row.article ? 1 : 0;
        continue;
      }
      if (col.id === IDENTITY_NAME_ID) {
        row.name = String(cell.v ?? '');
        nonEmptyCells += row.name ? 1 : 0;
        continue;
      }
      // Formula-колонки берут общую формулу из col.formula — индивидуальные
      // значения в строках пропускаем.
      if (col.type === 'formula') continue;
      if (cell.f) {
        row.values[col.id] = `=${cell.f}`;
        formulaCount += 1;
        nonEmptyCells += 1;
      } else if (cell.v !== undefined && cell.v !== null) {
        row.values[col.id] = typeof cell.v === 'number' ? cell.v : String(cell.v);
        nonEmptyCells += 1;
      }
    }
    rows.push(row);
  }

  // Гарантируем, что identity-колонки есть в начале
  if (!columns.some((c) => c.id === IDENTITY_ARTICLE_ID)) {
    columns.unshift({ id: IDENTITY_ARTICLE_ID, label: 'Артикул', type: 'identity', width: 110 });
  }
  if (!columns.some((c) => c.id === IDENTITY_NAME_ID)) {
    const idx = columns.findIndex((c) => c.id === IDENTITY_ARTICLE_ID);
    columns.splice(idx + 1, 0, { id: IDENTITY_NAME_ID, label: 'Название товара', type: 'identity', width: 220 });
  }

  const newCfg: Record<string, unknown> = {
    title: typeof meta.title === 'string' ? meta.title : 'Мой магазин',
    global: typeof meta.global === 'object' && meta.global !== null ? meta.global : { vatPct: 0 },
    decimals: typeof meta.decimals === 'number' ? meta.decimals : null,
    columns,
    rows,
    pinnedColumns: Array.isArray(meta.pinnedColumns)
      ? meta.pinnedColumns
      : [IDENTITY_ARTICLE_ID, IDENTITY_NAME_ID],
  };

  const scrub = scrubCrossRefs(newCfg, undefined);

  // Merge: добавить новые строки в конец, колонки merge по id+label.
  const currentCfg = readCfg(current);
  const currentRows = Array.isArray(currentCfg.rows) ? (currentCfg.rows as RawRow[]) : [];
  const currentColumns = Array.isArray(currentCfg.columns) ? (currentCfg.columns as RawColumn[]) : [];
  const existingColIds = new Set(currentColumns.map((c) => c.id));
  const mergedColumns = [
    ...currentColumns,
    ...columns.filter((c) => !existingColIds.has(c.id) && c.type !== 'identity'),
  ];
  const mergeCfg: Record<string, unknown> = {
    ...currentCfg,
    columns: mergedColumns,
    rows: [...currentRows, ...rows],
  };

  return {
    ok: true,
    stats: [
      { label: 'Колонок', value: String(columns.length) },
      { label: 'Строк', value: String(rows.length) },
      { label: 'Непустых', value: String(nonEmptyCells) },
      { label: 'Формул', value: String(formulaCount) },
    ],
    scrubbedRefs: scrub.scrubbed,
    hasExistingData: blockHasUserData(current),
    patch: {
      config: scrub.config,
      dependencies: undefined,
    },
    canMerge: currentRows.length > 0,
    mergePatch: { config: mergeCfg },
  };
}

export const myStoreTableAdapter: BlockImportExportAdapter = {
  type: 'unit.my-store-table',
  supportsXlsx: true,
  exportJson: buildJsonPayload,
  importJson: buildJsonPreview,
  exportXlsx,
  importXlsx,
};
