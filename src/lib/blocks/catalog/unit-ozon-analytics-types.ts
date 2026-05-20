// PURPOSE: Конфиг-схема и константы для блока unit.ozon-analytics.
// Выделено в отдельный файл, чтобы settings-form мог импортировать без
// циклической зависимости с client-only React-компонентом блока.

import { z } from 'zod';
import type { TableColumnKey } from '@/components/unit-economics/ozon-analytics-table';
import {
  resolveOzonQueryPeriod,
  ozonQueryPeriodToLegacyDates,
  ozonPeriodToSearchParams,
  describeOzonQueryPeriod,
  type OzonQueryPeriod,
  type ResolveOzonQueryPeriodOptions,
} from '@/lib/marketplaces/ozon/query-period';

/**
 * Pure-row аналитики Ozon. Дублирует тип из API route, но без impl-зависимостей
 * (route.ts тянет drizzle/db/auth — нельзя импортить из чисто-клиентских файлов
 * и smoke-тестов без env).
 */
export type OzonAnalyticsRow = {
  productId: string;
  article: string | null;
  sku: string | null;
  name: string;
  /**
   * URL основного изображения товара (из metadata.primaryImage,
   * сохранённого при sync через `info.primary_image` Ozon).
   * null если изображение ещё не синхронизировано.
   */
  primaryImage: string | null;
  stockMarketplace: number;
  stockOwn: number;
  priceRub: number;
  costRub: number;
  delivered: number;
  /** Доставленные FBO-заказы (со склада Ozon). */
  deliveredFbo: number;
  /** Доставленные FBS-заказы (со склада продавца). */
  deliveredFbs: number;
  cancelled: number;
  returned: number;
  qtyDelivered: number;
  revenueRub: number;
  /** Общий расход на рекламу: adsCpcRub + adsCpoAllocRub. */
  adsRub: number;
  /** CPC/CPM расход per-SKU (из ozon_perf_sku_stats). */
  adsCpcRub: number;
  /** CPO расход распределён на этот SKU пропорционально выручке (≅ оценка). */
  adsCpoAllocRub: number;
  /** true если adsCpoAllocRub > 0. UI показывает бейдж ≅ на рекламе/ДРР. */
  adsHasCpo: boolean;
  drrPct: number | null;
  buyoutPct: number | null;
  daysOfStock: number | null;
  /**
   * Дни оборачиваемости из Ozon Seller `/v1/analytics/turnover/stocks`
   * (как считает сам Ozon в кабинете). null если sync turnover не
   * запускался или товар не покрыт.
   */
  daysOfStockOzon?: number | null;
  /**
   * Fallback `daysOfStock` посчитанный по 30-дневному окну продаж
   * (если в текущем периоде qtyDelivered = 0 и расчёт прямой невозможен).
   * Используется когда нет ни Ozon Turnover, ни сегодняшних продаж.
   */
  daysOfStockFallback30d?: number | null;
  views: number;
  clicks: number;
  cartAdds: number;
};

export type OzonAnalyticsPeriodPreset =
  | 'today'
  | 'yesterday'
  | '7d'
  | '14d'
  | '30d'
  | 'mtd'
  | 'custom';

export const OZON_ANALYTICS_PERIOD_PRESETS: Array<{
  id: OzonAnalyticsPeriodPreset;
  label: string;
}> = [
  { id: 'today', label: 'Сегодня' },
  { id: 'yesterday', label: 'Вчера' },
  { id: '7d', label: '7 дней' },
  { id: '14d', label: '14 дней' },
  { id: '30d', label: '30 дней' },
  { id: 'mtd', label: 'С начала месяца' },
  { id: 'custom', label: 'Произвольный' },
];

/** Дефолтный набор видимых колонок (баланс полезности и компактности). */
export const DEFAULT_VISIBLE_COLUMNS: TableColumnKey[] = [
  'article',
  'name',
  'sku',
  'priceRub',
  'delivered',
  'deliveredFbo',
  'deliveredFbs',
  'revenueRub',
  'adsRub',
  'drrPct',
  'stock',
  'daysOfStock',
  'buyoutPct',
];

