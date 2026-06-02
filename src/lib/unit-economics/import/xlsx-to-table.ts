// PURPOSE: Парсинг XLSX → нормализованная ImportTable для умного импорта в блок
// «Мой магазин · таблица». Детект строки заголовков (с учётом пустых ячеек),
// генерация стабильных id колонок, детект типа (формула/процент/деньги/число/текст),
// конвертация Excel-формул (ссылки ячеек той же строки → key колонок, обработка `%`).
//
// runtime: используется и на сервере (Node), и потенциально в браузере (sheetjs
// работает в обоих). Импортируется только из server route и из модалки.

import * as XLSX from 'xlsx';
import {
  convertExcelFormula,
  guessTypeFromLabel,
  slugifyIdentifier,
  type ImportColumn,
  type ImportColumnType,
  type ImportRow,
  type ImportTable,
} from '../table-import';

export type XlsxParseResult =
  | { ok: true; table: ImportTable; sheetNames: string[] }
  | { ok: false; error: string };

const MAX_ROWS = 5000;
const MAX_COLS = 100;

const ARTICLE_RE = /артикул|sku|штрихкод|barcode|^код$|^article$/i;
const NAME_RE = /назван|наимен|товар|продукт|name|title/i;

/** Детект «процентного» формата ячейки по number-format (string | number). */
function isPercentFormat(z: string | number | undefined): boolean {
  return typeof z === 'string' && z.includes('%');
}

/** Детект «денежного» формата ячейки по number-format (string | number). */
function isMoneyFormat(z: string | number | undefined): boolean {
  if (typeof z !== 'string') return false;
  return /[₽$€]|руб|"р|\[\$/i.test(z);
}

