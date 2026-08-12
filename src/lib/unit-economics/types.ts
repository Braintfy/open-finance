// PURPOSE: Общие типы юнит-экономики — нормализованные inputs/results
// для калькуляторов Ozon и Яндекс Маркет. Без зависимостей от React/DB.

export type Marketplace = 'ozon' | 'yandex';

export type OzonMode = 'fbo' | 'fbs';

/**
 * Точка сдачи отгрузки FBS в Ozon. С 30.07.2026 от неё зависит стоимость
 * приёмки заказа (см. `FBS_DROPOFF_ACCEPTANCE_RUB` в тарифном пакете):
 * - sorting_center — Сортировочный центр Ozon (0 ₽).
 * - courier — Курьер Ozon (4.13 ₽).
 * - pickup_point — ПВЗ / ППЗ (10 ₽).
 * - utk — УТК: Садовод / Люблино / Фуд Сити (17 ₽).
 * - gorbushka — Горбушка (2 ₽).
 */
export type OzonFbsDropoffPoint =
  | 'sorting_center'
  | 'courier'
  | 'pickup_point'
  | 'utk'
  | 'gorbushka';

/**
 * Скорость отгрузки FBS. С 23.07.2026 действуют ДВЕ сетки скидок/штрафов
 * к комиссии — своя для «СЦ/курьер» и своя для «ПВЗ/ППЗ»
 * (см. `fbsShipmentSpeedCommissionPp`).
 *
 * Сетка СЦ/курьер: le12h −3 п.п., h12_24 −2, h24_36 0, h36_48 +1, gt48h +2.
 * Сетка ПВЗ/ППЗ: in_slot −2 п.п., h0_24 0, h24_48 +1, gt48h +2.
 *
 * `fast` / `standard` / `slow` — legacy-ключи пакета 2026-04-07,
 * трактуются как −2 / 0 / +2 п.п. соответственно.
 */
