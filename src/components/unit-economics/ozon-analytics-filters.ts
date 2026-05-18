// PURPOSE: Pure-function smart-filters для Ozon-аналитики.
// Тестируется отдельно, без React. UI компонент тонкий — мапит chip → filter id.

import type { OzonAnalyticsRow } from '@/lib/blocks/catalog/unit-ozon-analytics-types';

export type AnalyticsFilterId =
  | 'all'
  | 'with-ads'
  | 'high-drr'
  | 'low-stock'
  | 'no-stock'
  | 'no-orders'
  | 'no-ads'
  | 'unprofitable';

/**
 * Smart-rules: что-нибудь полезное за 1 клик.
 * Все правила — pure, безопасны (нет деления на 0, всегда возвращают boolean).
 */
export const ANALYTICS_FILTERS: Array<{
  id: AnalyticsFilterId;
  label: string;
  hint: string;
  /** Цвет chip'а — для визуальной семантики. */
  tone: 'neutral' | 'warning' | 'danger' | 'success';
}> = [
  { id: 'all', label: 'Все товары', hint: 'Без фильтра', tone: 'neutral' },
  {
    id: 'with-ads',
    label: 'С рекламой',
    hint: 'Есть расходы на рекламу за период',
    tone: 'neutral',
  },
  {
    id: 'high-drr',
    label: 'ДРР > 20%',
    hint: 'Высокая доля рекламных расходов — слив бюджета',
    tone: 'warning',
  },
  {
    id: 'no-ads',
    label: 'Без рекламы, но с продажами',
    hint: 'Органика — кандидат на масштабирование',
    tone: 'success',
  },
  {
    id: 'low-stock',
    label: 'Мало остатков',
    hint: '< 14 дней при текущей скорости продаж',
    tone: 'warning',
  },
  {
    id: 'no-stock',
    label: 'Нет остатков',
    hint: 'Stock = 0 — потери продаж',
    tone: 'danger',
  },
  {
    id: 'no-orders',
    label: 'Без заказов',
    hint: 'Нет ни одного delivered за период — кандидат на удаление',
    tone: 'warning',
  },
  {
    id: 'unprofitable',
    label: 'Убыточные',
    hint: 'Расход на рекламу больше выручки (drr > 100%)',
    tone: 'danger',
  },
];

const LOW_STOCK_DAYS_THRESHOLD = 14;
const HIGH_DRR_THRESHOLD = 20;

export function applyAnalyticsFilter(
  rows: OzonAnalyticsRow[],
  filter: AnalyticsFilterId,
): OzonAnalyticsRow[] {
  switch (filter) {
    case 'all':
      return rows;
    case 'with-ads':
      return rows.filter((r) => r.adsRub > 0);
    case 'high-drr':
      return rows.filter((r) => (r.drrPct ?? 0) > HIGH_DRR_THRESHOLD);
    case 'no-ads':
      return rows.filter((r) => r.adsRub === 0 && r.delivered > 0);
    case 'low-stock':
      return rows.filter(
        (r) =>
          r.daysOfStock !== null &&
          r.daysOfStock < LOW_STOCK_DAYS_THRESHOLD &&
          r.stockMarketplace + r.stockOwn > 0,
      );
    case 'no-stock':
      return rows.filter((r) => r.stockMarketplace + r.stockOwn === 0);
    case 'no-orders':
      return rows.filter((r) => r.delivered === 0);
    case 'unprofitable':
      return rows.filter((r) => r.drrPct !== null && r.drrPct > 100);
    default:
      return rows;
  }
}

export function countFilterMatches(
  rows: OzonAnalyticsRow[],
  filter: AnalyticsFilterId,
): number {
  return applyAnalyticsFilter(rows, filter).length;
}
