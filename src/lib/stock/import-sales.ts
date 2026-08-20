// PURPOSE: ЧИСТЫЙ разбор файловых выгрузок продаж Wildberries и Яндекс.Маркета
// (§12.3 — эти каналы учитываются с первого дня, иначе остаток своего склада
// систематически завышается, а план поставок занижается). Ни db, ни xlsx:
// на вход приходит уже прочитанная таблица `string[][]`, на выход —
// нормализованные строки продаж и готовые документы склада.
// Тесты — scripts/test-stock-sales-import.ts.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ЧИСТЫЙ МОДУЛЬ (тот же довод, что у costing.ts и money.ts):
// разбор чужого файла ошибается МОЛЧА. Не та колонка «Количество» — и склад
// месяцами уезжает, не та «Дата» — продажи падают в чужой период, не тот
// парсер денег — «1 200,50» превращается в 1 копейку. Поэтому:
//   • деньги разбирает ТОЛЬКО rublesToKopecks из money.ts (один парсер на модуль);
//   • количество — parseSignedQty оттуда же (возврат приходит минусом);
//   • дата приводится к КАЛЕНДАРНОМУ ДНЮ МОСКВЫ — той же зоне, в которой
//     работают doc_date и фильтры ленты документов;
//   • колонки ищутся по заголовкам, и результат поиска возвращается наружу,
//     чтобы человек в диалоге увидел «Дата = „Дата продажи“» и мог поправить.
//
// ИДЕМПОТЕНТНОСТЬ (§4.8.9). Документ дня получает source_ref = `<канал>:sales:<дата>`
// при source = `import:<канал>`. Повторный импорт того же (или перекрывающего)
// файла отсекается частичным уникальным индексом stock_docs_source_idx через
// filterNewDocs() — ни одного лишнего движения. Ключ — ДЕНЬ, а не файл: недельные
// выгрузки перекрываются, и ключ по файлу задваивал бы пересечение.

import { moscowDateString } from '@/lib/marketplaces/ozon/sync/perf-period';
import { parseSignedQty, rublesToKopecks } from './money';

/** Канал, для которого есть файловый импорт продаж. */
export type SalesChannel = 'wb' | 'yandex';

export const SALES_CHANNEL_LABEL: Record<SalesChannel, string> = {
  wb: 'Wildberries',
  yandex: 'Яндекс.Маркет',
};

/** Поля, которые движок ищет в заголовке файла. */
export type SalesField = 'date' | 'externalId' | 'qty' | 'revenue' | 'docType' | 'name';

/** Индексы колонок (0-based). Обязательны date/externalId/qty. */
export type SalesColumnMap = Partial<Record<SalesField, number>>;

export interface ParsedSaleRow {
  /** Номер строки в файле (1-based, как видит человек в Excel). */
  rowNo: number;
  /** Календарный день Москвы, 'YYYY-MM-DD'. */
  date: string;
  /** Артикул продавца / баркод — ключ сшивки stock_item_links.external_id. */
  externalId: string;
  /** Второй ключ (nmId у WB, SKU маркетплейса у ЯМ) — stock_item_links.external_sku. */
  externalSku: string | null;
  name: string | null;
  /** Знаковое: продажа > 0, возврат < 0. */
  qty: number;
  /** Выручка строки в копейках (может быть 0 — файл без сумм тоже годится). */
  revenueKopecks: number;
}

export interface SalesParseOk {
  ok: true;
  channel: SalesChannel;
  /** Номер строки заголовков (1-based). */
  headerRowNo: number;
  headers: string[];
  /** Что с чем сопоставилось — показывается человеку перед импортом. */
  mapping: Array<{ field: SalesField; column: number; header: string }>;
  rows: ParsedSaleRow[];
  /** Строки, которые пропущены, и почему — молча терять нельзя. */
  skipped: Array<{ rowNo: number; reason: string }>;
  warnings: string[];
}

export interface SalesParseError {
  ok: false;
  error: string;
  headers: string[];
}

export type SalesParseResult = SalesParseOk | SalesParseError;

// ---------------------------------------------------------------------------
// Поиск колонок по заголовкам
// ---------------------------------------------------------------------------

/** Нормализация заголовка: регистр, ё, пробелы и пунктуация не значимы. */
export function normalizeHeader(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, '');
}

