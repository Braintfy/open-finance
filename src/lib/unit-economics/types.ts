// PURPOSE: Общие типы юнит-экономики — нормализованные inputs/results
// для калькуляторов Ozon и Яндекс Маркет. Без зависимостей от React/DB.

export type Marketplace = 'ozon' | 'yandex';

export type OzonMode = 'fbo' | 'fbs';

/**
 * Точка сдачи отгрузки FBS в Ozon (соответствует референсу — 2 опции).
 * - sorting_center — Сортировочный центр Ozon.
 * - pickup_point — ПВЗ / ППЗ.
 */
export type OzonFbsDropoffPoint = 'sorting_center' | 'pickup_point';

/**
 * Скорость отгрузки FBS:
 * - fast (12–24 ч) — даёт +FBS_FAST_SHIPMENT_COMMISSION_BUMP_PCT к комиссии (бонус-скидка
 *   маркетплейса в обмен на быструю отгрузку).
 * - standard (24–48 ч) — без надбавки.
 * - slow (48–72 ч) — без надбавки (можно использовать в будущем для штрафов).
 */
export type OzonFbsShipmentSpeed = 'fast' | 'standard' | 'slow';

/**
 * Один кластер FBS с долей в общей структуре отгрузок (sum = 100).
 * `key` — слаг кластера из `FBS_CLUSTERS` (см. tariffs).
 */
export type OzonFbsClusterShare = {
  key: string;
  /** Доля заказов через этот кластер, % (0..100). */
  sharePct: number;
};

/**
 * @deprecated Старый single-warehouse тип. Сохранён для миграции.
 * Новые расчёты используют `OzonInputs.fbsClusters: OzonFbsClusterShare[]`.
 */
export type OzonFbsWarehouse = string;

export type YandexMode = 'fby' | 'fbs' | 'dbs' | 'express';

/**
 * Налоговый режим (соответствует референсу — 4 опции).
 * Старый режим `'nds'` (Только НДС) удалён — мигрируется в `osno`.
 */
export type TaxMode =
  | 'usn_income' // УСН Доходы (6%)
  | 'usn_income_minus' // УСН Доходы минус расходы (15%)
  | 'osno' // ОСНО (НДС 20% + налог на прибыль)
  | 'none'; // Без налога

/**
 * Связь ячейки калькулятора с другим блоком/ячейкой.
 * mode='manual' — пользователь ввёл число вручную.
 * mode='block_ref' — значение берётся из блока-источника, fallbackValue
 * используется если источник недоступен.
 */
export type UnitCellBinding = {
  mode: 'manual' | 'block_ref';
  ref?: {
    /** Опционально для cross-page ссылок. По умолчанию текущая страница. */
    pageKey?: string;
    blockId: string;
    /** По умолчанию 'value' */
    field?: string;
    /** Кэш человекочитаемой подписи источника */
    label?: string;
  };
  /** Значение, которое использовать если ref unresolved или mode='manual'. */
  fallbackValue?: number | null;
  /** Является ли значение денежной величиной (для конверсии копейки↔рубли) */
  money?: boolean;
};

// ============================================================================
// Ozon
// ============================================================================

/**
 * Все денежные поля Ozon хранятся в РУБЛЯХ как float (как в Синем Рассвете),
 * чтобы избежать ошибок округления при копировании формул. Конверсия в копейки
 * выполняется только при сохранении в БД и при публикации в BlockValues.
 */
