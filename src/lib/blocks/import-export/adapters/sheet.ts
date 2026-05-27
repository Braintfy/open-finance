// PURPOSE: XLSX-адаптер для `sheet` блока. Экспортирует cells (2D массив с
// формулами) на лист `Data`, header-ячейки на лист `Header`, а служебные
// настройки — на `_meta`. Импорт читает все три листа.

import * as XLSX from 'xlsx';
import type { BlockDef, BlockInstance } from '../../types';
import {
  buildWorkbook,
  cellsMatrixToSheet,
  metaFromSheet,
  metaToSheet,
  readWorkbook,
  sheetToCellsMatrix,
  XLSX_CELL_LIMIT,
} from '../xlsx-utils';
import { buildJsonPayload, buildJsonPreview } from '../json-adapter';
import { scrubCrossRefs, blockHasUserData } from '../refs-scrubber';
import { containsAtRef, isFormulaString, substituteAtRefs } from '../formula-utils';
import type {
  BlockImportExportAdapter,
  ExportXlsxOptions,
  ImportPreview,
} from '../types';

function readSheetConfig(instance: BlockInstance): Record<string, unknown> {
  return (instance.config ?? {}) as Record<string, unknown>;
}

/**
 * Подставляет @-refs в формулах внутри cells 2D-матрицы. Возвращает копию
 * матрицы с заменёнными формулами. Источник значений — `cfg.blockRefs`
 * (snapshot из конфига) + `opts.liveValues` (runtime).
 *
 * Sheet-A1 = Excel-A1, поэтому shiftA1Addresses не вызываем.
 */
function preprocessCellsForExport(
  cells: string[][],
  cfg: Record<string, unknown>,
  liveValues: Record<string, number | string | null> | undefined,
): string[][] {
  const snapshot = (cfg.blockRefs ?? {}) as Record<string, number | string | null>;
  // Объединяем: live > snapshot (live store актуальнее, как и в render-path).
  const merged: Record<string, number | string | null> = { ...snapshot, ...(liveValues ?? {}) };
  return cells.map((row) =>
    row.map((cell) => {
      if (!isFormulaString(cell)) return cell;
      if (!containsAtRef(cell)) return cell;
      const sub = substituteAtRefs(cell.slice(1), merged);
      return `=${sub.result}`;
    }),
  );
}