/**
 * Кандидаты заголовков по каналам. Порядок ВАЖЕН: первый совпавший выигрывает,
 * поэтому специфичные названия («датапродажи») стоят раньше общих («дата»).
 * Сравнение — по нормализованной подстроке, чтобы пережить «Кол-во, шт.»
 * и «Дата продажи (МСК)».
 */
const CANDIDATES: Record<SalesChannel, Record<SalesField, string[]>> = {
  wb: {
    date: ['датапродажи', 'датазаказа', 'датаоперации', 'датарх', 'дата', 'date'],
    externalId: [
      'артикулпоставщика',
      'артикулпродавца',
      'вашартикул',
      'артикулwb',
      'supplierarticle',
      'баркод',
      'штрихкод',
      'barcode',
      'артикул',
    ],
    qty: [
      'количество',
      'колво',
      'проданошт',
      'кол-во',
      'quantity',
      'штук',
      'qty',
    ],
    revenue: [
      'кперечислениюпродавцу',
      'вайлдберризреализовалтовар',
      'суммапродаж',
      'выручка',
      'ценарозничнаясучетомсогласованнойскидки',
      'цената',
      'сумма',
    ],
    docType: ['типдокумента', 'обоснованиедляоплаты', 'типоперации'],
    name: ['предмет', 'наименование', 'название', 'товар', 'бренд'],
  },
  yandex: {
    date: ['датазаказа', 'датапродажи', 'датаотгрузки', 'датаоперации', 'дата', 'date'],
    externalId: ['вашsku', 'вашskuтовара', 'sкuмагазина', 'shopsku', 'вашартикул', 'артикул', 'sku'],
    qty: ['количество', 'колво', 'штук', 'quantity', 'qty'],
    revenue: [
      'стоимостьтоваров',
      'суммазаказа',
      'ценасучетомскидки',
      'выручка',
      'сумма',
      'цена',
    ],
    docType: ['типоперации', 'статус', 'тип'],
    name: ['названиетовара', 'наименование', 'название', 'товар'],
  },
};

/** Второй ключ сшивки: нумерация маркетплейса, если она есть в файле. */
const EXTERNAL_SKU_CANDIDATES: Record<SalesChannel, string[]> = {
  wb: ['номенклатура', 'кодноменклатуры', 'nmid', 'артикулwb'],
  yandex: ['sкuнамаркете', 'marketsku', 'skuнамаркете', 'идентификатортовара'],
};

function findColumn(headers: readonly string[], candidates: readonly string[]): number {
  const normalized = headers.map(normalizeHeader);
  for (const candidate of candidates) {
    const exact = normalized.indexOf(candidate);
    if (exact !== -1) return exact;
  }
  for (const candidate of candidates) {
    const partial = normalized.findIndex((h) => h.length > 0 && h.includes(candidate));
    if (partial !== -1) return partial;
  }
  return -1;
}

/** Автоопределение раскладки колонок для канала. */
export function detectColumnMap(
  headers: readonly string[],
  channel: SalesChannel,
): SalesColumnMap {
  const c = CANDIDATES[channel];
  const map: SalesColumnMap = {};
  const fields: SalesField[] = ['date', 'externalId', 'qty', 'revenue', 'docType', 'name'];
  for (const field of fields) {
    const idx = findColumn(headers, c[field]);
    if (idx !== -1) map[field] = idx;
  }
  const skuIdx = findColumn(headers, EXTERNAL_SKU_CANDIDATES[channel]);
  // external_sku кладём в отдельное поле только если это НЕ та же колонка,
  // что уже выбрана ключом сшивки (иначе один и тот же столбец в двух ролях).
  if (skuIdx !== -1 && skuIdx !== map.externalId) {
    (map as Record<string, number>).externalSku = skuIdx;
  }
  return map;
}

/** Строка похожа на заголовок: в ней нашлись дата, ключ и количество. */
function looksLikeHeader(row: readonly string[], channel: SalesChannel): boolean {
  const map = detectColumnMap(row, channel);
  return map.date != null && map.externalId != null && map.qty != null;
}

// ---------------------------------------------------------------------------
// Даты
// ---------------------------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;
const RU_DATE = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/;
/** Смещение таймзоны в конце строки: Z или ±HH:MM / ±HHMM. */
const HAS_TZ = /(Z|[+-]\d{2}:?\d{2})$/i;

