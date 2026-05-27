// PURPOSE: Shared XLSX helpers для всех адаптеров. Чтобы не дублировать
// boilerplate работы со sheetjs (cellFormula option, meta-листы, безопасные
// преобразования значений).

import * as XLSX from 'xlsx';

/** Универсальный лимит ячеек (как в `sheet-import.ts`). */
export const XLSX_CELL_LIMIT = 10_000;

/** Парсит ArrayBuffer как XLSX с включёнными формулами. */
export function readWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: 'array', cellFormula: true });
}

/** Конвертирует лист в матрицу строк (формулы префиксируются `=`). */
export function sheetToCellsMatrix(ws: XLSX.WorkSheet): { rows: number; cols: number; cells: string[][] } | null {
  const ref = ws['!ref'];
  if (!ref) return null;
  const range = XLSX.utils.decode_range(ref);
  const rowCount = range.e.r - range.s.r + 1;
  const colCount = range.e.c - range.s.c + 1;
  const cells: string[][] = [];
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    const row: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr] as XLSX.CellObject | undefined;
      if (!cell) {
        row.push('');
      } else if (cell.f) {
        row.push(`=${cell.f}`);
      } else if (cell.v !== undefined && cell.v !== null) {
        row.push(String(cell.v));
      } else {
        row.push('');
      }
    }
    cells.push(row);
  }
  return { rows: rowCount, cols: colCount, cells };
}

/** Конвертирует лист в массив объектов (header row = ключи). */
export function sheetToObjects(ws: XLSX.WorkSheet): Array<Record<string, unknown>> {
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '', raw: false });
}

/** Конвертирует cells[][] обратно в worksheet (формулы из `=...` → cell.f). */
export function cellsMatrixToSheet(cells: string[][]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  const rowCount = cells.length;
  let maxCol = 0;
  for (let r = 0; r < rowCount; r += 1) {
    const row = cells[r] ?? [];
    if (row.length > maxCol) maxCol = row.length;
    for (let c = 0; c < row.length; c += 1) {
      const val = row[c];
      const addr = XLSX.utils.encode_cell({ r, c });
      if (typeof val === 'string' && val.startsWith('=')) {
        ws[addr] = { t: 'n', f: val.slice(1), v: 0 } as XLSX.CellObject;
      } else if (val === '' || val === null || val === undefined) {
        // skip empty
      } else {
        const num = Number(val);
        if (Number.isFinite(num) && String(val).trim() !== '' && !/^[\s+-]*$/.test(String(val))) {
          ws[addr] = { t: 'n', v: num } as XLSX.CellObject;
        } else {
          ws[addr] = { t: 's', v: String(val) } as XLSX.CellObject;
        }
      }
    }
  }
  if (rowCount > 0 && maxCol > 0) {
    ws['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: rowCount - 1, c: maxCol - 1 },
    });
  }
  return ws;
}

/** Создаёт meta-лист из плоского объекта (key/value pairs). */
export function metaToSheet(meta: Record<string, unknown>): XLSX.WorkSheet {
  const rows: Array<[string, string]> = [['key', 'value']];
  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue;
    const serialised =
      typeof value === 'string' ? value : JSON.stringify(value);
    rows.push([key, serialised]);
  }
  return XLSX.utils.aoa_to_sheet(rows);
}

/** Парсит meta-лист в объект. value автоматически JSON.parse() если возможно. */
export function metaFromSheet(ws: XLSX.WorkSheet | undefined): Record<string, unknown> {
  if (!ws) return {};
  const rows = XLSX.utils.sheet_to_json<{ key?: string; value?: string }>(ws, { defval: '' });
  const out: Record<string, unknown> = {};
  for (const row of rows) {
    const key = (row.key ?? '').trim();
    if (!key) continue;
    const raw = row.value ?? '';
    if (typeof raw !== 'string') {
      out[key] = raw;
      continue;
    }
    // Попытка распарсить JSON, иначе строка
    const trimmed = raw.trim();
    if (
      trimmed.startsWith('{') ||
      trimmed.startsWith('[') ||
      trimmed === 'true' ||
      trimmed === 'false' ||
      trimmed === 'null' ||
      /^-?\d+(\.\d+)?$/.test(trimmed)
    ) {
      try {
        out[key] = JSON.parse(trimmed);
        continue;
      } catch {
        // fallback
      }
    }
    out[key] = raw;
  }
  return out;
}

/** Создаёт workbook с одним или несколькими листами. */
export function buildWorkbook(sheets: Array<{ name: string; ws: XLSX.WorkSheet }>): Uint8Array {
  const wb = XLSX.utils.book_new();
  for (const { name, ws } of sheets) {
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(buf);
}

/** Safe filename helper. */
export function safeFilename(title: string, fallback: string): string {
  const cleaned = title.replace(/[^a-zA-Z0-9\u0400-\u04FFа-яА-Я_-]+/g, '_');
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Триггер скачивания blob в браузере. */
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
