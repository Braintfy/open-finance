// PURPOSE: Mapping Ozon-Аналитики → колонки/строки блока «Мой магазин» (v0.22.0).
// Используется в OzonImportFromAnalyticsDialog для:
//   1. определения какие колонки добавить в config (если их ещё нет),
//   2. extract значений из OzonAnalyticsRow в row.values,
//   3. merge новых данных в существующие строки by article/sku.

import type { OzonAnalyticsRow } from '@/lib/blocks/catalog/unit-ozon-analytics-types';
import type { TableColumnKey } from '@/components/unit-economics/ozon-analytics-table';

/** Описание целевой колонки в config.columns my-store-table. */
export type MyStoreColumnDef = {
  id: string;
  label: string;
  type: 'number' | 'percent' | 'money' | 'text';
  unit?: string;
  width?: number;
};

/** Map Ozon-колонок → my-store-колонок (id = ключ Ozon, без префикса). */
export const OZON_TO_MY_STORE_COLUMN_MAP: Record<TableColumnKey, MyStoreColumnDef> = {
  article: { id: 'ozonArticle', label: 'Артикул Ozon', type: 'text', width: 120 },
  name: { id: 'ozonName', label: 'Название Ozon', type: 'text', width: 200 },
  sku: { id: 'ozonSku', label: 'SKU Ozon', type: 'text', width: 110 },
  priceRub: { id: 'ozonPriceRub', label: 'Цена Ozon', type: 'money', unit: '₽', width: 100 },
  costRub: { id: 'ozonCostRub', label: 'Себест. Ozon', type: 'money', unit: '₽', width: 100 },
  marginRub: { id: 'ozonMarginRub', label: 'Маржа Ozon', type: 'money', unit: '₽', width: 100 },
  delivered: { id: 'ozonDelivered', label: 'Заказы Ozon', type: 'number', unit: 'шт', width: 80 },
  deliveredFbo: { id: 'ozonDeliveredFbo', label: 'FBO', type: 'number', unit: 'шт', width: 70 },
  deliveredFbs: { id: 'ozonDeliveredFbs', label: 'FBS', type: 'number', unit: 'шт', width: 70 },
  qtyDelivered: {
    id: 'ozonQtyDelivered',
    label: 'Шт. в заказах',
    type: 'number',
    unit: 'шт',
    width: 90,
  },
  cancelled: { id: 'ozonCancelled', label: 'Отмены', type: 'number', unit: 'шт', width: 80 },
  returned: { id: 'ozonReturned', label: 'Возвраты', type: 'number', unit: 'шт', width: 80 },
  returnPct: { id: 'ozonReturnPct', label: '% возвратов', type: 'percent', width: 90 },
  revenueRub: { id: 'ozonRevenueRub', label: 'Выручка Ozon', type: 'money', unit: '₽', width: 120 },
  adsRub: { id: 'ozonAdsRub', label: 'Реклама Ozon', type: 'money', unit: '₽', width: 100 },
  drrPct: { id: 'ozonDrrPct', label: 'ДРР Ozon', type: 'percent', width: 80 },
  stock: { id: 'ozonStock', label: 'Остаток Ozon', type: 'number', unit: 'шт', width: 80 },
  stockFbo: { id: 'ozonStockFbo', label: 'Ост. FBO', type: 'number', unit: 'шт', width: 80 },
  stockFbs: { id: 'ozonStockFbs', label: 'Ост. FBS', type: 'number', unit: 'шт', width: 80 },
  daysOfStock: { id: 'ozonDaysOfStock', label: 'Дней Ozon', type: 'number', width: 70 },
  buyoutPct: { id: 'ozonBuyoutPct', label: 'Выкуп %', type: 'percent', width: 80 },
  views: { id: 'ozonViews', label: 'Показы', type: 'number', unit: 'шт', width: 80 },
  clicks: { id: 'ozonClicks', label: 'Клики', type: 'number', unit: 'шт', width: 80 },
  ctr: { id: 'ozonCtr', label: 'CTR', type: 'percent', width: 70 },
  cartAdds: { id: 'ozonCartAdds', label: 'В корзину', type: 'number', unit: 'шт', width: 80 },
  cpc: { id: 'ozonCpc', label: 'CPC', type: 'money', unit: '₽', width: 80 },
  cpm: { id: 'ozonCpm', label: 'CPM', type: 'money', unit: '₽', width: 80 },
  salesPerDay: { id: 'ozonSalesPerDay', label: 'Прод/день', type: 'number', unit: 'шт', width: 80 },
  salesShare: { id: 'ozonSalesShare', label: 'Доля %', type: 'percent', width: 70 },
};

/** Extract значение для my-store колонки из OzonAnalyticsRow. */
export function extractOzonValue(
  row: OzonAnalyticsRow,
  key: TableColumnKey,
): number | string | null {
  switch (key) {
    case 'article':
      return row.article ?? null;
    case 'name':
      return row.name;
    case 'sku':
      return row.sku ?? null;
    case 'priceRub':
      return row.priceRub;
    case 'costRub':
      return row.costRub;
    case 'marginRub':
      return row.priceRub - row.costRub;
    case 'delivered':
      return row.delivered;
    case 'deliveredFbo':
      return row.deliveredFbo;
    case 'deliveredFbs':
      return row.deliveredFbs;
    case 'qtyDelivered':
      return row.qtyDelivered;
    case 'cancelled':
      return row.cancelled;
    case 'returned':
      return row.returned;
    case 'returnPct': {
      const total = row.delivered + row.returned;
      return total > 0 ? (row.returned / total) * 100 : 0;
    }
    case 'revenueRub':
      return row.revenueRub;
    case 'adsRub':
      return row.adsRub;
    case 'drrPct':
      return row.drrPct ?? 0;
    case 'stock':
      return row.stockMarketplace + row.stockOwn;
    case 'stockFbo':
      return row.stockMarketplace;
    case 'stockFbs':
      return row.stockOwn;
    case 'daysOfStock':
      return row.daysOfStock ?? 0;
    case 'buyoutPct':
      return row.buyoutPct ?? 0;
    case 'views':
      return row.views;
    case 'clicks':
      return row.clicks;
    case 'ctr':
      return row.views > 0 ? (row.clicks / row.views) * 100 : 0;
    case 'cartAdds':
      return row.cartAdds;
    case 'cpc':
      return row.clicks > 0 ? row.adsCpcRub / row.clicks : 0;
    case 'cpm':
      return row.views > 0 ? (row.adsCpcRub / row.views) * 1000 : 0;
    case 'salesPerDay':
      // grossly approximate — UI table делает это сложнее, но для import достаточно delivered.
      return row.delivered;
    case 'salesShare':
      return 0; // зависит от агрегата по всем строкам, выставляется отдельно.
    default:
      return null;
  }
}

/** Default набор колонок при первом импорте. */
export const DEFAULT_IMPORT_COLUMNS: TableColumnKey[] = [
  'priceRub',
  'costRub',
  'delivered',
  'revenueRub',
  'stock',
];

export type ImportMode = 'replace' | 'merge';
export type MatchBy = 'article' | 'sku';

/**
 * Конфигурация source-блока (snapshot из @blocks/sources API или live config).
 * Минимум что нужно для re-fetch: accountId + период.
 */
export type OzonAnalyticsSourceConfig = {
  accountId: string | null;
  periodPreset: string;
  customFrom: string | null;
  customTo: string | null;
};