/**
 * Дата ячейки → календарный день МОСКВЫ.
 *
 * Три источника, все встречаются в реальных выгрузках:
 *   «01.08.2026» / «2026-08-01»            — уже календарный день, берём как есть;
 *   «2026-08-01T23:40:00+03:00» / «…Z»     — момент времени, переводим в МСК
 *                                            (иначе ночная продажа уедет на сутки);
 *   «2026-08-01 23:40:00»                  — время БЕЗ зоны: маркетплейс печатает
 *                                            московское, поэтому день берётся из
 *                                            самой строки, без пересчёта.
 */
export function parseSaleDate(raw: string): string | null {
  const value = String(raw ?? '').trim();
  if (value === '') return null;

  if (HAS_TZ.test(value)) {
    const ts = Date.parse(value);
    if (Number.isFinite(ts)) return moscowDateString(new Date(ts));
  }

  const iso = ISO_DATE.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const ru = RU_DATE.exec(value);
  if (ru) {
    const day = ru[1].padStart(2, '0');
    const month = ru[2].padStart(2, '0');
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) {
      return null;
    }
    return `${ru[3]}-${month}-${day}`;
  }

  // Серийный номер Excel (когда лист прочитан без форматирования).
  const serial = Number(value.replace(',', '.'));
  if (Number.isFinite(serial) && serial > 20_000 && serial < 80_000) {
    // Эпоха Excel 1899-12-30 (с учётом легендарного бага 1900 года).
    const ms = Math.round((serial - 25_569) * 86_400_000);
    return new Date(ms).toISOString().slice(0, 10);
  }

  return null;
}

/** Строка документа — возврат? (WB печатает это словом, а не минусом). */
export function isReturnDocType(raw: string): boolean {
  const v = String(raw ?? '').toLowerCase();
  return /возврат|return|отмен|cancel/.test(v);
}

// ---------------------------------------------------------------------------
// Разбор листа
// ---------------------------------------------------------------------------

const MAX_HEADER_SCAN_ROWS = 12;
export const MAX_SALES_ROWS = 50_000;

/**
 * Главная функция: таблица ячеек → нормализованные строки продаж.
 * Ничего не выбрасывает — непонятные строки уезжают в `skipped` с причиной,
 * потому что «тихо пропустили 40 строк» здесь стоит дороже, чем упасть.
 */
