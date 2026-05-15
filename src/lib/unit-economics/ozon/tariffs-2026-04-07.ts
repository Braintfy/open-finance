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

/**
 * LUT (lookup table) объёмных диапазонов Ozon. Каждая запись —
 * `[upperVolumeL_inclusive, fboCostRub, fbsCostRub]`. Совпадает с дроп-даун
 * списком на референсе (синий-рассвет.рф/ozon.html) — 43 диапазона.
 * Цены — аппроксимация существующей step-функции, разнесённая на финер бины.
 */
const VOLUME_BRACKETS: Array<[upper: number, fbo: number, fbs: number]> = [
  [0.2, 30, 40],
  [0.4, 35, 45],
  [0.6, 42, 52],
  [0.8, 47, 58],
  [1.0, 50, 65],
  [1.25, 60, 75],
  [1.5, 66, 81],
  [1.75, 72, 86],
  [2.0, 78, 92],
  [3.0, 88, 104],
  [4.0, 94, 112],
  [5.0, 100, 122],
  [6.0, 140, 172],
  [7.0, 150, 184],
  [8.0, 160, 196],
  [9.0, 170, 208],
  [10.0, 180, 220],
  [11.0, 190, 232],
  [12.0, 200, 244],
  [13.0, 210, 256],
  [14.0, 220, 268],
  [15.0, 230, 280],
  [17.0, 250, 304],
  [20.0, 280, 340],
  [25.0, 330, 400],
  [30.0, 380, 460],
  [35.0, 420, 510],
  [40.0, 470, 570],
  [45.0, 510, 620],
  [50.0, 560, 680],
  [60.0, 600, 720],
  [70.0, 640, 770],
  [80.0, 680, 820],
  [90.0, 720, 870],
  [100.0, 760, 920],
  [125.0, 820, 990],
  [150.0, 880, 1060],
  [175.0, 940, 1130],
  [200.0, 1000, 1200],
  [400.0, 1400, 1700],
  [600.0, 1800, 2200],
  [800.0, 2200, 2700],
  [Number.POSITIVE_INFINITY, 2600, 3200],
];

function lookupVolumeCost(volumeL: number, idx: 1 | 2): number {
  const v = Math.max(0, Number(volumeL) || 0);
  for (const bracket of VOLUME_BRACKETS) {
    if (v <= bracket[0]) return bracket[idx];
  }
  const last = VOLUME_BRACKETS[VOLUME_BRACKETS.length - 1];
  return last[idx];
}

/** Стоимость FBO логистики на единицу по объёму. */
export function fboLogisticsCost(volumeL: number): number {
  return lookupVolumeCost(volumeL, 1);
}

