// PURPOSE: XLSX-адаптер для `custom.data` блока. Экспортирует:
//   - Лист `Data`: header row = column labels, rows = row.label + cell values.
//                  Формулы хранятся как `=...` (cell.f).
//   - Лист `_meta`: columns config (id, label, format, highlight, showKopecks),
//                  publishMode, publishColumnId, blockShowKopecks, labelColumnWidth.
// Импорт восстанавливает структуру по label-маппингу (генерируются новые id).

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
import type { BlockImportExportAdapter, ImportPreview } from '../types';

type RawColumn = {
  id: string;
  label: string;
  format?: string;
  width?: number;
  publish?: boolean;
  highlight?: string | null;
  showKopecks?: boolean | null;
};

type RawRow = {
  id: string;
  label: string;
  cells: Record<string, { v: number | string | null; ref?: string; isMoney?: boolean }>;
  highlight?: string | null;
  showKopecks?: boolean | null;
};

const COLUMN_FORMATS = new Set(['rubles', 'number', 'percent', 'text']);

function makeId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function readCfg(instance: BlockInstance): Record<string, unknown> {
  return (instance.config ?? {}) as Record<string, unknown>;
}

function exportXlsx(instance: BlockInstance, _def: BlockDef): Uint8Array {
  const cfg = readCfg(instance);
  const columns = Array.isArray(cfg.columns) ? (cfg.columns as RawColumn[]) : [];
  const rows = Array.isArray(cfg.rows) ? (cfg.rows as RawRow[]) : [];

  // Header row: первая колонка = «Строка» (row label), остальные — column labels
  const headers: string[] = ['Строка', ...columns.map((c) => c.label || c.id)];
  const aoa: unknown[][] = [headers];

  for (const row of rows) {
    const tuple: unknown[] = [row.label ?? ''];
    for (const col of columns) {
      const cell = row.cells?.[col.id];
      if (!cell || cell.v === null || cell.v === undefined) {
        tuple.push('');
        continue;
      }
      const v = cell.v;
      if (typeof v === 'string' && v.startsWith('=')) {
        // Формула — пишется через cell.f. Создадим спец-объект.
        tuple.push({ __formula: v.slice(1) });
      } else {
        tuple.push(v);
      }
    }
    aoa.push(tuple);
  }

  // Сборка worksheet вручную, чтобы корректно обработать formula-маркеры.
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
    columns: columns.map((c) => ({
      id: c.id,
      label: c.label,
      format: c.format ?? 'rubles',
      width: c.width,
      publish: c.publish ?? true,
      highlight: c.highlight ?? null,
      showKopecks: c.showKopecks ?? null,
    })),
    publishMode: cfg.publishMode ?? 'sum',
    publishColumnId: cfg.publishColumnId,
    showKopecks: cfg.showKopecks ?? null,
    labelColumnWidth: cfg.labelColumnWidth,
    rowHighlights: rows
      .filter((r) => r.highlight)
      .map((r) => ({ id: r.id, highlight: r.highlight })),
    rowShowKopecks: rows
      .filter((r) => r.showKopecks === true || r.showKopecks === false)
      .map((r) => ({ id: r.id, showKopecks: r.showKopecks })),
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

  // Первая колонка — row label (Строка), но если она не подписана как 'Строка'
  // — всё равно считаем её label-колонкой для совместимости.
  const userColumnLabels = headerLabels.slice(1);

  // Восстанавливаем columns из _meta (если есть)
  const meta = metaFromSheet(wb.Sheets['_meta']);
  const metaCols = Array.isArray(meta.columns) ? (meta.columns as Array<Record<string, unknown>>) : [];

  // Маппим columns: для каждого header label ищем match в meta.columns по label.
  // Если нет — создаём новую колонку с дефолтным форматом.
  const columns: RawColumn[] = [];
  for (let i = 0; i < userColumnLabels.length; i += 1) {
    const label = userColumnLabels[i] || `Колонка ${i + 1}`;
    const metaMatch = metaCols.find((mc) => mc.label === label);
    const fmt = metaMatch && typeof metaMatch.format === 'string' && COLUMN_FORMATS.has(metaMatch.format)
      ? (metaMatch.format as string)
      : 'rubles';
    const id = (metaMatch && typeof metaMatch.id === 'string' ? metaMatch.id : null) ?? makeId('col');
    const col: RawColumn = {
      id,
      label,
      format: fmt,
      publish: metaMatch?.publish !== false,
    };
    if (metaMatch && typeof metaMatch.width === 'number') col.width = metaMatch.width;
    if (metaMatch && typeof metaMatch.highlight === 'string') col.highlight = metaMatch.highlight;
    if (
      metaMatch &&
      (metaMatch.showKopecks === true || metaMatch.showKopecks === false || metaMatch.showKopecks === null)
    ) {
      col.showKopecks = metaMatch.showKopecks;
    }
    columns.push(col);
  }

  // Парсим data rows
  const rows: RawRow[] = [];
  let formulaCount = 0;
  let nonEmptyCells = 0;
  const rowHighlightsMap = new Map<string, string>();
  const rowShowKopecksMap = new Map<string, boolean | null>();
  if (Array.isArray(meta.rowHighlights)) {
    for (const item of meta.rowHighlights as Array<Record<string, unknown>>) {
      if (typeof item.id === 'string' && typeof item.highlight === 'string') {
        rowHighlightsMap.set(item.id, item.highlight);
      }
    }
  }
  if (Array.isArray(meta.rowShowKopecks)) {
    for (const item of meta.rowShowKopecks as Array<Record<string, unknown>>) {
      if (typeof item.id === 'string' && (typeof item.showKopecks === 'boolean' || item.showKopecks === null)) {
        rowShowKopecksMap.set(item.id, item.showKopecks);
      }
    }
  }

  for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
    const labelAddr = XLSX.utils.encode_cell({ r, c: range.s.c });
    const labelCell = dataSheet[labelAddr] as XLSX.CellObject | undefined;
    const rowLabel = labelCell?.v !== undefined && labelCell?.v !== null ? String(labelCell.v) : '';

    const cells: RawRow['cells'] = {};
    for (let i = 0; i < columns.length; i += 1) {
      const c = range.s.c + 1 + i;
      if (c > range.e.c) break;
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = dataSheet[addr] as XLSX.CellObject | undefined;
      if (!cell) continue;
      let value: number | string | null = null;
      if (cell.f) {
        value = `=${cell.f}`;
        formulaCount += 1;
      } else if (cell.v !== undefined && cell.v !== null) {
        if (typeof cell.v === 'number') value = cell.v;
        else value = String(cell.v);
      }
      if (value !== null && value !== '') {
        cells[columns[i].id] = { v: value };
        nonEmptyCells += 1;
      }
    }
    const newRowId = makeId('row');
    const row: RawRow = { id: newRowId, label: rowLabel, cells };
    // Highlights/showKopecks по построению маппятся через старые id, которые
    // больше не существуют — для XLSX-импорта это всё равно теряется.
    // Оставлено в meta для будущих расширений (например прямой ID-маппинг).
    rows.push(row);
  }

  const newCfg: Record<string, unknown> = {
    columns,
    rows,
    publishMode: typeof meta.publishMode === 'string' ? meta.publishMode : 'sum',
    publishColumnId:
      typeof meta.publishColumnId === 'string' && columns.some((c) => c.id === meta.publishColumnId)
        ? meta.publishColumnId
        : columns[0]?.id,
    showKopecks:
      meta.showKopecks === true || meta.showKopecks === false ? meta.showKopecks : null,
    labelColumnWidth: typeof meta.labelColumnWidth === 'number' ? meta.labelColumnWidth : undefined,
  };

  const scrub = scrubCrossRefs(newCfg, undefined);

  // Merge patch: добавляем новые rows в конец существующих, columns merge по label.
  const currentCfg = readCfg(current);
  const currentColumns = Array.isArray(currentCfg.columns) ? (currentCfg.columns as RawColumn[]) : [];
  const currentRows = Array.isArray(currentCfg.rows) ? (currentCfg.rows as RawRow[]) : [];

  // Маппим импортированные колонки на существующие (по label). Для новых
  // колонок добавляем их в конец. Cells перепривязываем к существующим id.
  const labelToExistingId = new Map<string, string>();
  for (const col of currentColumns) {
    labelToExistingId.set(col.label, col.id);
  }
  const mergedColumns: RawColumn[] = [...currentColumns];
  const colIdRemap = new Map<string, string>();
  for (const col of columns) {
    const existingId = labelToExistingId.get(col.label);
    if (existingId) {
      colIdRemap.set(col.id, existingId);
    } else {
      mergedColumns.push(col);
    }
  }
  const remappedRows: RawRow[] = rows.map((r) => {
    const cells: RawRow['cells'] = {};
    for (const [colId, cell] of Object.entries(r.cells)) {
      const targetColId = colIdRemap.get(colId) ?? colId;
      cells[targetColId] = cell;
    }
    return { ...r, cells };
  });
  const mergeCfg: Record<string, unknown> = {
    ...currentCfg,
    columns: mergedColumns,
    rows: [...currentRows, ...remappedRows],
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
    canMerge: currentRows.length > 0 || currentColumns.length > 0,
    mergePatch: {
      config: mergeCfg,
    },
  };
}

export const customDataAdapter: BlockImportExportAdapter = {
  type: 'custom.data',
  supportsXlsx: true,
  exportJson: buildJsonPayload,
  importJson: buildJsonPreview,
  exportXlsx,
  importXlsx,
};
