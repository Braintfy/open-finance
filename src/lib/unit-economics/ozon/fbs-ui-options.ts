// PURPOSE: Опции выпадающих списков Ozon FBS (точка сдачи, скорость отгрузки,
// отсрочка выплат) + подписи скидок для UI-блоков. Чистый модуль без React:
// все знаки (скидка/надбавка) берутся из тарифного пакета, чтобы подпись
// в интерфейсе не могла разойтись с расчётом.
//
// Почему отдельный файл: логика «какая сетка скоростей действует для точки
// сдачи» и «во что превратить legacy-ключ» нужна и одиночному калькулятору,
// и мульти-таблице. Дублировать её в двух 'use client'-файлах нельзя —
// разъедется при следующем обновлении тарифов.

import type { OzonFbsDropoffPoint, OzonFbsShipmentSpeed } from '../types';
import {
  FBS_CLUSTER_BY_KEY,
  FBS_DROPOFF_LABELS,
  FBS_SHIPMENT_SPEED_LABELS_PICKUP_POINT,
  FBS_SHIPMENT_SPEED_LABELS_SORTING_CENTER,
  fbsShipmentSpeedCommissionPp,
  FBO_ACCEPTANCE_BASE_RUB,
  FBO_ACCEPTANCE_CAP_RUB,
  LOCALITY_COMMISSION_DISCOUNT_PP,
  LOCALITY_DISCOUNT_EXCLUDED_CLUSTERS,
  PAYMENT_DEFERRAL_OPTIONS,
  paymentDeferralDiscountPp,
} from './tariffs-2026-08-30';

export type SelectOption = { value: string; label: string };

/** Точки сдачи, тарифицируемые по сетке скоростей «ПВЗ / ППЗ». */
const PICKUP_GRID_DROPOFFS = new Set<string>(['pickup_point', 'utk', 'gorbushka']);

export function isPickupGridDropoff(dropoff: string | undefined): boolean {
  return PICKUP_GRID_DROPOFFS.has(dropoff ?? '');
}

/** Точки сдачи FBS (5 шт., приёмка зашита в подпись). */
export const FBS_DROPOFF_OPTIONS: SelectOption[] = Object.entries(FBS_DROPOFF_LABELS).map(
  ([value, label]) => ({ value, label }),
);

function speedLabelsFor(dropoff: string | undefined): Record<string, string> {
  return isPickupGridDropoff(dropoff)
    ? FBS_SHIPMENT_SPEED_LABELS_PICKUP_POINT
    : FBS_SHIPMENT_SPEED_LABELS_SORTING_CENTER;
}

/**
 * Опции скорости отгрузки для АКТУАЛЬНОЙ сетки выбранной точки сдачи.
 * Legacy-ключи (`fast`/`standard`/`slow`) в список не попадают — они
 * приводятся к эквиваленту через `normalizeFbsSpeed` при отображении.
 */
export function fbsSpeedOptions(dropoff: string | undefined): SelectOption[] {
  return Object.entries(speedLabelsFor(dropoff)).map(([value, label]) => ({ value, label }));
}

/**
 * Ближайшая по эффекту скорость в сетке `toDropoff`.
 * Используется в двух случаях:
 *  - смена точки сдачи (сетки разные — надо перенести выбор, а не молча
 *    оставить ключ, которого в новой сетке нет: движок трактует его как 0 п.п.);
 *  - отображение legacy-значения из сохранённого конфига (`fast`/`standard`/`slow`)
 *    — подбирается ключ с ТЕМ ЖЕ эффектом в п.п.
 */