export type OzonInputs = {
  mode: OzonMode;
  // Цены и скидки
  /** Цена до скидки, ₽ */
  price: number;
  /** Скидка, % (0..100) */
  discountPct: number;
  /** Себестоимость одной единицы, ₽ */
  cost: number;
  /** Кросс-докинг / упаковка, ₽ */
  crossDockingCost: number;
  // Габариты и логистика
  /** Объём товара, литры */
  volumeL: number;
  /** Кластер хранения / отгрузки */
  cluster?: string;
  /** Локальный кластер? (если false — нелокальный коэффициент) */
  isLocalCluster: boolean;
  /** Скидка >50 заказов FBO за 7 дней (только для FBO) */
  highVolumeDiscount: boolean;
  // FBS-специфика (используются только при mode='fbs')
  /** Точка сдачи отгрузки FBS (СЦ / ПВЗ-ППЗ). */
  fbsDropoffPoint?: OzonFbsDropoffPoint;
  /** Скорость отгрузки FBS. 'fast' даёт +FBS_FAST_SHIPMENT_COMMISSION_BUMP_PCT к комиссии. */
  fbsShipmentSpeed?: OzonFbsShipmentSpeed;
  /**
   * Кластеры FBS с долями (sum = 100). Логистика считается как
   * weighted-sum по локальности каждого кластера (см. calculateOzon).
   * Если массив пуст — fallback к single-cluster через isLocalCluster.
   */
  fbsClusters?: OzonFbsClusterShare[];
  /**
   * @deprecated Используется только при миграции старого конфига. Новые UI
   * пишут в `fbsClusters`. Не использовать в новом коде.
   */
  fbsWarehouse?: OzonFbsWarehouse;
  // Комиссия
  /** Тип ставки: 'auto' — по правилам Ozon (≤100/101–300/иначе ручная), 'manual' — задано вручную */
  commissionMode: 'auto' | 'manual';
  /** Ручная комиссия категории, % (используется при commissionMode='manual') */
  commissionPct: number;
  /** Дополнительная % комиссия (например за категорию/спецуслуги) */
  extraCommissionPct: number;
  /** Эквайринг, % */
  acquiringPct: number;
  // Доставка до ПВЗ (FBO)
  /** Доля от цены, % (по умолчанию 4%) */
  deliveryPvzPct: number;
  /** Лимит доставки до ПВЗ, ₽ (по умолчанию 25₽) */
  deliveryPvzCap: number;
  // Выкуп / возвраты / отмены
  /**
   * @deprecated Хранится для backward compat. Новые расчёты выводят buyoutPct
   * как `100 - returnsPct - cancelPct`. Если в конфиге нет returnsPct/cancelPct —
   * legacy-buyoutPct используется напрямую.
   */
  buyoutPct: number;
  /** Процент возвратов после выкупа (от заказов), %. Default 5. */
  returnsPct: number;
  /** Процент отмен (товар не дошёл до покупателя), %. Default 5. */
  cancelPct: number;
  /** Стоимость обработки возврата, ₽ */
  returnProcessing: number;
  // Реклама
  /** ДРР — доля рекламных расходов от цены продажи, % */
  drrPct: number;
  /** Соинвест баллами Ozon — % покрытия расходов. Default 0. */
  coInvestPct: number;
  /** Бесплатная приёмка партии (Ozon берёт 0 за приёмку). Default true. */
  freeAcceptance: boolean;
  // Налог
  taxMode: TaxMode;
  /** Ставка УСН/налога на прибыль, % (для usn_income=6, usn_income_minus=15 и т.д.) */
  taxRatePct: number;
  /**
   * Документально подтверждённые расходы, ₽/мес. Используется для УСН Д-Р
   * (15%) — на единицу = `documentedExpensesMonth / max(1, salesPerMonth)`.
   * Если 0 — налог считается с buyerPrice без вычетов.
   */
  documentedExpensesMonth: number;
  /**
   * Глобальная ставка НДС, %. Считается отдельной строкой расхода
   * (vat = buyerPrice * vatPct/100) и НЕ зависит от taxMode. Если 0 —
   * НДС не учитывается.
   */
  vatPct: number;
  // Оборачиваемость и партия
  /** Продаж в месяц */
  salesPerMonth: number;
  /** Плечо оборота (количество единиц в партии) */
  batchSize: number;
  /** Количество единиц в остатке */
  stock: number;
  /** Дополнительные фиксированные расходы на единицу, ₽ */
  overheadPerUnit: number;
  /**
   * Косвенные расходы (аренды, зарплаты, подписки), ₽/мес. Распределяются
   * на единицу = `indirectExpensesMonth / max(1, salesPerMonth)`.
   */
  indirectExpensesMonth: number;
  /** Лог. плечо от поставщика, нед. (срок доставки новой партии). */
  supplyLeadWeeks: number;
};

