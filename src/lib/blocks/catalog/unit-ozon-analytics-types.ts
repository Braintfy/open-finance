// PURPOSE: Конфиг-схема и константы для блока unit.ozon-analytics.
// Выделено в отдельный файл, чтобы settings-form мог импортировать без
// циклической зависимости с client-only React-компонентом блока.

import { z } from 'zod';
import type { TableColumnKey } from '@/components/unit-economics/ozon-analytics-table';

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
  stockMarketplace: number;
  stockOwn: number;
  priceRub: number;
  costRub: number;
  delivered: number;
  cancelled: number;
  returned: number;
  qtyDelivered: number;
  revenueRub: number;
  adsRub: number;
  drrPct: number | null;
  buyoutPct: number | null;
  daysOfStock: number | null;
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
});

export type OzonAnalyticsBlockConfig = z.infer<typeof OzonAnalyticsBlockConfigSchema>;

/** Преобразует preset в from/to. customFrom/customTo используется при 'custom'. */
export function resolvePeriod(
  preset: OzonAnalyticsPeriodPreset,
  customFrom: string | null,
  customTo: string | null,
): { from: Date; to: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 3600 * 1000);

  switch (preset) {
    case 'today':
      return { from: today, to: tomorrow };
    case 'yesterday': {
      const yesterday = new Date(today.getTime() - 24 * 3600 * 1000);
      return { from: yesterday, to: today };
    }
    case '7d':
      return { from: new Date(today.getTime() - 7 * 24 * 3600 * 1000), to: tomorrow };
    case '14d':
      return { from: new Date(today.getTime() - 14 * 24 * 3600 * 1000), to: tomorrow };
    case '30d':
      return { from: new Date(today.getTime() - 30 * 24 * 3600 * 1000), to: tomorrow };
    case 'mtd': {
      const mtd = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: mtd, to: tomorrow };
    }
    case 'custom': {
      const from = customFrom ? new Date(customFrom) : new Date(today.getTime() - 30 * 24 * 3600 * 1000);
      const to = customTo ? new Date(customTo) : tomorrow;
      return { from, to };
    }
    default:
      return { from: new Date(today.getTime() - 30 * 24 * 3600 * 1000), to: tomorrow };
  }
}
