// PURPOSE: Высокоуровневые методы Ozon Performance API.
// См. docs.ozon.ru/api/performance. Все методы используют OzonPerformanceClient.

import { z } from 'zod';
import { OzonPerformanceClient } from './client';

// ---------------------------------------------------------------------------
// /api/client/campaign — список кампаний
// ---------------------------------------------------------------------------

const CampaignSchema = z
  .object({
    id: z.string().or(z.number().transform((n) => String(n))).optional(),
    title: z.string().optional(),
    state: z.string().optional(),
    advObjectType: z.string().optional(),
    paymentType: z.string().optional(),
    budget: z.string().or(z.number()).optional(),
    dailyBudget: z.string().or(z.number()).optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
    productCampaignMode: z.string().optional(),
    placement: z.string().or(z.array(z.string())).optional(),
  })
  .passthrough();

const CampaignListSchema = z
  .object({ list: z.array(CampaignSchema).optional() })
  .passthrough();

export type PerfCampaign = z.infer<typeof CampaignSchema>;

export async function listCampaigns(
  client: OzonPerformanceClient,
): Promise<PerfCampaign[]> {
  const data = (await client.get('/api/client/campaign', undefined, CampaignListSchema)) as
    | { list?: PerfCampaign[] }
    | undefined;
  return data?.list ?? [];
}

// ---------------------------------------------------------------------------
// /api/client/statistic/products/generate (async report по товарам)
// ---------------------------------------------------------------------------

const GenerateReportSchema = z
  .object({
    UUID: z.string().optional(),
    uuid: z.string().optional(),
    vendor: z.boolean().optional(),
  })
  .passthrough();

const ReportStatusSchema = z
  .object({
    UUID: z.string().optional(),
    uuid: z.string().optional(),
    state: z.string().optional(),  // NOT_STARTED | IN_PROGRESS | OK | ERROR
    link: z.string().optional(),
  })
  .passthrough();

/**
 * Конвертирует YYYY-MM-DD в RFC 3339 (требование Performance API).
 * Для `dateTo` используем конец дня, чтобы захватить весь последний день.
 */
function toRfc3339(yyyymmdd: string, endOfDay = false): string {
  const time = endOfDay ? 'T23:59:59Z' : 'T00:00:00Z';
  return `${yyyymmdd}${time}`;
}

/**
 * Запускает async-генерацию отчёта Search Promo по товарам (показы/клики/
 * корзина/заказы per-SKU per-day per-campaign). Возвращает UUID.
 *
 * Endpoint: `POST /api/client/statistic/products/generate`
 * (operation `SearchPromoProductsReportSubmitRequest` в docs.ozon.ru/api/performance).
 *
 * **REQUIRED**: `campaigns` — массив id Search Promo кампаний (CPC/CPM × SKU).
 * Без него Ozon возвращает default-отчёт типа «Оплата за заказ»
 * (CSV с двумя колонками `[SKU; campaign_code]`), который нельзя парсить как
 * SKU-stats — это и был баг в v0.18.12.
 *
 * Тело запроса по доке:
 * ```
 * {
 *   campaigns: string[],     // id кампаний (REQUIRED)
 *   dateFrom: 'YYYY-MM-DD',  // короткий формат
 *   dateTo:   'YYYY-MM-DD',
 *   from:     RFC3339,       // полный формат (Ozon принимает оба)
 *   to:       RFC3339,
 *   groupBy:  'DATE' | 'NO_GROUP_BY' | 'START_OF_WEEK' | 'START_OF_MONTH'
 * }
 * ```
 */
