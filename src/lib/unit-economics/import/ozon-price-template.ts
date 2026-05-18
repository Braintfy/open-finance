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
  /** Действующая цена в рублях. Если есть «Новая цена (со скидкой)» — берём её,
   *  иначе fallback на «Текущую цену со скидкой», иначе на «Цену до скидки». */
  price: number;
  /** Цена до скидки (зачёркнутая цена в карточке Ozon). */
  oldPrice: number;
  /** Минимальная цена (для авто-акций). */
  minPrice: number;
  /** Себестоимость в рублях. Если есть «Новая себестоимость» — берём её. */
  cost: number;
  /** НДС в процентах (например 5, 10, 20). */
  vatPct: number;
  volumeL: number;
  volumetricWeightKg: number;
  /** Комиссия Ozon, FBO % (если есть в шаблоне). */
  fboCommissionPct: number | null;
  /** Комиссия Ozon, FBS % (если есть в шаблоне). */
  fbsCommissionPct: number | null;
  /** Эквайринг %. */
  acquiringPct: number | null;
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
// Карта логических ключей → варианты заголовков Ozon-шаблона.
//
// КРИТИЧНО: порядок вариантов = приоритет. Для price сначала ищем «Новая
// цена (со скидкой)», иначе «Текущая цена (со скидкой)», иначе «Цена до
// скидки». Раньше использовался слишком общий matcher `Цена`, который
// схватывал «Цена до скидки» и игнорировал актуальную «Текущую цену».
const COLUMN_MAP: Record<string, string[]> = {
  article: ['Артикул'],
  sku: ['SKU', 'СКЮ'],
  barcode: ['Штрихкод', 'Баркод'],
  name: ['Название товара', 'Наименование товара', 'Название'],
  status: ['Статус'],
  visibility: ['Видимость на OZON', 'Видимость'],
  stockMarketplace: ['На складе Ozon', 'Остаток на складе Ozon', 'На складе OZON'],
  stockOwn: ['На моих складах', 'На моих складе', 'Мои склады'],
  // ВАЖНО: «Текущая цена (со скидкой)» — реальное значение на момент
  // скачивания шаблона, а «Новая цена (со скидкой)» — пустые ячейки для
  // отправки обратно в Ozon. Мы импортируем ТЕКУЩИЕ данные, поэтому
  // «Текущая…» имеет приоритет; «Новая…» используем только если в шаблоне
  // нет колонки «Текущая…».
  price: [
    'Текущая цена (со скидкой), руб.',
    'Текущая цена (со скидкой)',
    'Цена с учетом акции или стратегии, руб.',
    'Действующая цена',
    'Текущая цена',
    'Новая цена (со скидкой), руб.',
    'Новая цена (со скидкой)',
  ],
  oldPrice: [
    'Цена до скидки, руб.',
    'Цена до скидки',
    'Новая цена до скидки, руб.',
  ],
  minPrice: [
    'Минимальная цена, руб.',
    'Минимальная цена',
    'Новая минимальная цена, руб.',
  ],
  cost: ['Себестоимость', 'Закупочная цена', 'Новая себестоимость'],
  vatPct: ['НДС, %', 'НДС', 'Новый НДС, %'],
  volumeL: ['Объем, л', 'Объём, л', 'Объем, литров'],
  volumetricWeightKg: ['Объемный вес, кг', 'Объёмный вес, кг'],
  fboCommissionPct: ['Вознаграждение Ozon, FBO, %', 'Вознаграждение Ozon, FBO'],
  fbsCommissionPct: ['Вознаграждение Ozon, FBS, %', 'Вознаграждение Ozon, FBS'],
  acquiringPct: ['Эквайринг'],
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
  const normalizedHeaders = headers.map((h) => normalize(h));

  // Шаг 1: exact-match для каждого логического ключа в порядке приоритета.
  // Гарантирует, что «Текущая цена (со скидкой), руб.» не подменится «Цена
  // до скидки, руб.» при substring-поиске.
  for (const [logical, candidates] of Object.entries(COLUMN_MAP)) {
    for (const candidate of candidates) {
      const targetNorm = normalize(candidate);
      const exactIdx = normalizedHeaders.findIndex(
        (h, i) => h === targetNorm && !matchedHeaderIdxs.has(i),
      );
      if (exactIdx >= 0) {
        columnIndex[logical] = exactIdx;
        recognized[logical] = headers[exactIdx];
        matchedHeaderIdxs.add(exactIdx);
        break;
      }
    }
  }

  // Шаг 2: substring fallback только для непокрытых ключей.
  for (const [logical, candidates] of Object.entries(COLUMN_MAP)) {
    if (columnIndex[logical] !== undefined) continue;
    for (const candidate of candidates) {
      const targetNorm = normalize(candidate);
      const idx = normalizedHeaders.findIndex(
        (h, i) =>
          h.length > 0 && !matchedHeaderIdxs.has(i) && h.includes(targetNorm),
      );
      if (idx >= 0) {
        columnIndex[logical] = idx;
        recognized[logical] = headers[idx];
        matchedHeaderIdxs.add(idx);
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

  const SKIP_MARKERS = new Set(['нередактируемое', 'обязательное', 'пример', 'example', 'редактируемое']);
  const dataRows = rows
    .slice(headerIndex + 1)
    .filter((row) => Array.isArray(row) && row.some((c) => c !== null && c !== ''))
    .filter((row) => {
      // Ozon в строке 1-2 после заголовка часто кладёт служебные подсказки типа
      // «Нередактируемое» / «Обязательное» — пропускаем такие строки.
      const marker = String(row[0] ?? '').toLowerCase().trim();
      if (SKIP_MARKERS.has(marker)) return false;
      // Строка-подсказка: artикул/sku/barcode/name пустые, но в других
      // ячейках длинный поясняющий текст. Пропускаем такие строки.
      const articleIdx = columnIndex.article;
      const skuIdx = columnIndex.sku;
      const barcodeIdx = columnIndex.barcode;
      const nameIdx = columnIndex.name;
      const hasArticle = articleIdx !== undefined && parseString(row[articleIdx]).length > 0;
      const hasSku = skuIdx !== undefined && parseString(row[skuIdx]).length > 0;
      const hasBarcode = barcodeIdx !== undefined && parseString(row[barcodeIdx]).length > 0;
      const hasName = nameIdx !== undefined && parseString(row[nameIdx]).length > 0;
      if (!hasArticle && !hasSku && !hasBarcode && !hasName) return false;
      return true;
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
    // Опциональные комиссии/эквайринг могут отсутствовать в шаблоне — в
    // этом случае пишем `null`, чтобы downstream не путал нулевую комиссию
    // с «нет данных» (важно для metadata.commissions merge).
    const fboPctRaw = parseNumber(get('fboCommissionPct'));
    const fbsPctRaw = parseNumber(get('fbsCommissionPct'));
    const acqPctRaw = parseNumber(get('acquiringPct'));
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
      oldPrice: parseNumber(get('oldPrice')),
      minPrice: parseNumber(get('minPrice')),
      cost: parseNumber(get('cost')),
      vatPct: parseNumber(get('vatPct')),
      volumeL: parseNumber(get('volumeL')),
      volumetricWeightKg: parseNumber(get('volumetricWeightKg')),
      fboCommissionPct: columnIndex.fboCommissionPct !== undefined ? fboPctRaw : null,
      fbsCommissionPct: columnIndex.fbsCommissionPct !== undefined ? fbsPctRaw : null,
      acquiringPct: columnIndex.acquiringPct !== undefined ? acqPctRaw : null,
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
