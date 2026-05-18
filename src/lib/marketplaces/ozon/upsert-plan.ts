// PURPOSE: Pure helpers + planUnitProductUpsertFromOzon().
// Выделено из upsert.ts, чтобы можно было тестировать без db/env (см.
// scripts/test-ozon-upsert.ts). Логика идентична: см. подробный комментарий
// у `planUnitProductUpsertFromOzon` ниже.

import { rublesToKopecks } from '@/lib/unit-economics/types';
import type { ProductInfo, PricesItem, StocksItem, TurnoverRow } from './types';

export type CombinedProduct = {
  info: ProductInfo;
  prices?: PricesItem;
  stocks?: StocksItem;
  turnover?: TurnoverRow;
};

export function parseDimensions(info: ProductInfo): {
  weightG: number | null;
  dimsMm: { depth: number; width: number; height: number } | null;
  volumeLx100: number;
} {
  const weightUnit = info.weight_unit ?? 'g';
  const weight = info.weight ?? null;
  const weightG =
    weight === null
      ? null
      : weightUnit === 'kg'
        ? Math.round(weight * 1000)
        : weightUnit === 'lb'
          ? Math.round(weight * 453.592)
          : Math.round(weight);

  const dimsUnit = info.dimension_unit ?? 'mm';
  const toMm = (v: number | undefined) => {
    if (!v) return null;
    if (dimsUnit === 'cm') return v * 10;
    if (dimsUnit === 'm') return v * 1000;
    return v;
  };
  const d = toMm(info.depth);
  const w = toMm(info.width);
  const h = toMm(info.height);
  const dimsMm = d && w && h ? { depth: d, width: w, height: h } : null;
  const volumeLx100 = dimsMm
    ? Math.round(((dimsMm.depth * dimsMm.width * dimsMm.height) / 1_000_000) * 100)
    : 0;
  return { weightG, dimsMm, volumeLx100 };
}

/**
 * Парсер денежного значения от Ozon. Семантически прозрачен для трёх форматов:
 *   - строка "1 234,56" / "1234.56" / "" → Number или 0;
 *   - number 1234.56 → как есть;
 *   - null/undefined/любой не-string-нечисло → 0.
 *
 * Раньше принимал только `string | undefined` и падал `value.replace is not
 * a function`, когда Ozon отдавал price как число (это случается, если
 * lenient-клиент вернул raw payload без zod-coerce'а).
 */
