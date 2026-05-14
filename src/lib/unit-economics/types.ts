// PURPOSE: Общие типы юнит-экономики — нормализованные inputs/results
// для калькуляторов Ozon и Яндекс Маркет. Без зависимостей от React/DB.

export type Marketplace = 'ozon' | 'yandex';

export type OzonMode = 'fbo' | 'fbs';
export type YandexMode = 'fby' | 'fbs' | 'dbs' | 'express';

export type TaxMode =
  | 'usn_income' // УСН Доходы (6%)
  | 'usn_income_minus' // УСН Доходы минус расходы (15%)
  | 'osno' // ОСНО (НДС 20% + налог на прибыль)
  | 'nds' // Только НДС (5/7/20%)
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
  // Выкуп / возвраты
  /** Процент выкупа (1..100). 90 значит 90% покупателей выкупают. */
  buyoutPct: number;
  /** Стоимость обработки возврата, ₽ */
  returnProcessing: number;
  // Реклама
  /** ДРР — доля рекламных расходов от цены продажи, % */
  drrPct: number;
  // Налог
  taxMode: TaxMode;
  /** Ставка УСН/НДС, % (для usn_income=6, usn_income_minus=15, nds=20 и т.д.) */
  taxRatePct: number;
  /** Можно ли вычесть себестоимость и расходы (для УСН Д-Р) */
  taxDeductExpenses: boolean;
  // Оборачиваемость и партия
  /** Продаж в месяц */
  salesPerMonth: number;
  /** Плечо оборота (количество единиц в партии) */
  batchSize: number;
  /** Количество единиц в остатке */
  stock: number;
  /** Дополнительные фиксированные расходы на единицу, ₽ */
  overheadPerUnit: number;
};

export type OzonResults = {
  /** Цена покупателя (после скидки), ₽ */
  buyerPrice: number;
  /** Комиссия маркетплейса, ₽ */
  commission: number;
  /** Эквайринг, ₽ */
  acquiring: number;
  /** Логистика (FBO/FBS), ₽ */
  logistics: number;
  /** Доставка до ПВЗ, ₽ (только FBO) */
  deliveryPvz: number;
  /** Стоимость возвратов, ₽ */
  returns: number;
  /** Реклама на одну продажу (с учётом выкупа), ₽ */
  ads: number;
  /** Налог, ₽ */
  tax: number;
  /** Себестоимость единицы, ₽ */
  cogs: number;
  /** Прочие расходы на единицу, ₽ */
  overhead: number;
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
