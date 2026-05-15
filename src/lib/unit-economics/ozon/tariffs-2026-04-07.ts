// PURPOSE: Тарифный пакет Ozon, версия 2026-04-07. Версия фиксируется,
// чтобы старые сохранённые расчёты не ломались при будущем обновлении тарифов.
// Источник смыслов: публичные формулы Синего Рассвета (ozon.html) +
// приёмо-передаточные коэффициенты Ozon (FBO/FBS, локальный/нелокальный кластер).

export const OZON_TARIFF_VERSION = 'ozon_2026_04_07';

/**
 * Авто-комиссия Ozon по диапазонам цены покупателя:
 * - <= 100₽: 14%
 * - 101..300₽: 20%
 * - > 300₽: используется ручная категорийная ставка из inputs.commissionPct
 */
export function autoCommissionPct(buyerPrice: number, manualPct: number): number {
  if (buyerPrice <= 100) return 14;
  if (buyerPrice <= 300) return 20;
  return manualPct;
}

/** Стоимость FBO логистики на единицу по объёму. */
export function fboLogisticsCost(volumeL: number): number {
  if (volumeL <= 0.4) return 35;
  if (volumeL <= 1) return 50;
  if (volumeL <= 5) return 76 + Math.max(0, volumeL - 1) * 6;
  if (volumeL <= 25) return 130 + Math.max(0, volumeL - 5) * 10;
  if (volumeL <= 75) return 350 + Math.max(0, volumeL - 25) * 6;
  return 660 + Math.max(0, volumeL - 75) * 4;
}

/** Стоимость FBS логистики на единицу по объёму. */
export function fbsLogisticsCost(volumeL: number): number {
  if (volumeL <= 0.4) return 45;
  if (volumeL <= 1) return 65;
  if (volumeL <= 5) return 90 + Math.max(0, volumeL - 1) * 8;
  if (volumeL <= 25) return 160 + Math.max(0, volumeL - 5) * 12;
  return 400 + Math.max(0, volumeL - 25) * 7;
}

/** Коэффициент нелокального кластера (логистика дороже на ~25%). */
export const NON_LOCAL_CLUSTER_MULTIPLIER = 1.25;

/** Скидка >50 заказов FBO в неделю — снижение логистики на 15%. */
export const HIGH_VOLUME_FBO_DISCOUNT = 0.15;

/** Возврат: процент от логистики FBO (приёмка возврата + обработка). */
export const RETURN_LOGISTICS_PCT_OF_FORWARD = 0.5;

/**
 * Надбавка к комиссии за быструю отгрузку FBS (12–24 ч).
 * Источник: FBS-калькулятор Синего Рассвета (опция «12-24 ч (+2% ком.)»).
 */
export const FBS_FAST_SHIPMENT_COMMISSION_BUMP_PCT = 2;

/**
 * Карта складов FBS → локальный/нелокальный кластер по умолчанию.
 * Если склад в карте — берётся это значение; иначе — true (локальный).
 * Слаг 'other' трактуется как нелокальный (если пользователь явно не переопределит
 * глобальный isLocalCluster).
 */
export const FBS_WAREHOUSE_LOCAL_BY_DEFAULT: Record<string, boolean> = {
  almaty: true,
  moscow: true,
  spb: true,
  ekaterinburg: true,
  kazan: true,
  novosibirsk: true,
  rostov: true,
  krasnodar: true,
  other: false,
};

/** Человекочитаемые подписи складов FBS (для UI). */
export const FBS_WAREHOUSE_LABELS: Record<string, string> = {
  almaty: 'Алматы',
  moscow: 'Москва',
  spb: 'Санкт-Петербург',
  ekaterinburg: 'Екатеринбург',
  kazan: 'Казань',
  novosibirsk: 'Новосибирск',
  rostov: 'Ростов-на-Дону',
  krasnodar: 'Краснодар',
  other: 'Прочий склад',
};

/** Подписи точек сдачи FBS. */
export const FBS_DROPOFF_LABELS: Record<string, string> = {
  sorting_center: 'Сортировочный центр',
  pickup_point: 'Пункт приёма',
  ozon_warehouse: 'Склад Ozon',
};

/** Подписи скоростей отгрузки FBS. */
export const FBS_SHIPMENT_SPEED_LABELS: Record<string, string> = {
  fast: '12–24 ч (+2% ком.)',
  standard: '24–48 ч',
  slow: '48–72 ч',
};

/** Дефолты для новых записей */
export const OZON_DEFAULTS = {
  acquiringPct: 1.5,
  deliveryPvzPct: 4,
  deliveryPvzCap: 25,
  buyoutPct: 90,
  drrPct: 5,
  returnProcessing: 25,
  commissionPct: 16,
  extraCommissionPct: 0,
  taxRatePct: 6,
} as const;
