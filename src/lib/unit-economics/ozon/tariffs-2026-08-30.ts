// PURPOSE: Тарифный пакет Ozon, версия 2026-08-30 (снимок тарифов на дату
// последнего известного изменения). Версия фиксируется, чтобы старые
// сохранённые расчёты не ломались при будущем обновлении тарифов.
//
// Отличия от пакета 2026-04-07 (см. tariffs-2026-04-07.ts — он заморожен):
//  1. Скорость отгрузки FBS — ДВЕ сетки скидок/штрафов к комиссии (с 23.07.2026),
//     раньше была одна «надбавка +2%» с инвертированным знаком.
//  2. Приёмка FBS зависит от точки сдачи (с 30.07.2026): СЦ 0 / курьер 4.13 /
//     ПВЗ-ППЗ 10 / УТК 17 / Горбушка 2 ₽ за ЗАКАЗ (раньше плоские 10 ₽).
//  3. Приёмка FBO «обработка в составе грузоместа» — новая статья,
//     min(5 + max(0, ceil(верхняя_граница_литража) − 1), 60) ₽ за ЕДИНИЦУ.
//  4. HIGH_VOLUME_FBO_DISCOUNT (−15% к логистике) УДАЛЁН как несуществующий.
//     Вместо него — скидка за локальность 3 п.п. к КОМИССИИ (с 30.08.2026)
//     с исключениями (Москва/МО+ДВ, СПб+СЗО, Беларусь).
//  5. Скидка к комиссии за отсрочку выплат — 0.45 п.п. за каждые 14 дней.
//  6. Авто-комиссия по ценовым порогам обновлена (с 28.08.2026):
//     ≤100 ₽ → 20%, 101–300 ₽ → 26%, >300 ₽ → категорийная (ручная).

export const OZON_TARIFF_VERSION = 'ozon_2026_08_30';

/**
 * Авто-комиссия Ozon по диапазонам цены покупателя (сетка с 28.08.2026):
 * - <= 100₽: 20%
 * - 101..300₽: 26%
 * - > 300₽: используется ручная категорийная ставка из inputs.commissionPct
 *
 * Старая сетка (до 28.08.2026) была 14% / 20% — она осталась в пакете
 * 2026-04-07 и применяется к расчётам, сохранённым с той версией тарифов.
 */
export const AUTO_COMMISSION_GRID: Array<[maxPrice: number, pct: number]> = [
  [100, 20],
  [300, 26],
];