/** Стоимость FBS логистики на единицу по объёму. */
export function fbsLogisticsCost(volumeL: number): number {
  return lookupVolumeCost(volumeL, 2);
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
 * Фиксированная надбавка к логистике, если у продавца НЕ подключена
 * «Бесплатная приёмка» (Ozon берёт фикс за приёмку партии).
 */
export const PAID_ACCEPTANCE_FEE_PER_UNIT_RUB = 10;

/**
 * Полный список кластеров FBS (28 шт) — соответствует дроп-дауну референса.
 * Используется в multi-cluster выборе с долями (sum = 100%).
 *
 * `local: true` означает «свой» кластер для логистики (multiplier = 1).
 * `local: false` — нелокальный (multiplier = NON_LOCAL_CLUSTER_MULTIPLIER).
 * Группа `region` нужна для пресетов «Топ-5», «Топ-10», «География», «Все РФ».
 */
export type OzonClusterMeta = {
  key: string;
  label: string;
  local: boolean;
  region: 'rf-center' | 'rf-south' | 'rf-volga' | 'rf-ural' | 'rf-siberia' | 'rf-far-east' | 'rf-northwest' | 'cis';
};

export const FBS_CLUSTERS: OzonClusterMeta[] = [
  { key: 'almaty', label: 'Алматы', local: false, region: 'cis' },
  { key: 'armenia', label: 'Армения', local: false, region: 'cis' },
  { key: 'astana', label: 'Астана', local: false, region: 'cis' },
  { key: 'belarus', label: 'Беларусь', local: false, region: 'cis' },
  { key: 'voronezh', label: 'Воронеж', local: true, region: 'rf-center' },
  { key: 'far_east', label: 'Дальний Восток', local: false, region: 'rf-far-east' },
  { key: 'ekaterinburg', label: 'Екатеринбург', local: true, region: 'rf-ural' },
  { key: 'kazan', label: 'Казань', local: true, region: 'rf-volga' },
  { key: 'kaliningrad', label: 'Калининград', local: false, region: 'rf-northwest' },
  { key: 'krasnodar', label: 'Краснодар', local: true, region: 'rf-south' },
  { key: 'krasnoyarsk', label: 'Красноярск', local: false, region: 'rf-siberia' },
  { key: 'kyrgyzstan', label: 'Кыргызстан', local: false, region: 'cis' },
  { key: 'makhachkala', label: 'Махачкала', local: true, region: 'rf-south' },
  { key: 'moscow_region', label: 'Москва, МО и Дальние регионы', local: true, region: 'rf-center' },
  { key: 'nevinnomyssk', label: 'Невинномысск', local: true, region: 'rf-south' },
  { key: 'novosibirsk', label: 'Новосибирск', local: false, region: 'rf-siberia' },
  { key: 'omsk', label: 'Омск', local: false, region: 'rf-siberia' },
  { key: 'orenburg', label: 'Оренбург', local: true, region: 'rf-volga' },
  { key: 'perm', label: 'Пермь', local: true, region: 'rf-ural' },
  { key: 'rostov', label: 'Ростов', local: true, region: 'rf-south' },
  { key: 'samara', label: 'Самара', local: true, region: 'rf-volga' },
  { key: 'spb_szo', label: 'Санкт-Петербург и СЗО', local: true, region: 'rf-northwest' },
  { key: 'saratov', label: 'Саратов', local: true, region: 'rf-volga' },
  { key: 'tver', label: 'Тверь', local: true, region: 'rf-center' },
  { key: 'tyumen', label: 'Тюмень', local: false, region: 'rf-siberia' },
  { key: 'uzbekistan', label: 'Узбекистан', local: false, region: 'cis' },
  { key: 'ufa', label: 'Уфа', local: true, region: 'rf-volga' },
  { key: 'yaroslavl', label: 'Ярославль', local: true, region: 'rf-center' },
];

/** Quick-lookup по ключу — для расчёта clusterMultiplier и UI. */
export const FBS_CLUSTER_BY_KEY: Record<string, OzonClusterMeta> = Object.fromEntries(
  FBS_CLUSTERS.map((c) => [c.key, c]),
);

/**
 * @deprecated Используется только для миграции старых конфигов.
 * Новые расчёты должны использовать `FBS_CLUSTERS` + multi-cluster выбор.
 */
export const FBS_WAREHOUSE_LABELS: Record<string, string> = Object.fromEntries(
  FBS_CLUSTERS.map((c) => [c.key, c.label]),
);

/**
 * @deprecated Используется только для миграции старых конфигов.
 */
export const FBS_WAREHOUSE_LOCAL_BY_DEFAULT: Record<string, boolean> = Object.fromEntries(
  FBS_CLUSTERS.map((c) => [c.key, c.local]),
);

/**
 * Пресеты для quick-кнопок в `ClusterSelector`. Каждый пресет — список ключей
 * кластеров; доля распределяется поровну (или с весом по «крупности»).
 */
export const OZON_CLUSTER_PRESETS = {
  /** Все кластеры РФ (без СНГ). */
  allRf: FBS_CLUSTERS.filter((c) => c.region !== 'cis').map((c) => c.key),
  /** Топ-5 — крупнейшие склады по обороту. */
  topRf5: ['moscow_region', 'spb_szo', 'ekaterinburg', 'krasnodar', 'novosibirsk'],
  /** Топ-10 — расширенный набор. */
  topRf10: [
    'moscow_region',
    'spb_szo',
    'ekaterinburg',
    'krasnodar',
    'novosibirsk',
    'rostov',
    'kazan',
    'samara',
    'voronezh',
    'ufa',
  ],
  /**
   * «География» — по одному представителю на регион РФ для равномерного
   * покрытия (минимизирует нелокальные надбавки за счёт географии).
   */
  geography: [
    'moscow_region',
    'spb_szo',
    'voronezh',
    'krasnodar',
    'kazan',
    'ekaterinburg',
    'novosibirsk',
    'far_east',
  ],
} as const;

/** Подписи точек сдачи FBS (соответствует референсу: 2 опции). */
export const FBS_DROPOFF_LABELS: Record<string, string> = {
  sorting_center: 'СЦ',
  pickup_point: 'ПВЗ/ППЗ',
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
  returnsPct: 5,
  cancelPct: 5,
  coInvestPct: 0,
  freeAcceptance: true,
  supplyLeadWeeks: 4,
  documentedExpensesMonth: 0,
  indirectExpensesMonth: 0,
} as const;
