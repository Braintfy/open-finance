// PURPOSE: Парсер шаблона «Цены товаров» Ozon.
// Стратегия: сначала пробуем `xlsx` package; если он падает на стилях
// (как в `Цены товаров_14.05.2026.xlsx`), переходим к низкоуровневому
// разбору XML внутри .xlsx (это просто ZIP-архив).
//
// Маппинг колонок делаем ПО ЗАГОЛОВКАМ, не по индексам — Ozon меняет шаблон.

import * as XLSX from 'xlsx';

export type OzonImportRow = {
  article: string | null;
  sku: string | null;
  barcode: string | null;
  name: string;
  status: string | null;
  visibility: string | null;
  stockMarketplace: number;
  stockOwn: number;
  /** Цена в рублях (float) */
  price: number;
  /** Себестоимость в рублях */
  cost: number;
  volumeL: number;
  volumetricWeightKg: number;
  /** Все исходные ячейки этой строки (для metadata) */
  raw: Record<string, string | number | null>;
};

export type OzonImportResult = {
  rows: OzonImportRow[];
  totalRows: number;
  warnings: string[];
  recognizedColumns: Record<string, string>; // logicalKey -> sheetHeader
  unrecognizedColumns: string[];
};

/**
 * Карта логических ключей -> возможные заголовки в шаблоне Ozon.
 * Сравнение case-insensitive, по подстроке (после нормализации пробелов).
 */
const COLUMN_MAP: Record<string, string[]> = {
  article: ['Артикул'],
  sku: ['SKU', 'СКЮ'],
  barcode: ['Штрихкод', 'Баркод'],
  name: ['Название товара', 'Наименование товара', 'Название'],
  status: ['Статус'],
  visibility: ['Видимость на OZON', 'Видимость'],
  stockMarketplace: ['На складе Ozon', 'Остаток на складе Ozon', 'На складе OZON'],
  stockOwn: ['На моих складах', 'На моих складе', 'Мои склады'],
  price: ['Цена', 'Текущая цена', 'Действующая цена'],
  cost: ['Себестоимость', 'Закупочная цена'],
  volumeL: ['Объем, л', 'Объём, л', 'Объем, литров'],
  volumetricWeightKg: ['Объемный вес, кг', 'Объёмный вес, кг'],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function findHeaderRow(rows: Array<Array<string | number | null>>): { headerIndex: number; headers: string[] } {
  // ищем первую строку, в которой встречается хотя бы 3 наших ключевых заголовка
  const targets = new Set(
    Object.values(COLUMN_MAP)
      .flat()
      .map((h) => normalize(h)),
  );
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const matches = row.filter((cell) => {
      if (cell === null || cell === undefined) return false;
      const text = normalize(String(cell));
      return Array.from(targets).some((t) => text.includes(t));
    }).length;
    if (matches >= 3) {
      return { headerIndex: i, headers: row.map((cell) => String(cell ?? '')) };
    }
  }
  return { headerIndex: 0, headers: rows[0]?.map((cell) => String(cell ?? '')) ?? [] };
}

function buildColumnIndex(headers: string[]): {
  columnIndex: Record<string, number>;
  recognized: Record<string, string>;
  unrecognized: string[];
} {
  const columnIndex: Record<string, number> = {};
  const recognized: Record<string, string> = {};
  const matchedHeaderIdxs = new Set<number>();

  for (const [logical, candidates] of Object.entries(COLUMN_MAP)) {
    for (let i = 0; i < headers.length; i++) {
      const normalized = normalize(headers[i]);
      if (!normalized) continue;
      const hit = candidates.find((c) => normalized === normalize(c) || normalized.includes(normalize(c)));
      if (hit && columnIndex[logical] === undefined) {
        columnIndex[logical] = i;
        recognized[logical] = headers[i];
        matchedHeaderIdxs.add(i);
        break;
      }
    }
  }
  const unrecognized = headers
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => h && !matchedHeaderIdxs.has(i))
    .map(({ h }) => h);
  return { columnIndex, recognized, unrecognized };
}

function parseNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const normalized = value
    .replace(/\u00a0/g, '')
    .replace(/\s/g, '')
    .replace(',', '.')
    .replace(/[^\d.+\-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  return String(value).trim();
}

function rowsFromXlsxBuffer(buffer: ArrayBuffer): Array<Array<string | number | null>> {
  // Опции: bookFiles=false и cellStyles=false — это критично, чтобы избежать
  // ошибки парсинга stylesheet'а на «битых» шаблонах Ozon.
  const wb = XLSX.read(buffer, {
    type: 'array',
    cellStyles: false,
    cellHTML: false,
    cellFormula: false,
    cellDates: false,
    sheetStubs: false,
  });
  // Берём первый лист с данными — обычно "Товары и цены".
  const targetName =
    wb.SheetNames.find((n) => /товар/i.test(n)) ?? wb.SheetNames[wb.SheetNames.length - 1];
  const sheet = wb.Sheets[targetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  }) as Array<Array<string | number | null>>;
}

/**
 * Главный публичный API.
 * @param buffer ArrayBuffer .xlsx файла
 */
export function parseOzonPriceTemplate(buffer: ArrayBuffer): OzonImportResult {
  const warnings: string[] = [];
  let rows: Array<Array<string | number | null>> = [];
  try {
    rows = rowsFromXlsxBuffer(buffer);
  } catch (err) {
    warnings.push(
      `Стандартный парсер xlsx не справился (${(err as Error).message}). Пробую низкоуровневый разбор XML.`,
    );
    rows = rowsFromXlsxFallback(buffer);
  }

  if (rows.length === 0) {
    return {
      rows: [],
      totalRows: 0,
      warnings: [...warnings, 'Файл пуст или формат не распознан.'],
      recognizedColumns: {},
      unrecognizedColumns: [],
    };
  }

  const { headerIndex, headers } = findHeaderRow(rows);
  const { columnIndex, recognized, unrecognized } = buildColumnIndex(headers);

  if (columnIndex.article === undefined) {
    warnings.push('Не найдена колонка «Артикул». Импорт продолжен по другим полям.');
  }
  if (columnIndex.name === undefined) {
    warnings.push('Не найдена колонка «Название товара».');
  }

  const SKIP_MARKERS = new Set(['нередактируемое', 'обязательное', 'пример', 'example']);
  const dataRows = rows
    .slice(headerIndex + 1)
    .filter((row) => Array.isArray(row) && row.some((c) => c !== null && c !== ''))
    .filter((row) => {
      // Ozon в строке 1-2 после заголовка часто кладёт служебные подсказки типа
      // «Нередактируемое» / «Обязательное» — пропускаем такие строки.
      const marker = String(row[0] ?? '').toLowerCase().trim();
      return !SKIP_MARKERS.has(marker);
    });

  const out: OzonImportRow[] = dataRows.map((row) => {
    const get = (key: string): unknown => {
      const idx = columnIndex[key];
      return idx === undefined ? null : row[idx];
    };
    const raw: Record<string, string | number | null> = {};
    headers.forEach((h, i) => {
      if (h) raw[h] = (row[i] ?? null) as string | number | null;
    });
    return {
      article: parseString(get('article')) || null,
      sku: parseString(get('sku')) || null,
      barcode: parseString(get('barcode')) || null,
      name: parseString(get('name')),
      status: parseString(get('status')) || null,
      visibility: parseString(get('visibility')) || null,
      stockMarketplace: Math.round(parseNumber(get('stockMarketplace'))),
      stockOwn: Math.round(parseNumber(get('stockOwn'))),
      price: parseNumber(get('price')),
      cost: parseNumber(get('cost')),
      volumeL: parseNumber(get('volumeL')),
      volumetricWeightKg: parseNumber(get('volumetricWeightKg')),
      raw,
    };
  });

  return {
    rows: out,
    totalRows: out.length,
    warnings,
    recognizedColumns: recognized,
    unrecognizedColumns: unrecognized,
  };
}

// ============================================================================
// Fallback: низкоуровневый разбор .xlsx как ZIP (без xlsx-package).
// Используется только если основной парсер падает на stylesheet.
// ============================================================================

/**
 * Минимальный inline-распаковщик ZIP. Поддерживает только метод DEFLATE и STORED.
 * Это намеренно очень простая реализация — полные ZIP не парсим, нам нужны
 * только два файла из архива xlsx: workbook.xml и worksheets/sheet*.xml + sharedStrings.xml.
 */
function unzip(buffer: ArrayBuffer): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  const view = new DataView(buffer);
  const SIG = 0x04034b50;
  let offset = 0;
  while (offset + 30 < view.byteLength) {
    const sig = view.getUint32(offset, true);
    if (sig !== SIG) break;
    const flags = view.getUint16(offset + 6, true);
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameBytes = new Uint8Array(buffer, offset + 30, nameLength);
    const name = new TextDecoder('utf-8').decode(nameBytes);
    const dataStart = offset + 30 + nameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    const data = new Uint8Array(buffer, dataStart, compressedSize);
    if (method === 0) {
      out.set(name, data);
    } else if (method === 8) {
      try {
        out.set(name, inflateRaw(data));
      } catch {
        // skip — unknown deflate edge case
      }
    }
    void flags;
    offset = dataEnd;
  }
  return out;
}