export function autoCommissionPct(buyerPrice: number, manualPct: number): number {
  for (const [maxPrice, pct] of AUTO_COMMISSION_GRID) {
    if (buyerPrice <= maxPrice) return pct;
  }
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

function lookupVolumeBracket(volumeL: number): [number, number, number] {
  const v = Math.max(0, Number(volumeL) || 0);
  for (const bracket of VOLUME_BRACKETS) {
    if (v <= bracket[0]) return bracket;
  }
  return VOLUME_BRACKETS[VOLUME_BRACKETS.length - 1];
}

function lookupVolumeCost(volumeL: number, idx: 1 | 2): number {
  return lookupVolumeBracket(volumeL)[idx];
}

/** Стоимость FBO логистики на ЗАКАЗ по объёму (без учёта выкупа). */
export function fboLogisticsCost(volumeL: number): number {
  return lookupVolumeCost(volumeL, 1);
}

/** Стоимость FBS логистики на ЗАКАЗ по объёму (без учёта выкупа). */
export function fbsLogisticsCost(volumeL: number): number {
  return lookupVolumeCost(volumeL, 2);
}

/** Верхняя граница объёмного диапазона, в который попал товар (литры). */
export function volumeBracketUpperL(volumeL: number): number {
  return lookupVolumeBracket(volumeL)[0];
}

/** Коэффициент нелокального кластера (логистика дороже на ~25%). */
export const NON_LOCAL_CLUSTER_MULTIPLIER = 1.25;

/** Возврат: процент от прямой логистики (приёмка возврата + обработка). */
export const RETURN_LOGISTICS_PCT_OF_FORWARD = 0.5;

// ============================================================================
// Скорость отгрузки FBS → скидка/штраф к комиссии (сетка с 23.07.2026)
// ============================================================================

/**
 * Значения — ПРОЦЕНТНЫЕ ПУНКТЫ, которые ПРИБАВЛЯЮТСЯ к комиссии.
 * Отрицательные = скидка за быструю отгрузку, положительные = штраф.
 *
 * ВАЖНО: в пакете 2026-04-07 знак был инвертирован (быстрая отгрузка ДОБАВЛЯЛА
 * +2% к комиссии вместо скидки −2%).
 */
export const FBS_SPEED_PP_SORTING_CENTER: Record<string, number> = {
  // Сетка «СЦ / курьер»
  le12h: -3,
  h12_24: -2,
  h24_36: 0,
  h36_48: 1,
  gt48h: 2,
  // Legacy-ключи (пакет 2026-04-07): fast = 12–24 ч, standard = 24–48 ч, slow = 48–72 ч
  fast: -2,
  standard: 0,
  slow: 2,
};

export const FBS_SPEED_PP_PICKUP_POINT: Record<string, number> = {
  // Сетка «ПВЗ / ППЗ»
  in_slot: -2,
  h0_24: 0,
  h24_48: 1,
  gt48h: 2,
  // Legacy-ключи
  fast: -2,
  standard: 0,
  slow: 2,
};

/** Точки сдачи, которые тарифицируются по сетке «ПВЗ / ППЗ». */
const PICKUP_GROUP_DROPOFFS = new Set(['pickup_point', 'utk', 'gorbushka']);

/**
 * Скидка/штраф к комиссии за скорость отгрузки FBS, п.п. (минус = скидка).
 * Неизвестная для выбранной сетки скорость трактуется нейтрально (0 п.п.).
 */
export function fbsShipmentSpeedCommissionPp(dropoffPoint: string, speed: string): number {
  const grid = PICKUP_GROUP_DROPOFFS.has(dropoffPoint)
    ? FBS_SPEED_PP_PICKUP_POINT
    : FBS_SPEED_PP_SORTING_CENTER;
  const value = grid[speed];
  return Number.isFinite(value) ? value : 0;
}

// ============================================================================
// Приёмка
// ============================================================================

/**
 * Приёмка FBS по точке сдачи, ₽ за ЗАКАЗ (с 30.07.2026).
 * Начисляется на заказ → на выкупленную единицу делится на % выкупа.
 */
export const FBS_DROPOFF_ACCEPTANCE_RUB: Record<string, number> = {
  sorting_center: 0,
  courier: 4.13,
  pickup_point: 10,
  utk: 17, // УТК: Садовод / Люблино / Фуд Сити
  gorbushka: 2,
};

export function fbsDropoffAcceptanceFee(dropoffPoint: string): number {
  const value = FBS_DROPOFF_ACCEPTANCE_RUB[dropoffPoint];
  return Number.isFinite(value) ? value : 0;
}

/**
 * Приёмка FBO — «обработка в составе грузоместа», ₽ за ЕДИНИЦУ товара.
 * Формула: min(5 + max(0, ceil(верхняя_граница_литража) − 1), 60).
 * Разовая на единицу поставки → НЕ делится на процент выкупа.
 */
export const FBO_ACCEPTANCE_BASE_RUB = 5;
export const FBO_ACCEPTANCE_CAP_RUB = 60;

export function fboAcceptanceFee(volumeL: number): number {
  const upper = volumeBracketUpperL(volumeL);
  if (!Number.isFinite(upper)) return FBO_ACCEPTANCE_CAP_RUB;
  const litres = Math.ceil(upper);
  const raw = FBO_ACCEPTANCE_BASE_RUB + Math.max(0, litres - 1);
  return Math.min(raw, FBO_ACCEPTANCE_CAP_RUB);
}

// ============================================================================
// Скидки к комиссии: локальность и отсрочка выплат
// ============================================================================

/** Скидка за локальность товара, п.п. к комиссии (с 30.08.2026). */
export const LOCALITY_COMMISSION_DISCOUNT_PP = 3;

/**
 * Кластеры, на которые скидка за локальность НЕ распространяется.
 * `moscow_region` в нашем справочнике — «Москва, МО и Дальние регионы».
 */
export const LOCALITY_DISCOUNT_EXCLUDED_CLUSTERS = new Set<string>([
  'moscow_region',
  'spb_szo',
  'belarus',
]);

export function isLocalityDiscountExcluded(clusterKey: string | undefined): boolean {
  if (!clusterKey) return false;
  return LOCALITY_DISCOUNT_EXCLUDED_CLUSTERS.has(clusterKey);
}

/** Скидка к комиссии за отсрочку выплат: 0.45 п.п. за каждые полные 14 дней. */
export const PAYMENT_DEFERRAL_PP_PER_14D = 0.45;
export const PAYMENT_DEFERRAL_MAX_DAYS = 168;

/** Допустимые значения отсрочки (дни) — для дроп-дауна UI. */
export const PAYMENT_DEFERRAL_OPTIONS = [0, 14, 28, 42, 56, 84, 112, 168] as const;

/**
 * 14 → 0.45, 28 → 0.9, 42 → 1.35, 56 → 1.8, 84 → 2.7, 112 → 3.6, 168 → 5.4 п.п.
 * Промежуточные значения округляются вниз до полных 14 дней.
 */
export function paymentDeferralDiscountPp(days: number): number {
  const d = Math.max(0, Math.min(Number(days) || 0, PAYMENT_DEFERRAL_MAX_DAYS));
  const periods = Math.floor(d / 14);
  return Math.round(periods * PAYMENT_DEFERRAL_PP_PER_14D * 100) / 100;
}

// ============================================================================
// Кластеры
// ============================================================================

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
  region:
    | 'rf-center'
    | 'rf-south'
    | 'rf-volga'
    | 'rf-ural'
    | 'rf-siberia'
    | 'rf-far-east'
    | 'rf-northwest'
    | 'cis';
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

/** Подписи точек сдачи FBS (5 опций, с 30.07.2026 приёмка зависит от точки). */
export const FBS_DROPOFF_LABELS: Record<string, string> = {
  sorting_center: 'СЦ (0 ₽)',
  courier: 'Курьер (4,13 ₽)',
  pickup_point: 'ПВЗ/ППЗ (10 ₽)',
  utk: 'УТК Садовод/Люблино/Фуд Сити (17 ₽)',
  gorbushka: 'Горбушка (2 ₽)',
};

/** Подписи скоростей отгрузки для сетки «СЦ / курьер». */
export const FBS_SHIPMENT_SPEED_LABELS_SORTING_CENTER: Record<string, string> = {
  le12h: 'до 12 ч (−3% ком.)',
  h12_24: '12–24 ч (−2% ком.)',
  h24_36: '24–36 ч (без изменений)',
  h36_48: '36–48 ч (+1% ком.)',
  gt48h: 'более 48 ч (+2% ком.)',
};

/** Подписи скоростей отгрузки для сетки «ПВЗ / ППЗ». */
export const FBS_SHIPMENT_SPEED_LABELS_PICKUP_POINT: Record<string, string> = {
  in_slot: 'в слот (−2% ком.)',
  h0_24: '24 ч после слота (без изменений)',
  h24_48: '24–48 ч (+1% ком.)',
  gt48h: 'более 48 ч (+2% ком.)',
};

/** Совмещённый словарь подписей (включая legacy-ключи) — для тултипов. */
export const FBS_SHIPMENT_SPEED_LABELS: Record<string, string> = {
  ...FBS_SHIPMENT_SPEED_LABELS_SORTING_CENTER,
  ...FBS_SHIPMENT_SPEED_LABELS_PICKUP_POINT,
  fast: 'быстрая отгрузка (−2% ком.)',
  standard: 'стандартная (без изменений)',
  slow: 'медленная (+2% ком.)',
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
  localityDiscount: false,
  paymentDeferralDays: 0,
} as const;
