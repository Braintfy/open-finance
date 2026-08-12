// PURPOSE: Чистый расчёт Яндекс Маркет юнит-экономики.
//
// Модель выручки и расходов (тарифы yandex_2026_07_01):
//  - Выручка продавца = `sellerPrice` (цена в ЛК). Она же база комиссии,
//    миль, платежей и ДРР.
//  - Соинвест Маркета — скидка ЗА СЧЁТ Маркета: уменьшает только цену
//    покупателя (`customerPrice`) и налоговую базу, но не выручку продавца
//    и не его расходы.
//  - НДС ИЗВЛЕКАЕТСЯ из цены покупателя, база УСН = цена покупателя − НДС.
//  - Спецтариф ЗАМЕНЯЕТ ставку комиссии; фиксированный тариф (дешёвые
//    компактные товары) заменяет комиссию + мили + обработку.

import type { TaxMode, YandexInputs, YandexResults } from '../types';
import { clamp, round2, safeNumber } from '../types';
import {
  YANDEX_TARIFF_VERSION,
  calcVolume,
  fixedTariffPct,
  lastMileCost,
  middleMileCost,
  orderProcessingCost,
  shouldUseFixedTariff,
  specialTariffPct,
  PAYMENT_ACCEPTANCE_FEE_RUB,
  PAYMENT_TRANSFER_PCT_DEFAULT,
  RETURN_HANDLING_RUB,
  RETURN_STORAGE_FREE_DAYS,
  RETURN_STORAGE_PER_DAY_RUB,
} from './tariffs-2026-07-01';

/** Минимальный налог для УСН «Доходы минус расходы» — 1% от доходов. */
const USN_MIN_TAX_RATE = 0.01;

export const YANDEX_DEFAULT_INPUTS: YandexInputs = {
  mode: 'fby',
  sellerPrice: 0,
  coinvestPct: 0,
  lengthCm: 0,
  widthCm: 0,
  heightCm: 0,
  cost: 0,
  commissionPct: 30,
  acquiringPct: PAYMENT_TRANSFER_PCT_DEFAULT,
  specialTariff: 'none',
  fbsFastShipDiscountPct: 0,
  buyoutPct: 85,
  storagePerUnit: 0,
  returnStorageDays: 0,
  drrPct: 5,
  overheadPerUnit: 0,
  taxMode: 'usn_income',
  taxRatePct: 6,
  taxDeductExpenses: false,
  vatPct: 0,
  salesPerMonth: 0,
  stock: 0,
};

/**
 * Налог на одну продажу. База — цена покупателя без НДС (`netRevenue`).
 * - usn_income: ставка% от дохода без НДС.
 * - usn_income_minus: ставка% от (доход − расходы), но не меньше 1% от дохода.
 * - osno: ставка% от дохода без НДС (сам НДС — отдельной строкой `vat`).
 * - none: 0.
 */
function calcTax(
  netRevenue: number,
  deductibleExpenses: number,
  mode: TaxMode,
  ratePct: number,
): number {
  if (mode === 'none') return 0;
  const rate = clamp(safeNumber(ratePct), 0, 100) / 100;
  if (mode === 'usn_income_minus') {
    const taxable = Math.max(0, netRevenue - deductibleExpenses);
    const minTax = Math.max(0, netRevenue) * USN_MIN_TAX_RATE;
    return Math.max(taxable * rate, minTax);
  }
  return Math.max(0, netRevenue) * rate;
}