export function remapFbsSpeed(
  speed: OzonFbsShipmentSpeed | string | undefined,
  fromDropoff: string | undefined,
  toDropoff: string | undefined,
): OzonFbsShipmentSpeed {
  const targetKeys = Object.keys(speedLabelsFor(toDropoff)) as OzonFbsShipmentSpeed[];
  const current = (speed ?? '') as OzonFbsShipmentSpeed;
  if (targetKeys.includes(current)) return current;
  const targetPp = fbsShipmentSpeedCommissionPp(fromDropoff ?? 'sorting_center', String(speed ?? ''));
  let best = targetKeys[0];
  let bestDelta = Number.POSITIVE_INFINITY;
  for (const key of targetKeys) {
    const delta = Math.abs(fbsShipmentSpeedCommissionPp(toDropoff ?? 'sorting_center', key) - targetPp);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = key;
    }
  }
  return best;
}

/**
 * Значение для дроп-дауна: приводит сохранённое (в т.ч. legacy) значение
 * к ключу текущей сетки с идентичным эффектом в п.п.
 */
export function normalizeFbsSpeed(
  speed: OzonFbsShipmentSpeed | string | undefined,
  dropoff: string | undefined,
): OzonFbsShipmentSpeed {
  return remapFbsSpeed(speed, dropoff, dropoff);
}

function formatPp(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value);
}

/**
 * Опции отсрочки выплат со ЗНАКОМ эффекта в подписи (это всегда скидка).
 * Если в конфиге лежит значение вне сетки — оно добавляется первым пунктом
 * с фактической (округлённой вниз до полных 14 дней) скидкой.
 */
export function paymentDeferralOptions(current?: number): SelectOption[] {
  const options: SelectOption[] = PAYMENT_DEFERRAL_OPTIONS.map((days) => ({
    value: String(days),
    label:
      days === 0
        ? 'без отсрочки (0 дн.)'
        : `${days} дн. (−${formatPp(paymentDeferralDiscountPp(days))} п.п. ком.)`,
  }));
  const value = Number(current ?? 0);
  if (Number.isFinite(value) && !(PAYMENT_DEFERRAL_OPTIONS as readonly number[]).includes(value)) {
    options.unshift({
      value: String(value),
      label: `${value} дн. (−${formatPp(paymentDeferralDiscountPp(value))} п.п. ком.)`,
    });
  }
  return options;
}

/** Подписи и тултипы, зависящие от тарифных констант. */
export const LOCALITY_EXCLUDED_LABELS = Array.from(LOCALITY_DISCOUNT_EXCLUDED_CLUSTERS)
  .map((key) => FBS_CLUSTER_BY_KEY[key]?.label ?? key)
  .join(', ');

export const LOCALITY_DISCOUNT_LABEL = `Локальность −${LOCALITY_COMMISSION_DISCOUNT_PP} п.п.`;

export const LOCALITY_DISCOUNT_HINT =
  `Скидка ${LOCALITY_COMMISSION_DISCOUNT_PP} п.п. к КОМИССИИ за локальный товар (с 30.08.2026). ` +
  `Не действует для кластеров: ${LOCALITY_EXCLUDED_LABELS}. ` +
  'При multi-cluster FBS применяется пропорционально доле неисключённых кластеров.';

export const FBO_ACCEPTANCE_HINT =
  'Бесплатная приёмка поставки FBO. Если выключить — начисляется «обработка в составе ' +
  `грузоместа»: min(${FBO_ACCEPTANCE_BASE_RUB} + (литраж − 1), ${FBO_ACCEPTANCE_CAP_RUB}) ₽ за единицу. ` +
  'На приёмку FBS не влияет — она зависит от точки сдачи.';

export const LOCAL_CLUSTER_HINT =
  'Локальный склад логистики: ×1 к прямой логистике, нелокальный — ×1.25. ' +
  'Используется для FBO и как fallback, если кластеры FBS не выбраны. ' +
  'Со скидкой за локальность (−3 п.п. к комиссии) не связано.';

/** Точка сдачи → приёмка за заказ, для тултипов. */
export function dropoffLabel(dropoff: OzonFbsDropoffPoint | string | undefined): string {
  return FBS_DROPOFF_LABELS[String(dropoff ?? 'sorting_center')] ?? String(dropoff ?? '—');
}
