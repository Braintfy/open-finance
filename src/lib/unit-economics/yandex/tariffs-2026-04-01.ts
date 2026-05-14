// PURPOSE: Тарифный пакет Яндекс Маркет, версия 2026-04-01.
// Источник смыслов: публичные формулы Синего Рассвета (yandex.html) +
// тарифы Яндекс Маркет (FBY/FBS/DBS/Express, спецтарифы, Fixed для FBY/FBS<=300₽).

export const YANDEX_TARIFF_VERSION = 'yandex_2026_04_01';

/** Объём в дм³ = ceil(L*W*H / 1000) при габаритах в см. */
export function calcVolume(lengthCm: number, widthCm: number, heightCm: number): number {
  const v = (lengthCm * widthCm * heightCm) / 1000;
  return v > 0 ? Math.ceil(v) : 0;
}

/** Фиксированный тариф для FBY/FBS если price<=300 и volume<=5 дм³. */
export function shouldUseFixedTariff(price: number, volume: number, mode: string): boolean {
  if (mode !== 'fby' && mode !== 'fbs') return false;
  return price <= 300 && volume <= 5;
}

export const FIXED_TARIFF = 25; // ₽

/** Фулфилмент Яндекс по объёму и режиму. */
export function fulfillmentCost(volume: number, mode: 'fby' | 'fbs' | 'dbs' | 'express'): number {
  if (mode === 'dbs' || mode === 'express') return 0;
  if (volume <= 1) return 30;
  if (volume <= 5) return 30 + (volume - 1) * 10;
  if (volume <= 25) return 70 + (volume - 5) * 8;
  return 230 + (volume - 25) * 5;
}

/** Last mile (последняя миля) — фиксированный процент от цены. */
export const LAST_MILE_PCT = 5;
export const LAST_MILE_MIN = 50;
export const LAST_MILE_MAX = 500;

export function lastMileCost(customerPrice: number): number {
  const raw = (customerPrice * LAST_MILE_PCT) / 100;
  return Math.min(LAST_MILE_MAX, Math.max(LAST_MILE_MIN, raw));
}

/** Middle mile — для FBS/DBS/Express зависит от объёма. */
export function middleMileCost(volume: number, mode: 'fby' | 'fbs' | 'dbs' | 'express'): number {
  if (mode === 'fby') return 0;
  if (volume <= 5) return 25;
  if (volume <= 25) return 60;
  return 150;
}

/** Спецтариф (% от цены). */
export function specialTariffPct(special: string, mode: string): number {
  if (special === 'showcase') return 5;
  if (special === 'subscription_fby' && mode === 'fby') return 9;
  if (special === 'subscription_fbs' && mode === 'fbs') return 16;
  return 0;
}

/** Хранение FBY: на единицу в день. */
export const FBY_STORAGE_PER_UNIT_DAY = 0.15;

export const YANDEX_DEFAULTS = {
  acquiringPct: 1.5,
  buyoutPct: 95,
  drrPct: 5,
  taxRatePct: 6,
  commissionPct: 7,
  storagePerUnit: 0,
  fbsFastShipDiscountPct: 0,
} as const;