export function calculateYandex(rawInputs: Partial<YandexInputs>): YandexResults {
  const inputs: YandexInputs = { ...YANDEX_DEFAULT_INPUTS, ...rawInputs };

  // Выручка продавца = цена в ЛК; соинвест Маркета её не уменьшает.
  const revenue = round2(safeNumber(inputs.sellerPrice));
  const coinvest = clamp(safeNumber(inputs.coinvestPct), 0, 100) / 100;
  const customerPrice = round2(revenue * (1 - coinvest));

  const buyout = clamp(safeNumber(inputs.buyoutPct, 100), 1, 100) / 100;
  const returnRate = 1 - buyout;
  /** Возвратов на одну ВЫКУПЛЕННУЮ единицу: retRate / (1 − retRate). */
  const returnsPerSoldUnit = returnRate / buyout;

  const volume = calcVolume(
    safeNumber(inputs.lengthCm),
    safeNumber(inputs.widthCm),
    safeNumber(inputs.heightCm),
  );

  // ----- Комиссия / мили / обработка -----
  const useFixed = shouldUseFixedTariff(revenue, volume, inputs.mode);
  const fixedPct = useFixed ? fixedTariffPct(inputs.mode) : null;
  // Спецтариф ЗАМЕНЯЕТ ручную ставку комиссии (а не суммируется с ней).
  const specialPct = specialTariffPct(inputs.specialTariff, inputs.mode);
  const effectiveCommissionPct =
    fixedPct ?? specialPct ?? clamp(safeNumber(inputs.commissionPct), 0, 100);
  const commission = round2((revenue * effectiveCommissionPct) / 100);

  let lastMile = 0;
  let middleMile = 0;
  let orderProcessing = 0;
  if (fixedPct === null) {
    lastMile = round2(lastMileCost(revenue));
    middleMile = middleMileCost(volume, inputs.mode);
    if (inputs.mode === 'fbs') {
      const discountPp = clamp(safeNumber(inputs.fbsFastShipDiscountPct), 0, 100);
      middleMile = round2(middleMile * (1 - discountPp / 100));
    }
    orderProcessing = orderProcessingCost(inputs.mode);
  }

  // ----- Платежи -----
  // «Перевод платежей» (%) + «приём платежей» (фикс за SKU).
  const acquiring = round2(
    (revenue * clamp(safeNumber(inputs.acquiringPct), 0, 100)) / 100 + PAYMENT_ACCEPTANCE_FEE_RUB,
  );

  // ----- Возвраты и хранение -----
  const returns = round2(returnsPerSoldUnit * (middleMile + RETURN_HANDLING_RUB));
  const billableStorageDays = Math.max(
    0,
    safeNumber(inputs.returnStorageDays) - RETURN_STORAGE_FREE_DAYS,
  );
  const returnStorage = round2(
    returnsPerSoldUnit * RETURN_STORAGE_PER_DAY_RUB * billableStorageDays,
  );
  const storage = round2(safeNumber(inputs.storagePerUnit) + returnStorage);

  const ads = round2((revenue * clamp(safeNumber(inputs.drrPct), 0, 100)) / 100 / buyout);

  const cogs = round2(safeNumber(inputs.cost));
  const overhead = round2(safeNumber(inputs.overheadPerUnit));

  // ----- Налоги -----
  const vatRate = clamp(safeNumber(inputs.vatPct), 0, 100);
  const vat = round2((customerPrice * vatRate) / (100 + vatRate));
  const netRevenue = round2(customerPrice - vat);

  const expensesBeforeTax =
    commission +
    acquiring +
    lastMile +
    middleMile +
    orderProcessing +
    storage +
    returns +
    ads +
    cogs +
    overhead;

  const tax = round2(calcTax(netRevenue, expensesBeforeTax, inputs.taxMode, inputs.taxRatePct));

  const profitPerUnit = round2(revenue - expensesBeforeTax - vat - tax);
  const marginCustomerPct = customerPrice > 0 ? round2((profitPerUnit / customerPrice) * 100) : 0;
  const marginSellerPct = revenue > 0 ? round2((profitPerUnit / revenue) * 100) : 0;
  const roiPct = cogs > 0 ? round2((profitPerUnit / cogs) * 100) : 0;

  const sales = Math.max(0, safeNumber(inputs.salesPerMonth));
  const profitPerMonth = round2(profitPerUnit * sales);
  const moneyInStock = round2(cogs * Math.max(0, safeNumber(inputs.stock)));

  return {
    revenue,
    customerPrice,
    volume,
    commission,
    acquiring,
    lastMile,
    middleMile,
    orderProcessing,
    // @deprecated алиас — в UI-блоке это строка «Фулфилмент».
    fulfillment: orderProcessing,
    storage,
    returns,
    ads,
    vat,
    tax,
    cogs,
    overhead,
    profitPerUnit,
    marginSellerPct,
    marginCustomerPct,
    roiPct,
    profitPerMonth,
    moneyInStock,
    tariffVersion: YANDEX_TARIFF_VERSION,
  };
}
