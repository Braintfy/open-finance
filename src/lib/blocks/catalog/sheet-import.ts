// PURPOSE: CSV/XLSX import/export для sheet block. Использует papaparse для CSV
// и xlsx (sheetjs) для XLSX. Лимит — 10K ячеек для безопасности UI.
//
// Mapping:
//   - cells: string[][]  ↔ CSV rows / XLSX cells
//   - При импорте формулы сохраняются "as-is" (если ячейка начинается с '=')
//   - При экспорте формулы выгружаются как formula (XLSX) или текст с '=' (CSV)

import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export const SHEET_IMPORT_CELL_LIMIT = 10_000;

export type ImportResult =
  | { ok: true; rows: number; cols: number; cells: string[][] }
  | { ok: false; error: string };

/** Парсинг CSV-строки → cells[][]. */
export function parseCsv(text: string): ImportResult {
  if (!text || text.trim().length === 0) {
    return { ok: false, error: 'Файл пустой' };
  }
  const parsed = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    dynamicTyping: false,
  });
  if (parsed.errors && parsed.errors.length > 0) {
    return { ok: false, error: parsed.errors[0]?.message ?? 'Ошибка парсинга CSV' };
  }
  const rows = parsed.data ?? [];
  if (rows.length === 0) {
    return { ok: false, error: 'Нет данных в CSV' };
  }
  const cols = Math.max(...rows.map((r) => r.length));
  if (rows.length * cols > SHEET_IMPORT_CELL_LIMIT) {
    return {
      ok: false,
      error: `Лимит — ${SHEET_IMPORT_CELL_LIMIT} ячеек. Импортируется ${rows.length}×${cols} = ${rows.length * cols}.`,
    };
  }
  const cells: string[][] = rows.map((r) => {
    const row: string[] = [];
    for (let c = 0; c < cols; c += 1) {
      row.push(String(r[c] ?? ''));
    }
    return row;
  });
  return { ok: true, rows: rows.length, cols, cells };
}

/** Парсинг XLSX (ArrayBuffer) → cells[][]. Берёт первый лист. */
export function parseXlsx(buffer: ArrayBuffer): ImportResult {
  try {
    const wb = XLSX.read(buffer, { type: 'array', cellFormula: true });
    const firstSheetName = wb.SheetNames[0];
    if (!firstSheetName) return { ok: false, error: 'XLSX без листов' };
    const ws = wb.Sheets[firstSheetName];
    const ref = ws['!ref'];
    if (!ref) return { ok: false, error: 'Пустой лист' };
    const range = XLSX.utils.decode_range(ref);
    const rowCount = range.e.r - range.s.r + 1;
    const colCount = range.e.c - range.s.c + 1;
    if (rowCount * colCount > SHEET_IMPORT_CELL_LIMIT) {
      return {
        ok: false,
        error: `Лимит — ${SHEET_IMPORT_CELL_LIMIT} ячеек. В файле ${rowCount}×${colCount} = ${rowCount * colCount}.`,
      };
    }
    const cells: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      const row: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (!cell) {
          row.push('');
        } else if (cell.f) {
          // Excel formula — сохраняем как '=...'
          row.push(`=${cell.f}`);
        } else if (cell.v !== undefined && cell.v !== null) {
          row.push(String(cell.v));
        } else {
          row.push('');
        }
      }
      cells.push(row);
    }
    return { ok: true, rows: rowCount, cols: colCount, cells };
  } catch (err) {
    return { ok: false, error: `XLSX parse error: ${(err as Error).message}` };
  }
}

/** Сериализация cells → CSV. Формулы остаются "as-is" (=SUM(A1:A2)). */
export function exportCsv(cells: string[][]): string {
  return Papa.unparse(cells, { quotes: false });
}

/** Сериализация cells → XLSX (Uint8Array). Формулы записываются как formulas. */
export function exportXlsx(cells: string[][], sheetName = 'Sheet1'): Uint8Array {
  // Строим worksheet вручную чтобы корректно сохранить формулы.
  const ws: XLSX.WorkSheet = {};
  const rowCount = cells.length;
  const colCount = Math.max(0, ...cells.map((r) => r.length));
  for (let r = 0; r < rowCount; r += 1) {
    for (let c = 0; c < cells[r].length; c += 1) {
      const cell = cells[r][c];
      const addr = XLSX.utils.encode_cell({ r, c });
      if (typeof cell === 'string' && cell.startsWith('=')) {
        ws[addr] = { t: 'n', f: cell.slice(1), v: 0 } as XLSX.CellObject;
      } else if (cell === '' || cell === null || cell === undefined) {
        // skip empty cells (XLSX convention)
      } else {
        const num = Number(cell);
        if (Number.isFinite(num) && String(cell).trim() !== '') {
          ws[addr] = { t: 'n', v: num } as XLSX.CellObject;
        } else {
          ws[addr] = { t: 's', v: String(cell) } as XLSX.CellObject;
        }
      }
    }
  }
  if (rowCount > 0 && colCount > 0) {
    ws['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: rowCount - 1, c: colCount - 1 },
    });
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(buf);
}

/** Триггер скачивания в браузере. */
export function downloadBlob(filename: string, blob: Blob): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
