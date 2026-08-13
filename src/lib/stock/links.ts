// PURPOSE: Чистый автоподбор сшивки «наш товар ↔ SKU канала» (stock_item_links).
// Канон — docs/STOCK_MODULE_DESIGN.md §2.3 (таблица), §8 шаг 3 (экран
// сопоставления: цепочка штрихкод → нормализованное имя → дозировка/число капсул)
// и §10 риск 6 (ошибка qty_per_unit портит остатки и COGS КРАТНО).
//
// Модуль чистый: единственный импорт — типы схемы (стирается компилятором).
// Тесты — scripts/test-stock-matching.ts.
//
// КОНТРАКТ БЕЗОПАСНОСТИ: автоподбор НИКОГДА не возвращает кандидата при
// неоднозначности (две карточки подходят одинаково хорошо) и при расхождении
// дозировки. Лучше пустая строка на экране сопоставления, чем тихая сшивка
// «Спермидин 500 мг» с «Спермидин 250 мг» — она отравит себестоимость навсегда.

import type { StockMatchSource } from '../db/schema/stock';

// ---------------------------------------------------------------------------
// Нормализация
// ---------------------------------------------------------------------------

/**
 * Нормализованное имя для сравнения: нижний регистр, ё→е, латиница/кириллица
 * как есть, любая пунктуация и кавычки → пробел, схлопнутые пробелы.
 */
export function normalizeName(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/ё/g, 'е') // ё → е
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Штрихкод: только цифры. Пустой/короткий (< 6) считается отсутствующим. */
export function normalizeBarcode(raw: string | null | undefined): string {
  if (!raw) return '';
  const digits = raw.replace(/\D+/g, '');
  return digits.length >= 6 ? digits : '';
}

/** Артикул: нижний регистр без пробелов и разделителей. */
export function normalizeSku(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.toLowerCase().replace(/[\s\-_.]+/g, '');
}

/** Токены имени для нечёткого сравнения (без «шумовых» слов и одиночных букв). */
const NOISE_TOKENS = new Set([
  'бад',
  'капсулы',
  'капсул',
  'таблетки',
  'таблеток',
  'шт',
  'штук',
  'упаковка',
  'банка',
  'набор',
  'комплект',
  'для',
  'и',
  'в',
  'с',
  'по',
]);

export function nameTokens(raw: string | null | undefined): string[] {
  return normalizeName(raw)
    .split(' ')
    .filter((t) => t.length > 1 && !NOISE_TOKENS.has(t));
}

// ---------------------------------------------------------------------------
// Дозировка и фасовка
// ---------------------------------------------------------------------------

export interface DosageInfo {
  /** Миллиграммы действующего вещества. */
  mg?: number;
  /** Граммы. */
  g?: number;
  /** Миллилитры. */
  ml?: number;
  /** Число капсул/таблеток в карточке. */
  count?: number;
}

function toNumber(raw: string): number {
  return Number(raw.replace(',', '.'));
}

/**
 * ВНИМАНИЕ: в шаблонах ниже нельзя пользоваться `\b` и `\w` после кириллицы —
 * в JS это ASCII-классы, и `/мг\b/` НЕ матчит «500 мг,». Границы задаются
 * явными lookahead'ами `(?![а-яa-z])`, продолжения слов — `[а-я]*`.
 */
const UNIT_BOUNDARY = '(?![а-яa-z])';

/** Единицы, после которых число — это дозировка, а не фасовка. */
const DOSAGE_UNITS = /^\s*(?:капс|таб|шт|мг|мкг|мл|гр|г(?![а-я])|caps|tabs|mg|ml)/;

/**
 * Вытаскивает дозировку и число капсул: «Спермидин 500 мг, 60 капсул»
 * → { mg: 500, count: 60 }. Именно эти два числа отличают соседние карточки
 * одного бренда, поэтому расхождение по ним = запрет автосшивки.
 */
export function extractDosage(raw: string | null | undefined): DosageInfo {
  const text = (raw ?? '').toLowerCase().replace(/ё/g, 'е');
  const out: DosageInfo = {};

  const mg = text.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:мг|mg)${UNIT_BOUNDARY}`));
  if (mg) out.mg = toNumber(mg[1]);

  const g = text.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:гр|г|g)${UNIT_BOUNDARY}`));
  if (g && !mg) out.g = toNumber(g[1]);

  const ml = text.match(new RegExp(`(\\d+(?:[.,]\\d+)?)\\s*(?:мл|ml)${UNIT_BOUNDARY}`));
  if (ml) out.ml = toNumber(ml[1]);

  // Намеренно БЕЗ «шт»: в «набор 3 шт» это фасовка, а в «60 шт» — капсулы.
  // Двусмысленный шаблон здесь ломает сопоставление в обе стороны.
  const count = text.match(
    new RegExp(`(\\d+)\\s*(?:капс[а-я]*|таб[а-я]*|caps?|tabs?)${UNIT_BOUNDARY}`),
  );
  if (count) out.count = Number(count[1]);

  return out;
}