export async function generateSkuStatsReport(
  client: OzonPerformanceClient,
  args: {
    dateFrom: string;
    dateTo: string;
    campaigns: string[];
    groupBy?: 'DATE' | 'NO_GROUP_BY' | 'START_OF_WEEK' | 'START_OF_MONTH';
  },
): Promise<string> {
  if (!args.campaigns || args.campaigns.length === 0) {
    throw new Error(
      'Performance API: generate report требует непустой `campaigns` (список id Search Promo кампаний). Без него возвращается default-отчёт «Оплата за заказ», который нельзя парсить как SKU-stats.',
    );
  }
  const body: Record<string, unknown> = {
    campaigns: args.campaigns,
    dateFrom: args.dateFrom,
    dateTo: args.dateTo,
    from: toRfc3339(args.dateFrom, false),
    to: toRfc3339(args.dateTo, true),
    groupBy: args.groupBy ?? 'DATE',
  };
  const data = (await client.post(
    '/api/client/statistic/products/generate',
    body,
    GenerateReportSchema,
  )) as { UUID?: string; uuid?: string } | undefined;
  const id = data?.UUID ?? data?.uuid;
  if (!id) throw new Error('Performance API: generate report не вернул UUID');
  return id;
}

export async function getReportStatus(
  client: OzonPerformanceClient,
  uuid: string,
): Promise<{ state: string; link: string | null }> {
  const data = (await client.get(
    `/api/client/statistics/${uuid}`,
    undefined,
    ReportStatusSchema,
  )) as { state?: string; link?: string } | undefined;
  return {
    state: data?.state ?? 'UNKNOWN',
    link: data?.link ?? null,
  };
}

/**
 * Опрашивает статус отчёта пока он не будет OK или ERROR.
 * Возвращает ссылку (или бросает).
 */
