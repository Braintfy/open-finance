// PURPOSE: Тарифный пакет Яндекс Маркет, версия 2026-07-01.
// Снимок тарифов на дату последнего известного изменения (отмена спецтарифа
// «Витрина» с 01.07.2026). Пакет 2026-04-01 заморожен и не редактируется.
//
// Отличия от пакета 2026-04-01:
//  1. `fulfillmentCost()` УДАЛЁН — такой статьи в тарифах ЯМ нет. Вместо неё
//     «Обработка заказа»: 25 ₽ на FBS, 0 на FBY/DBS/Express.
//  2. Средняя миля — прогрессивная шкала (80 ₽ за первый литр + 9/7/5 ₽ за литр)
//     с потолком 5500 ₽; применяется к FBY/FBS/Express (раньше: ступенька
//     25/60/150 ₽ и 0 ₽ для FBY).
//  3. `FIXED_TARIFF = 25 ₽` заменён на ПРОЦЕНТ от цены: FBY 35%, FBS 42%.
//  4. Спецтариф теперь ЗАМЕНЯЕТ комиссию, а не складывается с ней.
//     «Витрина 5%» отменена с 01.07.2026; добавлена «Подписка Express 9%».
//  5. Новые статьи: возвраты, хранение невыкупа, перевод платежей,
//     приём платежей (0.12 ₽ за SKU).
//  6. `FBY_STORAGE_PER_UNIT_DAY` удалён (нигде не использовался).

export const YANDEX_TARIFF_VERSION = 'yandex_2026_07_01';

/** Объём в дм³ (= литрах) = ceil(L*W*H / 1000) при габаритах в см. */
export function calcVolume(lengthCm: number, widthCm: number, heightCm: number): number {
  const v = (lengthCm * widthCm * heightCm) / 1000;
  return v > 0 ? Math.ceil(v) : 0;
}

// ============================================================================
// Фиксированный тариф (дешёвые компактные товары)
// ============================================================================

/** Фиксированный тариф применяется для FBY/FBS если price<=300 и volume<=5 дм³. */
export function shouldUseFixedTariff(price: number, volume: number, mode: string): boolean {
  if (mode !== 'fby' && mode !== 'fbs') return false;
  return price <= 300 && volume <= 5;
}

/**
 * Фиксированный тариф — ПРОЦЕНТ от цены товара, покрывающий размещение,
 * обработку и доставку (в пакете 2026-04-01 ошибочно был фиксом 25 ₽).
 * Приём/перевод платежей тарифицируется отдельно.
 */
export const FIXED_TARIFF_PCT: Record<'fby' | 'fbs', number> = {
  fby: 35,
  fbs: 42,
};

export function fixedTariffPct(mode: string): number | null {
  if (mode === 'fby' || mode === 'fbs') return FIXED_TARIFF_PCT[mode];
  return null;
}

// ============================================================================
// Обработка заказа (замена несуществующего «фулфилмента»)
// ============================================================================

/** Обработка заказа на складе продавца (FBS), ₽ за заказ. */
export const ORDER_PROCESSING_FBS_RUB = 25;

export function orderProcessingCost(mode: 'fby' | 'fbs' | 'dbs' | 'express'): number {
  return mode === 'fbs' ? ORDER_PROCESSING_FBS_RUB : 0;
}

// ============================================================================
// Логистика
// ============================================================================

/** Last mile (последняя миля) — процент от цены с минимумом и потолком. */
export const LAST_MILE_PCT = 5;
export const LAST_MILE_MIN = 50;
export const LAST_MILE_MAX = 500;

export function lastMileCost(price: number): number {
  const raw = (price * LAST_MILE_PCT) / 100;
  return Math.min(LAST_MILE_MAX, Math.max(LAST_MILE_MIN, raw));
}

/**
 * Средняя миля — прогрессивная шкала по объёму (литры = дм³):
 *   80 ₽ за первый литр
 * + 9 ₽/л на участке 1–30 л
 * + 7 ₽/л на участке 30–200 л
 * + 5 ₽/л свыше 200 л
 * Потолок — 5500 ₽. Для DBS средняя миля не начисляется (доставляет продавец).
 */
export const MIDDLE_MILE_FIRST_LITRE_RUB = 80;
export const MIDDLE_MILE_CAP_RUB = 5500;

export function middleMileCost(volumeL: number, mode: 'fby' | 'fbs' | 'dbs' | 'express'): number {
  if (mode === 'dbs') return 0;
  const v = Math.max(0, Number(volumeL) || 0);
  if (v <= 0) return 0;
  let cost = MIDDLE_MILE_FIRST_LITRE_RUB;
  if (v > 1) cost += Math.min(v, 30) * 9 - 9;
  if (v > 30) cost += (Math.min(v, 200) - 30) * 7;
  if (v > 200) cost += (v - 200) * 5;
  return Math.min(Math.round(cost * 100) / 100, MIDDLE_MILE_CAP_RUB);
}

// ============================================================================
// Возвраты и хранение невыкупа
// ============================================================================

/** Обработка возврата (невыкупа), ₽ за возврат — сверх обратной средней мили. */
export const RETURN_HANDLING_RUB = 15;

/** Хранение невыкупа: ₽ за единицу в день после льготного периода. */
export const RETURN_STORAGE_PER_DAY_RUB = 15;
export const RETURN_STORAGE_FREE_DAYS = 5;

// ============================================================================
// Платежи
// ============================================================================

/**
 * «Перевод платежей» — процент, зависит от частоты выплат (1.6–3.3%).
 * В инпутах это поле `acquiringPct`; дефолт — середина диапазона.
 */
export const PAYMENT_TRANSFER_PCT_MIN = 1.6;
export const PAYMENT_TRANSFER_PCT_MAX = 3.3;
export const PAYMENT_TRANSFER_PCT_DEFAULT = 2.5;

/** «Приём платежей» — фикс за SKU в заказе, ₽. */
export const PAYMENT_ACCEPTANCE_FEE_RUB = 0.12;

// ============================================================================
// Спецтарифы
// ============================================================================

/**
 * Спецтариф ЗАМЕНЯЕТ ставку комиссии (в пакете 2026-04-01 он ошибочно
 * складывался с ней). `null` — спецтарифа нет, используется ручная комиссия.
 *
 * «Витрина» (showcase, 5%) отменена с 01.07.2026 — ключ сохранён только
 * для обратной совместимости старых конфигов и трактуется как «нет спецтарифа».
 */
export const SPECIAL_TARIFF_PCT: Record<string, { pct: number; mode: string }> = {
  subscription_fby: { pct: 9, mode: 'fby' },
  subscription_fbs: { pct: 16, mode: 'fbs' },
  subscription_express: { pct: 9, mode: 'express' },
};

export function specialTariffPct(special: string, mode: string): number | null {
  const entry = SPECIAL_TARIFF_PCT[special];
  if (!entry) return null;
  if (entry.mode !== mode) return null;
  return entry.pct;
}

export const YANDEX_DEFAULTS = {
  /** «Перевод платежей», % */
  acquiringPct: PAYMENT_TRANSFER_PCT_DEFAULT,
  buyoutPct: 85,
  drrPct: 5,
  taxRatePct: 6,
  commissionPct: 30,
  storagePerUnit: 0,
  returnStorageDays: 0,
  fbsFastShipDiscountPct: 0,
} as const;