export const OzonAnalyticsBlockConfigSchema = z.object({
  title: z.string().default('Ozon · Аналитика'),
  accountId: z.string().nullable().default(null),
  periodPreset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('30d'),
  /** Используется при periodPreset='custom'. ISO-даты. */
  customFrom: z.string().nullable().default(null),
  customTo: z.string().nullable().default(null),
  defaultFilter: z
    .enum([
      'all',
      'with-ads',
      'high-drr',
      'low-stock',
      'no-stock',
      'no-orders',
      'no-ads',
      'unprofitable',
    ])
    .default('all'),
  visibleColumns: z
    .array(
      z.enum([
        'article',
        'name',
        'sku',
        'priceRub',
        'costRub',
        'marginRub',
        'delivered',
        'deliveredFbo',
        'deliveredFbs',
        'qtyDelivered',
        'cancelled',
        'returned',
        'returnPct',
        'revenueRub',
        'adsRub',
        'drrPct',
        'stock',
        'daysOfStock',
        'buyoutPct',
        'views',
        'clicks',
        'ctr',
        'cartAdds',
        'cpc',
        'cpm',
        'salesPerDay',
        'salesShare',
      ]),
    )
    .default(DEFAULT_VISIBLE_COLUMNS),
  /**
   * Показывать миниатюру товара (28×28) слева от названия в колонке `name`.
   * По умолчанию выключено — экономит горизонтальное место.
   * Источник изображения — metadata.primaryImage из Ozon (sync).
   */
  showProductImage: z.boolean().default(false),
  /** Цветная подсветка ячейки ДРР (фон + цвет по тоне). Default on. */
  showDrrColor: z.boolean().default(true),
  /** Цветная подсветка ячейки «Остаток» и «Дней». Default on. */
  showStockColor: z.boolean().default(true),
  /**
   * Закреплённые слева колонки (sticky). Порядок имеет значение —
   * левее в массиве = левее на экране. По умолчанию закреплён `name`
   * (как самая важная колонка для идентификации товара).
   * Закреплённые колонки не участвуют в DnD-сортировке заголовков.
   */
  pinnedColumns: z
    .array(
      z.enum([
        'article',
        'name',
        'sku',
        'priceRub',
        'costRub',
        'marginRub',
        'delivered',
        'deliveredFbo',
        'deliveredFbs',
        'qtyDelivered',
        'cancelled',
        'returned',
        'returnPct',
        'revenueRub',
        'adsRub',
        'drrPct',
        'stock',
        'daysOfStock',
        'buyoutPct',
        'views',
        'clicks',
        'ctr',
        'cartAdds',
        'cpc',
        'cpm',
        'salesPerDay',
        'salesShare',
      ]),
    )
    .default(['name']),
  /**
   * Использовать `metadata.turnoverDays` (Seller `/v1/analytics/turnover/stocks`)
   * для колонки «Дней хватит остатка» как primary source. Если данных
   * Ozon Turnover нет — приоритет: `daysOfStock` (текущий период) →
   * `daysOfStockFallback30d` (velocity по 30-дневному окну) → null.
   *
   * Default `true` (с v0.18.21): чаще всего на узких 7d-окнах нет продаж,
   * расчётный daysOfStock получается null и колонка показывала «—»
   * массово. Ozon Turnover берётся напрямую из Seller-кабинета и
   * стабильно покрывает большинство SKU.
   */
  useOzonTurnover: z.boolean().default(true),
});

export type OzonAnalyticsBlockConfig = z.infer<typeof OzonAnalyticsBlockConfigSchema>;

export type { OzonQueryPeriod, ResolveOzonQueryPeriodOptions };

/** MSC-период для API (предпочтительно). */
export function resolveOzonAnalyticsPeriod(
  preset: OzonAnalyticsPeriodPreset,
  customFrom: string | null,
  customTo: string | null,
  options?: ResolveOzonQueryPeriodOptions,
): OzonQueryPeriod {
  return resolveOzonQueryPeriod(preset, customFrom, customTo, options);
}

/** Legacy `{ from, to }` + helpers для fetch. */
export function resolvePeriod(
  preset: OzonAnalyticsPeriodPreset,
  customFrom: string | null,
  customTo: string | null,
  options?: ResolveOzonQueryPeriodOptions,
): { from: Date; to: Date; msc: OzonQueryPeriod } {
  const msc = resolveOzonQueryPeriod(preset, customFrom, customTo, options);
  return { ...ozonQueryPeriodToLegacyDates(msc), msc };
}

export { ozonPeriodToSearchParams, describeOzonQueryPeriod };