export async function waitForReport(
  client: OzonPerformanceClient,
  uuid: string,
  opts: { maxAttempts?: number; intervalMs?: number } = {},
): Promise<string> {
  const maxAttempts = opts.maxAttempts ?? 60; // ~10 минут при 10s интервале
  const intervalMs = opts.intervalMs ?? 10_000;
  for (let i = 0; i < maxAttempts; i += 1) {
    const { state, link } = await getReportStatus(client, uuid);
    if (state === 'OK' && link) return link;
    if (state === 'ERROR') throw new Error(`Performance API report ${uuid} failed`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Performance API report ${uuid} timed out`);
}

/**
 * Скачивает CSV-отчёт по ссылке. Возвращает сырой текст.
 * Ozon отдаёт CSV с заголовком и `;`-разделителем.
 */
export async function downloadReport(
  client: OzonPerformanceClient,
  pathOrUrl: string,
): Promise<string> {
  // Если link уже абсолютный — обрезаем до path для нашего client.get().
  const path = pathOrUrl.startsWith('http')
    ? new URL(pathOrUrl).pathname + new URL(pathOrUrl).search
    : pathOrUrl;
  const text = await client.get<string>(path, undefined, undefined, { binary: true });
  return text;
}

// ---------------------------------------------------------------------------
// /api/client/statistics/campaign/media — медиа-статистика по кампаниям
// ---------------------------------------------------------------------------

const MediaStatsSchema = z
  .object({
    list: z.array(z.record(z.unknown())).optional(),
  })
  .passthrough();

export async function getMediaStatistics(
  client: OzonPerformanceClient,
  args: { dateFrom: string; dateTo: string; campaignId?: string },
): Promise<Array<Record<string, unknown>>> {
  const data = (await client.get(
    '/api/client/statistics/campaign/media',
    {
      dateFrom: args.dateFrom,
      dateTo: args.dateTo,
      campaignId: args.campaignId,
    },
    MediaStatsSchema,
  )) as { list?: Array<Record<string, unknown>> } | undefined;
  return data?.list ?? [];
}

// ---------------------------------------------------------------------------
// CSV-парсинг отчётов Performance API.
// Формат:   "колонка1";"колонка2";...
//           "v1";"v2";...
// ---------------------------------------------------------------------------

/**
 * Распарсить CSV в массив записей. Учитывает кавычки и `;`-разделитель.
 * Pure-function, тестируется отдельно.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  // Простой парсер: split строки и split по `;` с поддержкой кавычек.
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length === 0) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < header.length; j += 1) {
      row[header[j]] = cells[j] ?? '';
    }
    rows.push(row);
  }
  return rows;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  let cur = '';
  let inQuote = false;
  while (i < line.length) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuote = false;
        i += 1;
        continue;
      }
      cur += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuote = true;
      i += 1;
      continue;
    }
    if (ch === ';') {
      out.push(cur);
      cur = '';
      i += 1;
      continue;
    }
    cur += ch;
    i += 1;
  }
  out.push(cur);
  return out;
}

/**
 * Парсит число в формате RU («1 234,56» → 1234.56). Безопасно для пустых
 * и нечисловых значений (возвращает 0).
 */
export function parseRuNumber(value: string | undefined | null): number {
  if (!value) return 0;
  const trimmed = String(value).trim().replace(/\s/g, '').replace(',', '.');
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : 0;
}

/**
 * Проверка что заголовок CSV действительно SKU-stats отчёт (а не «Оплата за
 * заказ» или другой формат). Должна найтись хотя бы одна из колонок SKU.
 */
export function isSkuStatsHeader(row: Record<string, string>): boolean {
  const aliases = ['sku', 'артикул', 'id товара', 'product id'];
  for (const k of Object.keys(row)) {
    if (aliases.includes(k.trim().toLowerCase())) return true;
  }
  return false;
}

/**
 * Конвертирует одну CSV-строку SKU-stats в типизированный объект.
 * Колонки берутся с устойчивостью к разному регистру/русским названиям.
 * Если sku не похож на валидный Ozon SKU (цифры) — возвращает пустой sku,
 * stage пропустит такую строку.
 */
export function parseSkuStatsRow(row: Record<string, string>): {
  sku: string;
  campaignId: string | null;
  date: string | null;
  views: number;
  clicks: number;
  cartAdds: number;
  orders: number;
  ordersRub: number;
  expenseRub: number;
} {
  const findKey = (...names: string[]): string => {
    for (const n of names) {
      for (const k of Object.keys(row)) {
        if (k.trim().toLowerCase() === n.toLowerCase()) return k;
      }
    }
    return '';
  };
  const get = (...names: string[]) => row[findKey(...names)] ?? '';
  const skuRaw = get('sku', 'SKU', 'Артикул', 'ID товара', 'Product ID').trim();
  // Ozon SKU всегда числовой. Защита от случайно прочитанных названий
  // кампаний (например `rm-nnm-60-5`) в позиции SKU.
  const sku = /^\d+$/.test(skuRaw) ? skuRaw : '';
  const campaignIdRaw = get(
    'campaignId',
    'campaign_id',
    'Идентификатор кампании',
    'ID кампании',
    'Кампания',
  ).trim();
  return {
    sku,
    campaignId: campaignIdRaw && /^\d+$/.test(campaignIdRaw) ? campaignIdRaw : null,
    date: (get('date', 'Дата') || null) as string | null,
    views: Math.round(parseRuNumber(get('views', 'Показы'))),
    clicks: Math.round(parseRuNumber(get('clicks', 'Клики'))),
    cartAdds: Math.round(
      parseRuNumber(
        get('cartAdds', 'В корзину', 'Добавления в корзину', 'Количество добавлений товара в корзину'),
      ),
    ),
    orders: Math.round(parseRuNumber(get('orders', 'Заказы', 'Заказы в штуках', 'Заказы (шт)'))),
    ordersRub: parseRuNumber(
      get('ordersMoney', 'Выручка', 'Заказы (руб.)', 'Заказы в рублях', 'Заказы, ₽'),
    ),
    expenseRub: parseRuNumber(
      get('moneySpent', 'Расход', 'Затраты', 'Расход в рублях', 'Расход, ₽'),
    ),
  };
}