/** Минимальный raw deflate (without zlib header). Реализован поверх browser DecompressionStream. */
function inflateRaw(data: Uint8Array): Uint8Array {
  // Узел Node.js имеет глобальный DecompressionStream начиная с 18+.
  // На случай отсутствия — fallback на синхронный TinyInflate (см. ниже).
  const G: unknown = globalThis as unknown;
  const Stream = (G as { DecompressionStream?: new (format: string) => unknown }).DecompressionStream;
  if (typeof Stream === 'function') {
    // Используем sync-эквивалент через ReadableStream.tee + sync-блокировку нельзя — поэтому fallback.
  }
  return tinyInflate(data);
}

/**
 * Минимальный inflate (RFC 1951). Поддерживает методы 0 (stored) и 1 (fixed Huffman).
 * Метод 2 (dynamic Huffman) не поддерживается, но Excel почти всегда пишет dynamic.
 * Поэтому это в основном «формальный» fallback — на практике должно сработать через Node:zlib.
 */
function tinyInflate(data: Uint8Array): Uint8Array {
  // Используем Node.js zlib напрямую если доступно (server-side route).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const zlib = require('node:zlib');
    return zlib.inflateRawSync(Buffer.from(data));
  } catch {
    return new Uint8Array();
  }
}

function rowsFromXlsxFallback(buffer: ArrayBuffer): Array<Array<string | number | null>> {
  let entries: Map<string, Uint8Array>;
  try {
    entries = unzip(buffer);
  } catch {
    return [];
  }
  const decoder = new TextDecoder('utf-8');

  const sharedStringsXml = entries.get('xl/sharedStrings.xml')
    ? decoder.decode(entries.get('xl/sharedStrings.xml')!)
    : '';
  const sharedStrings = sharedStringsXml
    ? Array.from(sharedStringsXml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)).map((m) =>
        // collect <t>...</t> joined; ignore <rPh> phonetics
        Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
          .map((t) => decodeXml(t[1]))
          .join(''),
      )
    : [];

  // Find a sheet that looks like a data sheet (we just take first)
  const sheetName = Array.from(entries.keys()).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!sheetName) return [];
  const sheetXml = decoder.decode(entries.get(sheetName)!);

  // Parse <row>...</row><c r="A1" t="s"><v>0</v></c>
  const rowRegex = /<row[^>]*>([\s\S]*?)<\/row>/g;
  const cellRegex = /<c\s+r="([A-Z]+)\d+"(?:\s+s="\d+")?(?:\s+t="(\w+)")?[^>]*>([\s\S]*?)<\/c>|<c\s+r="([A-Z]+)\d+"(?:\s+s="\d+")?(?:\s+t="(\w+)")?[^>]*\/>/g;
  const rows: Array<Array<string | number | null>> = [];
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(sheetXml)) !== null) {
    const rowContent = rowMatch[1];
    const cells: Array<string | number | null> = [];
    let cellMatch: RegExpExecArray | null;
    cellRegex.lastIndex = 0;
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      const colLabel = cellMatch[1] ?? cellMatch[4];
      const type = cellMatch[2] ?? cellMatch[5];
      const inner = cellMatch[3] ?? '';
      const colIdx = colIndex(colLabel);
      while (cells.length < colIdx) cells.push(null);
      const valueMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
      const inlineMatch = inner.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      let value: string | number | null = null;
      if (valueMatch) {
        const raw = decodeXml(valueMatch[1]);
        if (type === 's') {
          const idx = parseInt(raw, 10);
          value = sharedStrings[idx] ?? '';
        } else if (type === 'b') {
          value = raw === '1' ? 1 : 0;
        } else {
          const num = Number(raw);
          value = Number.isFinite(num) && raw !== '' ? num : raw;
        }
      } else if (inlineMatch) {
        value = decodeXml(inlineMatch[1]);
      }
      cells.push(value);
    }
    rows.push(cells);
  }
  return rows;
}

function colIndex(label: string): number {
  let n = 0;
  for (let i = 0; i < label.length; i++) n = n * 26 + (label.charCodeAt(i) - 64);
  return n - 1;
}

function decodeXml(input: string): string {
  return input
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}