/**
 * Сколько БАЗОВЫХ единиц в одной карточке канала: «3 банки» → 3, «набор из 2» → 2.
 * Ровно то, что ложится в stock_item_links.qty_per_unit. Ошибка здесь портит
 * остатки и COGS кратно (§10 риск 6), поэтому набор шаблонов — консервативный:
 * «60 капсул» фасовкой НЕ считается.
 */
export function extractPackQty(raw: string | null | undefined): number {
  const text = (raw ?? '').toLowerCase().replace(/ё/g, 'е');

  const explicit = text.match(/(?:набор|комплект)\s*(?:из\s*)?(\d{1,2})(?![\d])/);
  const packed = text.match(
    new RegExp(`(?:^|[^\\d])(\\d{1,2})\\s*(?:банк|упаковк|уп${UNIT_BOUNDARY}|флакон|пачк)`),
  );
  // «x3» / «х3» — латинская и кириллическая. Лукахед на единицы обязателен:
  // «500 мг х 60 капсул» — это дозировка, а не фасовка из 60 банок.
  const multiplier = text.match(/(?:^|[^\da-zа-я])[xх]\s?(\d{1,2})(?![\d])/);

  const candidates: Array<RegExpMatchArray | null> = [explicit, packed];
  if (multiplier && multiplier.index != null) {
    const rest = text.slice(multiplier.index + multiplier[0].length);
    if (!DOSAGE_UNITS.test(rest)) candidates.push(multiplier);
  }

  for (const m of candidates) {
    if (!m) continue;
    const n = Number(m[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 99) return n;
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Кандидаты и подбор
// ---------------------------------------------------------------------------

export interface MatchItem {
  id: string;
  /** Наш внутренний артикул. */
  sku: string;
  name: string;
  barcode?: string | null;
  brand?: string | null;
}

/** Строка из канала: карточка Ozon/WB/ЯМ или выгрузка сайта. */
export interface MatchRow {
  /** offer_id / nmId / shopSku / Product.sku сайта. */
  externalId: string;
  /** Числовой sku Ozon (второй ключ). */
  externalSku?: string | null;
  name?: string | null;
  barcode?: string | null;
  /** Артикул продавца в канале, если отличается от externalId. */
  sku?: string | null;
  brand?: string | null;
}

export interface MatchCandidate {
  itemId: string;
  source: StockMatchSource;
  /** 0-100, ложится в stock_item_links.match_confidence. */
  confidence: number;
  /** Сколько базовых единиц в карточке (stock_item_links.qty_per_unit). */
  qtyPerUnit: number;
  /** Человекочитаемое обоснование для экрана сопоставления. */
  reason: string;
}

export interface MatchSuggestion extends MatchCandidate {
  /** Кандидатов с тем же весом было больше одного — сшивать автоматически нельзя. */
  ambiguous: boolean;
}

/** Ниже этого порога автоподбор молчит и ждёт человека. */
export const MIN_AUTO_CONFIDENCE = 70;

/**
 * Совместима ли дозировка. Возвращает множитель фасовки, выведенный из
 * числа капсул («180 капсул» против нашей банки «60 капсул» → 3), либо null,
 * если карточки описывают РАЗНЫЙ товар и сшивать их нельзя.
 */
function dosageFactor(row: DosageInfo, item: DosageInfo): number | null {
  if (row.mg != null && item.mg != null && row.mg !== item.mg) return null;
  if (row.g != null && item.g != null && row.g !== item.g) return null;
  if (row.ml != null && item.ml != null && row.ml !== item.ml) return null;
  if (row.count != null && item.count != null && row.count !== item.count) {
    if (item.count > 0 && row.count % item.count === 0) return row.count / item.count;
    return null;
  }
  return 1;
}

/** Коэффициент Дайса по токенам имени: 0..1. */
function diceSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  let hits = 0;
  const seen = new Set<string>();
  for (const token of a) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (setB.has(token)) hits += 1;
  }
  const uniqA = new Set(a).size;
  const uniqB = new Set(b).size;
  return (2 * hits) / (uniqA + uniqB);
}

/** Итоговая фасовка карточки: явная («3 банки») либо выведенная из капсул. */
function resolveQtyPerUnit(row: MatchRow, item: MatchItem, factor: number): number {
  const packRow = extractPackQty(row.name);
  const packItem = extractPackQty(item.name);
  const explicit = packItem > 0 ? Math.round(packRow / packItem) : packRow;
  const derived = Math.max(1, Math.round(factor));
  return Math.max(1, explicit, derived);
}

/**
 * Все правдоподобные кандидаты, отсортированные по убыванию уверенности
 * (при равенстве — по itemId, чтобы порядок был детерминированным).
 * Экран сопоставления показывает этот список; автосшивка берёт только
 * однозначный топ через suggestLink().
 */
export function rankCandidates(
  row: MatchRow,
  items: readonly MatchItem[],
): MatchCandidate[] {
  const rowBarcode = normalizeBarcode(row.barcode);
  const rowSkuKeys = [normalizeSku(row.sku), normalizeSku(row.externalId)].filter(Boolean);
  const rowExtSku = normalizeSku(row.externalSku);
  const rowName = normalizeName(row.name);
  const rowTokens = nameTokens(row.name);
  const rowDosage = extractDosage(row.name);
  const rowBrand = normalizeName(row.brand);

  const candidates: MatchCandidate[] = [];

  for (const item of items) {
    const itemDosage = extractDosage(item.name);
    const factor = dosageFactor(rowDosage, itemDosage);
    const itemBrand = normalizeName(item.brand);
    const brandConflict = rowBrand !== '' && itemBrand !== '' && rowBrand !== itemBrand;

    // 1. Штрихкод — самый надёжный ключ, дозировку не перепроверяем:
    //    один штрихкод = один физический товар.
    const itemBarcode = normalizeBarcode(item.barcode);
    if (rowBarcode !== '' && itemBarcode !== '' && rowBarcode === itemBarcode) {
      candidates.push({
        itemId: item.id,
        source: 'barcode',
        confidence: 100,
        qtyPerUnit: resolveQtyPerUnit(row, item, factor ?? 1),
        reason: `штрихкод ${rowBarcode}`,
      });
      continue;
    }

    // Дальше — только товары, у которых дозировка не противоречит.
    if (factor === null || brandConflict) continue;

    // 2. Артикул: наш sku совпал с offer_id / артикулом канала / числовым sku.
    const itemSku = normalizeSku(item.sku);
    if (itemSku !== '' && (rowSkuKeys.includes(itemSku) || rowExtSku === itemSku)) {
      candidates.push({
        itemId: item.id,
        source: 'sku',
        confidence: 95,
        qtyPerUnit: resolveQtyPerUnit(row, item, factor),
        reason: `артикул ${item.sku}`,
      });
      continue;
    }

    // 3. Имя: точное совпадение нормализованной формы, затем нечёткое.
    const itemName = normalizeName(item.name);
    if (rowName !== '' && rowName === itemName) {
      candidates.push({
        itemId: item.id,
        source: 'name',
        confidence: 85,
        qtyPerUnit: resolveQtyPerUnit(row, item, factor),
        reason: 'точное совпадение названия',
      });
      continue;
    }

    const dice = diceSimilarity(rowTokens, nameTokens(item.name));
    if (dice >= 0.6) {
      candidates.push({
        itemId: item.id,
        source: 'name',
        confidence: Math.min(80, 50 + Math.round(dice * 35)),
        qtyPerUnit: resolveQtyPerUnit(row, item, factor),
        reason: `похожее название (${Math.round(dice * 100)} %)`,
      });
    }
  }

  return candidates.sort((a, b) => {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
  });
}

/**
 * Однозначный автоподбор. Возвращает null, если кандидатов нет, топ слабее
 * MIN_AUTO_CONFIDENCE или на вершине ничья — во всех трёх случаях решение
 * принимает человек на экране сопоставления (§8 шаг 3).
 */
export function suggestLink(
  row: MatchRow,
  items: readonly MatchItem[],
  opts: { minConfidence?: number } = {},
): MatchSuggestion | null {
  const min = opts.minConfidence ?? MIN_AUTO_CONFIDENCE;
  const ranked = rankCandidates(row, items);
  if (ranked.length === 0) return null;
  const top = ranked[0];
  if (top.confidence < min) return null;
  const tied = ranked.filter(
    (c) => c.confidence === top.confidence && c.itemId !== top.itemId,
  );
  if (tied.length > 0) return null;
  return { ...top, ambiguous: false };
}

export interface SuggestLinksRow {
  row: MatchRow;
  suggestion: MatchSuggestion | null;
  candidates: MatchCandidate[];
}

/** Пакетный подбор для экрана сопоставления. Порядок строк сохраняется. */
export function suggestLinks(
  rows: readonly MatchRow[],
  items: readonly MatchItem[],
  opts: { minConfidence?: number } = {},
): SuggestLinksRow[] {
  return rows.map((row) => {
    const candidates = rankCandidates(row, items);
    return { row, suggestion: suggestLink(row, items, opts), candidates };
  });
}