export function parseMoneyRu(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;
  if (value.length === 0) return 0;
  const num = Number(value.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : 0;
}

/**
 * Нормализует primary_image: с 2026-05 Ozon отдаёт массив URL.
 * Старый формат — строка. Возвращаем массив без пустых строк.
 */
export function normalizePrimaryImage(value: string | string[] | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((s) => typeof s === 'string' && s.length > 0);
  return [value];
}

// ---------------------------------------------------------------------------
// План upsert'а unit_products — pure function, тестируется отдельно
// ---------------------------------------------------------------------------

export type UnitProductUpsertPlan = {
  insert: {
    article: string;
    sku: string;
    name: string;
    visibility: 'visible' | 'hidden';
    stockMarketplace: number;
    stockOwn: number;
    priceKopecks: number;
    volumeL: number;
  };
  /**
   * Какие поля при конфликте обновляются «свежим значением», какие —
   * оставляются на текущее значение из БД через `sql\`unit_products.X\``.
   */
  updates: {
    priceKopecks: 'fresh' | 'keep';
    volumeL: 'fresh' | 'keep';
    stockMarketplace: 'fresh' | 'keep';
    stockOwn: 'fresh' | 'keep';
    visibility: 'fresh' | 'keep';
  };
  metadataDeltaKeys: string[];
  /** Готовый metadata-объект (для тестов и JSONB-merge). */
  metadataDelta: Record<string, unknown>;
};

/**
 * Собирает план upsert'а для unit_products из payload Ozon.
 * Возвращает `null` если запись надо пропустить (нет ключей), иначе —
 * объект с диагностикой какие поля будут реально обновлены при конфликте.
 *
 * КРИТИЧЕСКОЕ ПРАВИЛО ИДЕМПОТЕНТНОСТИ:
 * Стейджи sync вызывают upsert с **частичным** payload (`products` без
 * prices/stocks, `prices` без dimensions, `stocks` без всего остального).
 * Если бы мы всегда писали все поля, поздние стейджи затирали бы данные
 * ранних (например stocks-стейдж обнулял бы priceKopecks и volumeL).
 * Поэтому в onConflict.set каждое поле обновляется только когда payload
 * фактически принёс это поле; иначе фолбэк на текущее значение в БД.
 */
export function planUnitProductUpsertFromOzon(
  payload: CombinedProduct,
): UnitProductUpsertPlan | null {
  const { info, prices, stocks, turnover } = payload;
  if (!info.id || !info.offer_id) return null;

  const dims = parseDimensions(info);
  const priceRub = parseMoneyRu(prices?.price?.price);
  const priceWithSppRub = parseMoneyRu(prices?.price?.marketing_seller_price);
  const stockMarketplace = (stocks?.stocks ?? [])
    .filter((s) => s.type === 'fbo')
    .reduce((sum, s) => sum + (s.present ?? 0), 0);
  const stockOwn = (stocks?.stocks ?? [])
    .filter((s) => s.type === 'fbs' || s.type === 'crossborder')
    .reduce((sum, s) => sum + (s.present ?? 0), 0);

  const primaryImages = normalizePrimaryImage(info.primary_image);
  const images = info.images && info.images.length > 0 ? info.images : primaryImages;

  // Усиленные предикаты: "fresh" только когда есть РЕАЛЬНЫЕ непустые данные.
  // Иначе любой пустой/нулевой payload поздних стейджей перезатирал бы
  // существующие непустые значения через `set: priceKopecks = 0`.
  const hasPriceValue = priceRub > 0;
  const hasPriceWithSpp = priceWithSppRub > 0;
  const hasStocks = Boolean(stocks);
  const hasDims = dims.dimsMm !== null;
  const hasWeight = dims.weightG !== null;
  const hasVisible = typeof info.visible === 'boolean';
  const hasImages =
    Array.isArray(info.images) && info.images.length > 0 ? true : primaryImages.length > 0;
  const hasTurnover = Boolean(turnover);
  const fboPctRaw = prices?.commissions?.sales_percent_fbo ?? null;
  const fbsPctRaw = prices?.commissions?.sales_percent_fbs ?? null;
  const fboFulfillmentRaw = prices?.commissions?.fbo_fulfillment_amount ?? null;
  const hasFboCommission = typeof fboPctRaw === 'number' && fboPctRaw > 0;
  const hasFbsCommission = typeof fbsPctRaw === 'number' && fbsPctRaw > 0;
  const hasAnyCommission = hasFboCommission || hasFbsCommission;
  const hasFboFulfillment = typeof fboFulfillmentRaw === 'number' && fboFulfillmentRaw > 0;

  const metadataDelta: Record<string, unknown> = {
    productId: info.id,
    syncedAt: new Date().toISOString(),
  };
  if (hasImages) {
    metadataDelta.images = images;
    metadataDelta.primaryImage = primaryImages[0] ?? null;
  }
  if (hasWeight) metadataDelta.weightG = dims.weightG;
  if (hasDims) metadataDelta.dimensionsMm = dims.dimsMm;
  if (hasPriceWithSpp) metadataDelta.priceWithSpp = priceWithSppRub;
  // commissions пишем только если есть хотя бы один НЕнулевой процент;
  // JSONB-merge `||` иначе перезаписал бы существующие проценты на null.
  if (hasAnyCommission || hasFboFulfillment) {
    const commissions: Record<string, number | null> = {};
    if (hasFboCommission) commissions.fboPct = fboPctRaw;
    if (hasFbsCommission) commissions.fbsPct = fbsPctRaw;
    if (hasFboFulfillment) commissions.fboFulfillmentRub = fboFulfillmentRaw;
    metadataDelta.commissions = commissions;
  }
  if (hasTurnover) {
    metadataDelta.turnoverIdc = turnover?.idc ?? null;
    metadataDelta.turnoverDays = turnover?.turnover ?? null;
  }
  if (hasStocks) metadataDelta.stockByType = stocks?.stocks ?? [];

  return {
    insert: {
      article: info.offer_id,
      sku: String(info.id),
      name: info.name ?? info.offer_id,
      visibility: info.visible === false ? 'hidden' : 'visible',
      stockMarketplace: hasStocks ? stockMarketplace : 0,
      stockOwn: hasStocks ? stockOwn : 0,
      priceKopecks: hasPriceValue ? rublesToKopecks(priceRub) : 0,
      volumeL: hasDims ? dims.volumeLx100 : 0,
    },
    updates: {
      priceKopecks: hasPriceValue ? 'fresh' : 'keep',
      volumeL: hasDims ? 'fresh' : 'keep',
      stockMarketplace: hasStocks ? 'fresh' : 'keep',
      stockOwn: hasStocks ? 'fresh' : 'keep',
      visibility: hasVisible ? 'fresh' : 'keep',
    },
    metadataDeltaKeys: Object.keys(metadataDelta),
    metadataDelta,
  };
}