export type OzonFbsShipmentSpeed =
  | 'le12h'
  | 'h12_24'
  | 'h24_36'
  | 'h36_48'
  | 'in_slot'
  | 'h0_24'
  | 'h24_48'
  | 'gt48h'
  | 'fast'
  | 'standard'
  | 'slow';

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
  /**
   * @deprecated Не влияет на расчёт с тарифов `ozon_2026_08_30`.
   * Раньше трактовалась как «−15% к логистике за >50 заказов FBO в неделю» —
   * такой скидки у Ozon нет. Реальная скидка за локальность — 3 п.п.
   * к КОМИССИИ, включается флагом `localityDiscount`.
   */
  highVolumeDiscount: boolean;
  /**
   * Скидка за локальность товара — 3 п.п. к комиссии (с 30.08.2026).
   * Не действует для кластеров «Москва, МО и ДВ», «СПб и СЗО», «Беларусь»
   * (`LOCALITY_DISCOUNT_EXCLUDED_CLUSTERS`). При multi-cluster FBS скидка
   * применяется пропорционально доле неисключённых кластеров.
   */
  localityDiscount?: boolean;
  /**
   * Отсрочка выплат, дни (0/14/28/42/56/84/112/168). Даёт скидку к комиссии
   * 0.45 п.п. за каждые полные 14 дней (максимум 5.4 п.п. при 168 днях).
   */
  paymentDeferralDays?: number;
  // FBS-специфика (используются только при mode='fbs')
  /** Точка сдачи отгрузки FBS — от неё зависит приёмка и сетка скоростей. */
  fbsDropoffPoint?: OzonFbsDropoffPoint;
  /**
   * Скорость отгрузки FBS: скидка (быстро) или надбавка (медленно) к комиссии
   * в п.п. — см. `fbsShipmentSpeedCommissionPp` в тарифном пакете.
   */
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
  /**
   * Соинвест / СПП — скидка покупателю ЗА СЧЁТ Ozon, %. НЕ уменьшает расходы
   * продавца и не увеличивает его прибыль: влияет только на «цену с СПП»
   * (`priceWithSpp`) и на налоговую базу (НДС/УСН считаются от суммы,
   * которую фактически платит покупатель). Default 0.
   */
  coInvestPct: number;
  /**
   * Бесплатная приёмка поставки FBO. Если false — начисляется «обработка
   * в составе грузоместа» (`fboAcceptanceFee`, ₽ за единицу). На платную
   * приёмку FBS (по точке сдачи) флаг НЕ влияет — она берётся всегда.
   * Default true.
   */
  freeAcceptance: boolean;
  // Налог
  taxMode: TaxMode;
  /** Ставка УСН/налога на прибыль, % (для usn_income=6, usn_income_minus=15 и т.д.) */
  taxRatePct: number;
  /**
   * ДОПОЛНИТЕЛЬНЫЕ документально подтверждённые расходы, ₽/мес (то, чего нет
   * в статьях расчёта: бухгалтерия, банк, услуги и т.п.). Для УСН Д-Р
   * прибавляются к расходам расчёта: на единицу =
   * `documentedExpensesMonth / max(1, salesPerMonth)`.
   * Базой налога Д-Р служат РЕАЛЬНЫЕ расходы расчёта, поэтому 0 здесь
   * больше не означает «налог с выручки».
   */
  documentedExpensesMonth: number;
  /**
   * Глобальная ставка НДС, %. НДС ИЗВЛЕКАЕТСЯ из цены покупателя
   * (`vat = priceWithSpp * vatPct / (100 + vatPct)`), а не начисляется сверху.
   * Отдельная строка расхода, НЕ зависит от taxMode. Если 0 — НДС не учитывается.
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
  /**
   * Цена продавца после его собственной скидки, ₽. Это ВЫРУЧКА продавца
   * и база для комиссии/эквайринга/ДРР. СПП (соинвест Ozon) её не уменьшает.
   */
  buyerPrice: number;
  /**
   * Цена, которую фактически платит покупатель: `buyerPrice × (1 − coInvestPct)`.
   * Служит базой НДС и налоговой базой. Если соинвеста нет — равна `buyerPrice`.
   */
  priceWithSpp: number;
  /** Комиссия маркетплейса, ₽ */
  commission: number;
  /** Эквайринг, ₽ */
  acquiring: number;
  /**
   * Логистика (FBO/FBS) на одну ВЫКУПЛЕННУЮ единицу: прямая логистика заказа,
   * делённая на % выкупа, плюс приёмка (FBS — по точке сдачи, на заказ →
   * тоже делится на выкуп; FBO — обработка в грузоместе, на единицу).
   * Прямая логистика — weighted-sum по кластерам (если задан multi-cluster),
   * иначе single-cluster.
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
   * Сумма СПП — скидка покупателю за счёт Ozon, ₽ (`buyerPrice − priceWithSpp`).
   * СПРАВОЧНАЯ величина: НЕ уменьшает расходы продавца и НЕ входит в прибыль.
   * До тарифов `ozon_2026_08_30` ошибочно вычиталась из расходов.
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
  /**
   * Цена продавца в ЛК, ₽. Это ВЫРУЧКА продавца и база всех расходов
   * маркетплейса (комиссия, мили, платежи, ДРР).
   */
  sellerPrice: number;
  /**
   * Соинвест Маркета в цену, %. Скидка ЗА СЧЁТ Маркета: уменьшает цену
   * покупателя (`customerPrice`) и налоговую базу, но НЕ является расходом
   * продавца и не уменьшает его выручку.
   */
  coinvestPct: number;
  /** Габариты в см */
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  // `weightKg` и `category` удалены (тарифы yandex_2026_07_01): расчёт
  // ведётся от объёма (дм³), справочника категорий нет. В сохранённых
  // конфигах ключи могут остаться — они просто игнорируются.
  /** Себестоимость, ₽ */
  cost: number;
  /** Ручная комиссия («размещение»), %. Реальный диапазон ЯМ — 28–55%. */
  commissionPct: number;
  /**
   * «Перевод платежей», % (в UI подписано «Эквайринг»). Реальный диапазон
   * ЯМ — 1.6–3.3% в зависимости от частоты выплат. Дополнительно всегда
   * начисляется «приём платежей» 0.12 ₽ за SKU.
   */
  acquiringPct: number;
  /**
   * Спецтариф — ЗАМЕНЯЕТ ставку комиссии (не суммируется с ней).
   * `showcase` («Витрина 5%») отменён с 01.07.2026 и трактуется как `none`.
   */
  specialTariff:
    | 'none'
    | 'showcase'
    | 'subscription_fby'
    | 'subscription_fbs'
    | 'subscription_express';
  /** Скидка экспресс-доставки FBS к средней миле, процентные пункты */
  fbsFastShipDiscountPct: number;
  /** Процент выкупа, % — влияет на возвраты, хранение невыкупа и ДРР */
  buyoutPct: number;
  /** Хранение/мес. на единицу, ₽ */
  storagePerUnit: number;
  /**
   * Дней хранения невыкупа до вывоза/утилизации. Первые
   * `RETURN_STORAGE_FREE_DAYS` (5) — бесплатно, далее 15 ₽/день. Default 0.
   */
  returnStorageDays?: number;
  /** ДРР, % */
  drrPct: number;
  /** Прочие расходы на единицу, ₽ */
  overheadPerUnit: number;
  taxMode: TaxMode;
  taxRatePct: number;
  /**
   * @deprecated Игнорируется. Режим `usn_income_minus` ВСЕГДА вычитает
   * расходы расчёта (иначе он неотличим от `usn_income`).
   */
  taxDeductExpenses: boolean;
  /**
   * Глобальная ставка НДС, %. НДС ИЗВЛЕКАЕТСЯ из цены покупателя
   * (`vat = customerPrice * vatPct / (100 + vatPct)`), а не начисляется сверху.
   */
  vatPct: number;
  /** Продаж в месяц */
  salesPerMonth: number;
  // `batchSize` удалён — в расчёте ЯМ не используется (в отличие от Ozon,
  // где есть `profitPerBatch`).
  /** Остаток */
  stock: number;
};

export type YandexResults = {
  /** Выручка продавца = цена продавца в ЛК, ₽ */
  revenue: number;
  /** Цена покупателя после соинвеста Маркета — база НДС и налога, ₽ */
  customerPrice: number;
  volume: number;
  /** Комиссия («размещение») либо фиксированный тариф целиком, ₽ */
  commission: number;
  /** Перевод платежей (%) + приём платежей (0.12 ₽), ₽ */
  acquiring: number;
  lastMile: number;
  middleMile: number;
  /** Обработка заказа: 25 ₽ на FBS, 0 на FBY/DBS/Express */
  orderProcessing: number;
  /**
   * @deprecated Алиас `orderProcessing` — статьи «фулфилмент» в тарифах ЯМ нет.
   * Оставлено, чтобы не ломать P&L существующего UI-блока.
   */
  fulfillment: number;
  /** Хранение на складе + хранение невыкупа, ₽ */
  storage: number;
  /** Возвраты (невыкупы): обратная средняя миля + обработка, ₽ */
  returns: number;
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