export function parseSalesSheet(
  table: ReadonlyArray<ReadonlyArray<string>>,
  opts: { channel: SalesChannel; mapping?: SalesColumnMap },
): SalesParseResult {
  const rows = table.filter((r) => Array.isArray(r));
  if (rows.length === 0) return { ok: false, error: 'Файл пуст', headers: [] };

  // --- заголовки ---
  let headerIdx = -1;
  if (opts.mapping) {
    // Раскладку задал человек: заголовком считаем первую непустую строку.
    headerIdx = rows.findIndex((r) => r.some((c) => String(c ?? '').trim() !== ''));
  } else {
    const scan = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
    for (let i = 0; i < scan; i += 1) {
      if (looksLikeHeader(rows[i].map((c) => String(c ?? '')), opts.channel)) {
        headerIdx = i;
        break;
      }
    }
  }
  if (headerIdx === -1) {
    const firstRow = (rows[0] ?? []).map((c) => String(c ?? '').trim()).filter(Boolean);
    return {
      ok: false,
      error:
        `Не нашлись обязательные колонки (дата, артикул, количество) в первых ` +
        `${MAX_HEADER_SCAN_ROWS} строках файла ${SALES_CHANNEL_LABEL[opts.channel]}. ` +
        'Проверьте, что это выгрузка продаж, и при необходимости укажите колонки вручную.' +
        // Заголовки — в тексте ошибки, а не только в поле рядом: в UI человек
        // видит именно строку ошибки, и без них «не нашлись колонки» бесполезно.
        (firstRow.length > 0
          ? ` Первая строка файла: ${firstRow.slice(0, 20).join(' · ')}`
          : ''),
      headers: firstRow,
    };
  }

  const headers = rows[headerIdx].map((c) => String(c ?? '').trim());
  const map: SalesColumnMap = opts.mapping ?? detectColumnMap(headers, opts.channel);
  const missing: SalesField[] = (['date', 'externalId', 'qty'] as SalesField[]).filter(
    (f) => map[f] == null,
  );
  if (missing.length > 0) {
    const names: Record<string, string> = {
      date: 'дата',
      externalId: 'артикул/баркод',
      qty: 'количество',
    };
    return {
      ok: false,
      error:
        `В файле не нашлись колонки: ${missing.map((f) => names[f] ?? f).join(', ')}. ` +
        `Найденные заголовки: ${headers.filter(Boolean).slice(0, 20).join(' · ')}`,
      headers,
    };
  }

  const mapping: SalesParseOk['mapping'] = (
    Object.keys(map) as SalesField[]
  ).map((field) => ({
    field,
    column: map[field] as number,
    header: headers[map[field] as number] ?? '',
  }));

  // --- строки ---
  const parsed: ParsedSaleRow[] = [];
  const skipped: SalesParseOk['skipped'] = [];
  const warnings: string[] = [];
  const cell = (row: readonly string[], idx: number | undefined): string =>
    idx == null ? '' : String(row[idx] ?? '').trim();

  const limit = Math.min(rows.length, headerIdx + 1 + MAX_SALES_ROWS);
  if (rows.length > limit) {
    warnings.push(
      `Файл длиннее ${MAX_SALES_ROWS} строк — разобраны первые ${MAX_SALES_ROWS}. ` +
        'Разделите выгрузку по месяцам.',
    );
  }

  for (let i = headerIdx + 1; i < limit; i += 1) {
    const row = rows[i].map((c) => String(c ?? ''));
    const rowNo = i + 1;
    if (row.every((c) => c.trim() === '')) continue;

    const date = parseSaleDate(cell(row, map.date));
    if (!date) {
      skipped.push({ rowNo, reason: `не разобрана дата «${cell(row, map.date)}»` });
      continue;
    }
    const externalId = cell(row, map.externalId);
    if (externalId === '') {
      skipped.push({ rowNo, reason: 'пустой артикул' });
      continue;
    }
    let qty = parseSignedQty(cell(row, map.qty));
    if (qty === 0) {
      skipped.push({ rowNo, reason: 'количество равно нулю' });
      continue;
    }
    // Возврат приходит либо минусом, либо словом в «Типе документа».
    // Знак ставим один раз: у файлов, где ОБА признака, минус уже стоит.
    if (map.docType != null && isReturnDocType(cell(row, map.docType)) && qty > 0) {
      qty = -qty;
    }

    const revenueKopecks = rublesToKopecks(cell(row, map.revenue));
    const externalSku = cell(row, (map as Record<string, number>).externalSku);
    parsed.push({
      rowNo,
      date,
      externalId,
      externalSku: externalSku === '' ? null : externalSku,
      name: cell(row, map.name) || null,
      qty,
      // Выручка возврата тоже отрицательная — иначе «продано на X» врёт.
      revenueKopecks: qty < 0 ? -Math.abs(revenueKopecks) : revenueKopecks,
    });
  }

  if (parsed.length === 0 && skipped.length > 0) {
    warnings.push('Ни одной строки не разобрано — проверьте, те ли колонки выбраны.');
  }

  return {
    ok: true,
    channel: opts.channel,
    headerRowNo: headerIdx + 1,
    headers,
    mapping,
    rows: parsed,
    skipped,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Свёртка и документы
// ---------------------------------------------------------------------------

export interface SalesAggregate {
  date: string;
  externalId: string;
  externalSku: string | null;
  name: string | null;
  /** Нетто за день: продажи минус возвраты. */
  qty: number;
  revenueKopecks: number;
  /** Сколько строк файла свернулось в эту. */
  sourceRows: number;
}

/**
 * Свёртка построчных продаж в «день × позиция».
 *
 * Возвраты гасятся продажами ТОГО ЖЕ дня и той же позиции — так документ дня
 * отражает фактическое движение склада, а не бухгалтерскую ленту. Если нетто
 * вышло нулевым, позиция выпадает: движение на 0 штук не имеет смысла, но
 * оно и не потеряно — продажа и возврат взаимно погасились.
 */
export function aggregateSales(rows: readonly ParsedSaleRow[]): SalesAggregate[] {
  const byKey = new Map<string, SalesAggregate>();
  for (const row of rows) {
    // Ключ через JSON, а не склейку: артикул может содержать любой разделитель.
    const key = JSON.stringify([row.date, row.externalId]);
    const acc = byKey.get(key);
    if (acc) {
      acc.qty += row.qty;
      acc.revenueKopecks += row.revenueKopecks;
      acc.sourceRows += 1;
      acc.externalSku = acc.externalSku ?? row.externalSku;
      acc.name = acc.name ?? row.name;
    } else {
      byKey.set(key, {
        date: row.date,
        externalId: row.externalId,
        externalSku: row.externalSku,
        name: row.name,
        qty: row.qty,
        revenueKopecks: row.revenueKopecks,
        sourceRows: 1,
      });
    }
  }
  return Array.from(byKey.values())
    .filter((a) => a.qty !== 0)
    .sort((a, b) =>
      a.date !== b.date
        ? a.date < b.date
          ? -1
          : 1
        : a.externalId < b.externalId
          ? -1
          : a.externalId > b.externalId
            ? 1
            : 0,
    );
}

/** source документа импорта продаж канала. */
export function salesDocSource(channel: SalesChannel): string {
  return `import:${channel}`;
}

/**
 * Ключ идемпотентности документа дня (§4.8.9). Ключ — КАНАЛ + ДЕНЬ:
 * недельные и месячные выгрузки перекрываются, и ключ по имени файла
 * задваивал бы пересечение периодов.
 */
export function salesDocRef(channel: SalesChannel, date: string): string {
  return `${channel}:sales:${date}`;
}

export interface SalesDocPlanLine {
  externalId: string;
  externalSku: string | null;
  name: string | null;
  /** Всегда > 0: направление задаёт документ. */
  qty: number;
  /** Цена продажи за единицу (справочно; себестоимость считает пул). */
  unitPriceKopecks: number;
  revenueKopecks: number;
}

export interface SalesDocPlan {
  date: string;
  /** 'sale' — продажа (расход), 'return_in' — нетто-возврат за день. */
  kind: 'sale' | 'return_in';
  source: string;
  sourceRef: string;
  lines: SalesDocPlanLine[];
  qtyTotal: number;
  revenueKopecks: number;
}

/**
 * Свёрнутые продажи → план документов по дням.
 *
 * Продажи и нетто-возвраты одного дня разъезжаются в РАЗНЫЕ документы:
 *   • `sale`      — расход, себестоимость считает пул (это COGS, не потеря);
 *   • `return_in` — приход обратно на склад. Стоимость возврата без
 *     идентифицируемого источника берётся по ТЕКУЩЕЙ средней (§4.3) —
 *     цену подставляет вызывающий (у чистого модуля нет доступа к пулу),
 *     здесь она остаётся нулевой и помечается is_estimated на слое применения.
 *
 * Ключ идемпотентности у документов разный (`…:sales:<дата>` и
 * `…:returns:<дата>`), иначе возвратный документ конфликтовал бы с продажным.
 */
export function buildSalesDocPlans(
  aggregates: readonly SalesAggregate[],
  channel: SalesChannel,
): SalesDocPlan[] {
  const byDate = new Map<string, { sale: SalesDocPlan; ret: SalesDocPlan }>();
  const source = salesDocSource(channel);

  for (const agg of aggregates) {
    let bucket = byDate.get(agg.date);
    if (!bucket) {
      bucket = {
        sale: {
          date: agg.date,
          kind: 'sale',
          source,
          sourceRef: salesDocRef(channel, agg.date),
          lines: [],
          qtyTotal: 0,
          revenueKopecks: 0,
        },
        ret: {
          date: agg.date,
          kind: 'return_in',
          source,
          sourceRef: `${channel}:returns:${agg.date}`,
          lines: [],
          qtyTotal: 0,
          revenueKopecks: 0,
        },
      };
      byDate.set(agg.date, bucket);
    }
    const target = agg.qty > 0 ? bucket.sale : bucket.ret;
    const qty = Math.abs(agg.qty);
    const revenue = Math.abs(agg.revenueKopecks);
    target.lines.push({
      externalId: agg.externalId,
      externalSku: agg.externalSku,
      name: agg.name,
      qty,
      unitPriceKopecks: qty > 0 ? Math.round(revenue / qty) : 0,
      revenueKopecks: revenue,
    });
    target.qtyTotal += qty;
    target.revenueKopecks += revenue;
  }

  const plans: SalesDocPlan[] = [];
  for (const date of Array.from(byDate.keys()).sort()) {
    const bucket = byDate.get(date) as { sale: SalesDocPlan; ret: SalesDocPlan };
    if (bucket.sale.lines.length > 0) plans.push(bucket.sale);
    if (bucket.ret.lines.length > 0) plans.push(bucket.ret);
  }
  return plans;
}