export type OzonResults = {
  /** Цена покупателя (после скидки) — она же «Цена с СПП» в UI, ₽ */
  buyerPrice: number;
  /**
   * Алиас `buyerPrice` для UI-метрики «Цена с СПП». Дублируется специально
   * чтобы поле явно фигурировало в результатах и могло быть привязано
   * через биндинги (с понятной подписью).
   */
  priceWithSpp: number;
  /** Комиссия маркетплейса, ₽ */
  commission: number;
  /** Эквайринг, ₽ */
  acquiring: number;
  /**
   * Логистика (FBO/FBS) на одну ВЫКУПЛЕННУЮ единицу — weighted-sum
   * по кластерам (если задан multi-cluster), иначе single-cluster.
   */
  logistics: number;
  /** Доставка до ПВЗ, ₽ (только FBO) */
  deliveryPvz: number;
  /** Стоимость возвратов и отмен на одну выкупленную единицу, ₽ */
  returns: number;
  /** Реклама на одну продажу (с учётом выкупа), ₽ */
  ads: number;
  /** НДС на одну продажу, ₽ */
  vat: number;
  /** Налог (УСН/налог на прибыль), ₽ */
  tax: number;
  /** Себестоимость единицы, ₽ */
  cogs: number;
  /** Прочие расходы на единицу (включая косвенные распределённые), ₽ */
  overhead: number;
  /**
   * Соинвест баллами Ozon — компенсация части расходов, ₽ (положительная
   * величина, вычитается из суммы расходов перед налогом).
   */
  coInvestSavings: number;
  /** Прибыль с одной единицы, ₽ */
  profitPerUnit: number;
  /** Маржа от цены покупателя, % */
  marginPct: number;
  /** ROI (от себестоимости), % */
  roiPct: number;
  /** Прибыль за месяц, ₽ */
  profitPerMonth: number;
  /** ROI годовой, % */
  annualRoiPct: number;
  /** Оборачиваемость в неделях */
  turnoverWeeks: number;
  /** Деньги в товаре, ₽ */
  moneyInStock: number;
  /** Прибыль с партии, ₽ */
  profitPerBatch: number;
  /** Эффективный buyoutPct, использованный в расчёте (derived из returnsPct + cancelPct), % */
  effectiveBuyoutPct: number;
  /** Использованная версия тарифного пакета */
  tariffVersion: string;
};

// ============================================================================
// Yandex Market
// ============================================================================

export type YandexInputs = {
  mode: YandexMode;
  /** Цена продавца до соинвеста, ₽ */
  sellerPrice: number;
  /** Соинвест в цену, % */
  coinvestPct: number;
  /** Габариты в см */
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  /** Вес физический, кг (для FBS) */
  weightKg: number;
  /** Себестоимость, ₽ */
  cost: number;
  /** Категория (определяет комиссию) — пока используем общую */
  category?: string;
  /** Ручная комиссия, % */
  commissionPct: number;
  /** Эквайринг (приём оплаты), % */
  acquiringPct: number;
  /** Спецтариф */
  specialTariff: 'none' | 'showcase' | 'subscription_fby' | 'subscription_fbs';
  /** Скидка экспресс-доставки FBS, процентные пункты */
  fbsFastShipDiscountPct: number;
  /** Процент выкупа, % (для DBS/Express) */
  buyoutPct: number;
  /** Хранение/мес. на единицу, ₽ */
  storagePerUnit: number;
  /** ДРР, % */
  drrPct: number;
  /** Прочие расходы на единицу, ₽ */
  overheadPerUnit: number;
  taxMode: TaxMode;
  taxRatePct: number;
  taxDeductExpenses: boolean;
  /** Глобальная ставка НДС, %. Аналогично OzonInputs.vatPct. */
  vatPct: number;
  /** Продаж в месяц */
  salesPerMonth: number;
  /** Партия */
  batchSize: number;
  /** Остаток */
  stock: number;
};

export type YandexResults = {
  customerPrice: number;
  volume: number;
  commission: number;
  acquiring: number;
  lastMile: number;
  middleMile: number;
  fulfillment: number;
  storage: number;
  ads: number;
  vat: number;
  tax: number;
  cogs: number;
  overhead: number;
  profitPerUnit: number;
  marginSellerPct: number;
  marginCustomerPct: number;
  roiPct: number;
  profitPerMonth: number;
  moneyInStock: number;
  tariffVersion: string;
};

// ============================================================================
// Helpers
// ============================================================================

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function safeNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
    const parsed = Number.parseFloat(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function rublesToKopecks(rubles: number): number {
  if (!Number.isFinite(rubles)) return 0;
  return Math.round(rubles * 100);
}