function exportXlsx(
  instance: BlockInstance,
  _def: BlockDef,
  opts?: ExportXlsxOptions,
): Uint8Array {
  const cfg = readSheetConfig(instance);
  const rawCells = Array.isArray(cfg.cells) ? (cfg.cells as string[][]) : [];
  const cells = preprocessCellsForExport(rawCells, cfg, opts?.liveValues);
  const dataSheet = cellsMatrixToSheet(cells);

  const headerCells = Array.isArray(cfg.headerCells)
    ? (cfg.headerCells as Array<Record<string, unknown>>)
    : [];
  const headerRows: Array<[string, string, number | string]> = [['label', 'value', 'width']];
  for (const hc of headerCells) {
    headerRows.push([
      String(hc.label ?? ''),
      String(hc.value ?? ''),
      typeof hc.width === 'number' ? hc.width : '',
    ]);
  }
  const headerSheet = XLSX.utils.aoa_to_sheet(headerRows);

  const meta: Record<string, unknown> = {
    title: cfg.title ?? 'Таблица',
    rows: cfg.rows ?? cells.length,
    cols: cfg.cols ?? (cells[0]?.length ?? 0),
    colWidths: cfg.colWidths ?? [],
    rowHeights: cfg.rowHeights ?? [],
    showHeader: cfg.showHeader ?? true,
    showFormulaBar: cfg.showFormulaBar ?? true,
    showKopecks: cfg.showKopecks ?? null,
    rowHighlights: cfg.rowHighlights ?? {},
    colHighlights: cfg.colHighlights ?? {},
  };

  return buildWorkbook([
    { name: 'Data', ws: dataSheet },
    { name: 'Header', ws: headerSheet },
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
  const matrix = sheetToCellsMatrix(dataSheet);
  if (!matrix) return { ok: false, error: 'Первый лист пустой' };
  if (matrix.rows * matrix.cols > XLSX_CELL_LIMIT) {
    return {
      ok: false,
      error: `Лимит — ${XLSX_CELL_LIMIT} ячеек, в файле ${matrix.rows}×${matrix.cols} = ${matrix.rows * matrix.cols}.`,
    };
  }

  // Header-ячейки (опциональный лист)
  const headerSheet = wb.Sheets['Header'];
  const headerCells: Array<Record<string, unknown>> = [];
  if (headerSheet) {
    const rows = XLSX.utils.sheet_to_json<{ label?: string; value?: string; width?: string | number }>(headerSheet, { defval: '' });
    for (const row of rows) {
      const widthRaw = row.width;
      let width: number | undefined;
      if (typeof widthRaw === 'number') width = widthRaw;
      else if (typeof widthRaw === 'string' && widthRaw.trim() !== '') {
        const parsed = Number(widthRaw);
        if (Number.isFinite(parsed) && parsed > 0) width = parsed;
      }
      headerCells.push({
        id: `hc_${headerCells.length}_${Math.random().toString(36).slice(2, 8)}`,
        label: String(row.label ?? ''),
        value: String(row.value ?? ''),
        width,
      });
    }
  }

  const meta = metaFromSheet(wb.Sheets['_meta']);

  // Считаем формулы для статистики
  let formulaCount = 0;
  let nonEmptyCells = 0;
  for (const row of matrix.cells) {
    for (const cell of row) {
      if (cell === '' || cell === null || cell === undefined) continue;
      nonEmptyCells += 1;
      if (typeof cell === 'string' && cell.startsWith('=')) formulaCount += 1;
    }
  }

  const newCfg: Record<string, unknown> = {
    title: typeof meta.title === 'string' ? meta.title : (current.config as Record<string, unknown>)?.title ?? 'Таблица',
    rows: typeof meta.rows === 'number' ? meta.rows : matrix.rows,
    cols: typeof meta.cols === 'number' ? meta.cols : matrix.cols,
    cells: matrix.cells,
    colWidths: Array.isArray(meta.colWidths) ? meta.colWidths : undefined,
    rowHeights: Array.isArray(meta.rowHeights) ? meta.rowHeights : undefined,
    headerCells: headerCells.length > 0 ? headerCells : undefined,
    showHeader: typeof meta.showHeader === 'boolean' ? meta.showHeader : true,
    showFormulaBar: typeof meta.showFormulaBar === 'boolean' ? meta.showFormulaBar : true,
    showKopecks:
      meta.showKopecks === true || meta.showKopecks === false ? meta.showKopecks : null,
    rowHighlights: typeof meta.rowHighlights === 'object' && meta.rowHighlights !== null ? meta.rowHighlights : {},
    colHighlights: typeof meta.colHighlights === 'object' && meta.colHighlights !== null ? meta.colHighlights : {},
  };

  // XLSX-импорт по построению не имеет ни blockRefs, ни dependencies — но
  // мы всё равно прогоняем scrubber, чтобы preview был унифицированный.
  const scrub = scrubCrossRefs(newCfg, undefined);

  return {
    ok: true,
    stats: [
      { label: 'Ячеек', value: `${matrix.rows}×${matrix.cols}` },
      { label: 'Непустых', value: String(nonEmptyCells) },
      { label: 'Формул', value: String(formulaCount) },
      { label: 'Header', value: String(headerCells.length) },
    ],
    scrubbedRefs: scrub.scrubbed,
    hasExistingData: blockHasUserData(current),
    patch: {
      config: scrub.config,
      dependencies: undefined,
    },
    canMerge: false,
  };
}

export const sheetAdapter: BlockImportExportAdapter = {
  type: 'sheet',
  supportsXlsx: true,
  exportJson: buildJsonPayload,
  importJson: buildJsonPreview,
  exportXlsx,
  importXlsx,
};