function cellNumber(cell: XLSX.CellObject | undefined): number | null {
  if (!cell) return null;
  if (typeof cell.v === 'number' && Number.isFinite(cell.v)) return cell.v;
  if (typeof cell.v === 'string') {
    const n = Number(cell.v.replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function cellString(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  return String(cell.w ?? cell.v).trim();
}

/**
 * Главная функция: парсит ArrayBuffer XLSX в ImportTable.
 * @param sheetName  имя листа (по умолчанию первый).
 */
export function parseXlsxToImportTable(
  buffer: ArrayBuffer,
  opts?: { sheetName?: string; fileLabel?: string },
): XlsxParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'array', cellFormula: true, cellNF: true });
  } catch (err) {
    return { ok: false, error: `Не удалось прочитать XLSX: ${(err as Error).message}` };
  }
  if (!wb.SheetNames.length) return { ok: false, error: 'В файле нет листов' };

  const sheetName = opts?.sheetName && wb.SheetNames.includes(opts.sheetName)
    ? opts.sheetName
    : wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const ref = ws['!ref'];
  if (!ref) return { ok: false, error: `Лист «${sheetName}» пуст` };

  const range = XLSX.utils.decode_range(ref);
  const endRow = Math.min(range.e.r, range.s.r + MAX_ROWS);
  const endCol = Math.min(range.e.c, range.s.c + MAX_COLS);

  const cellAt = (r: number, c: number): XLSX.CellObject | undefined =>
    ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;

  // --- 1. Детект строки заголовков: первая строка с >=2 строковыми ячейками. ---
  let headerRow = range.s.r;
  for (let r = range.s.r; r <= Math.min(endRow, range.s.r + 8); r++) {
    let strings = 0;
    for (let c = range.s.c; c <= endCol; c++) {
      const cell = cellAt(r, c);
      if (cell && cell.t === 's' && cellString(cell)) strings++;
    }
    if (strings >= 2) {
      headerRow = r;
      break;
    }
  }
  const firstDataRow = headerRow + 1;
  if (firstDataRow > endRow) return { ok: false, error: 'В файле нет строк данных' };

  // --- 2. Колонки + карта буква→key. ---
  type ColMeta = {
    c: number;
    letter: string;
    label: string;
    key: string;
    type: ImportColumnType;
    unit?: string;
    role?: 'name' | 'article';
    percentFraction: boolean;
    formula?: string;
  };

  const taken = new Set<string>();
  const letterToKey = new Map<string, string>();
  const cols: ColMeta[] = [];

  for (let c = range.s.c; c <= endCol; c++) {
    const letter = XLSX.utils.encode_col(c);
    const headerText = cellString(cellAt(headerRow, c));
    // Колонка считается «живой» если есть заголовок ИЛИ есть данные.
    let hasData = Boolean(headerText);
    if (!hasData) {
      for (let r = firstDataRow; r <= endRow; r++) {
        if (cellString(cellAt(r, c))) {
          hasData = true;
          break;
        }
      }
    }
    if (!hasData) continue;

    const label = headerText || `Колонка ${letter}`;
    const key = slugifyIdentifier(headerText || letter, taken);
    letterToKey.set(letter, key);
    cols.push({ c, letter, label, key, type: 'number', percentFraction: false });
  }

  if (cols.length === 0) return { ok: false, error: 'Не найдено колонок' };

  // --- 3. Роли (name/article) + типы колонок. ---
  // article — по заголовку; name — по заголовку, иначе первая «текстовая» колонка.
  let articleCol: ColMeta | undefined;
  let nameCol: ColMeta | undefined;

  for (const col of cols) {
    if (!articleCol && ARTICLE_RE.test(col.label)) articleCol = col;
    if (!nameCol && NAME_RE.test(col.label)) nameCol = col;
  }

  // Подсчёт «текстовости» и формул по данным.
  const sampleEnd = Math.min(endRow, firstDataRow + 200);
  for (const col of cols) {
    let textCount = 0;
    let numCount = 0;
    let formulaCount = 0;
    let percentFmt = 0;
    let moneyFmt = 0;
    let firstFormula: { raw: string; excelRow: number } | undefined;
    for (let r = firstDataRow; r <= sampleEnd; r++) {
      const cell = cellAt(r, col.c);
      if (!cell || cell.v === undefined || cell.v === null || cell.v === '') continue;
      if (cell.f) {
        formulaCount++;
        if (!firstFormula) firstFormula = { raw: cell.f, excelRow: r + 1 };
      }
      if (isPercentFormat(cell.z)) percentFmt++;
      if (isMoneyFormat(cell.z)) moneyFmt++;
      if (cell.t === 'n') numCount++;
      else if (cell.t === 's') textCount++;
    }

    // Тип-значение колонки.
    let type: ImportColumnType;
    if (percentFmt > 0) type = 'percent';
    else if (moneyFmt > 0) type = 'money';
    else if (textCount > numCount) type = 'text';
    else if (numCount > 0) type = guessTypeFromLabel(col.label);
    else type = guessTypeFromLabel(col.label);

    col.type = type;
    col.percentFraction = percentFmt > 0;
    if (type === 'money') col.unit = '₽';
    else if (type === 'percent') col.unit = '%';

    // Формула колонки (берём из первой строки, как Excel copy-down).
    if (formulaCount > 0 && firstFormula) {
      const conv = convertExcelFormula(
        firstFormula.raw,
        firstFormula.excelRow,
        letterToKey,
        (letter, row) => cellNumber(cellAt(row - 1, XLSX.utils.decode_col(letter))),
      );
      if (conv.ok) {
        // Для процентных (дробных) колонок — домножаем на 100 для верного «54%».
        col.formula = col.percentFraction
          ? `=(${conv.formula.slice(1)})*100`
          : conv.formula;
      }
      // conv.ok=false → формулу не переносим, остаётся value-колонка.
    }
  }

  // Если name-колонка не найдена по заголовку — первая преимущественно текстовая.
  if (!nameCol) {
    nameCol = cols.find((col) => col.type === 'text' && col !== articleCol) ?? cols[0];
  }
  if (nameCol) nameCol.role = 'name';
  if (articleCol && articleCol !== nameCol) articleCol.role = 'article';

  // --- 4. ImportColumn[] (без identity-колонок). ---
  const importColumns: ImportColumn[] = cols.map((col) => ({
    key: col.key,
    label: col.label,
    type: col.type,
    unit: col.unit,
    formula: col.formula,
    role: col.role,
  }));

  // --- 5. Строки. ---
  const moneyCols = cols.filter((col) => !col.role && col.type === 'money');
  const rows: ImportRow[] = [];

  for (let r = firstDataRow; r <= endRow; r++) {
    const name = nameCol ? cellString(cellAt(r, nameCol.c)) : '';
    const article = articleCol ? cellString(cellAt(r, articleCol.c)) : '';
    // Полностью пустая строка — пропускаем.
    let anyValue = Boolean(name || article);
    const values: Record<string, number | string> = {};

    for (const col of cols) {
      if (col.role) continue;
      const cell = cellAt(r, col.c);
      if (!cell || cell.v === undefined || cell.v === null || cell.v === '') continue;
      if (col.type === 'text') {
        values[col.key] = cellString(cell);
        anyValue = true;
      } else {
        const num = cellNumber(cell);
        if (num === null) continue;
        const adjusted = col.percentFraction ? num * 100 : num;
        values[col.key] = adjusted;
        anyValue = true;
      }
    }

    if (!anyValue) continue;

    // Категория: есть название, но нет ни одного денежного значения.
    const hasMoney = moneyCols.some((col) => {
      const v = values[col.key];
      return typeof v === 'number' && v !== 0;
    });
    const isCategory = Boolean(name) && moneyCols.length > 0 && !hasMoney;

    rows.push({ article, name, values, isCategory });
  }

  return {
    ok: true,
    sheetNames: wb.SheetNames,
    table: {
      columns: importColumns,
      rows,
      source: {
        kind: 'xlsx',
        label: opts?.fileLabel ?? sheetName,
        sheetName,
      },
    },
  };
}
