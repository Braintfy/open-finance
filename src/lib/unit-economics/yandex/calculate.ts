// PURPOSE: Чистый расчёт Яндекс Маркет юнит-экономики.

import type { TaxMode, YandexInputs, YandexResults } from '../types';
import { clamp, round2, safeNumber } from '../types';
import {
  YANDEX_TARIFF_VERSION,
  calcVolume,
  fulfillmentCost,
  lastMileCost,
  middleMileCost,
  shouldUseFixedTariff,
  FIXED_TARIFF,
  specialTariffPct,
} from './tariffs-2026-04-01';

export const YANDEX_DEFAULT_INPUTS: YandexInputs = {
  mode: 'fby',
  sellerPrice: 0,
  coinvestPct: 0,
  lengthCm: 0,
  widthCm: 0,
  heightCm: 0,
  weightKg: 0,
  cost: 0,
  commissionPct: 7,
  acquiringPct: 1.5,
  specialTariff: 'none',
  fbsFastShipDiscountPct: 0,
  buyoutPct: 95,
  storagePerUnit: 0,
  drrPct: 5,
  overheadPerUnit: 0,
  taxMode: 'usn_income',
  taxRatePct: 6,
  taxDeductExpenses: false,
  vatPct: 0,
  salesPerMonth: 0,
  batchSize: 0,
  stock: 0,
};

function calcTax(
  customerPrice: number,
  expensesPerUnit: number,
  mode: TaxMode,
  ratePct: number,
  deductExpenses: boolean,
): number {
  if (mode === 'none') return 0;
  const rate = clamp(safeNumber(ratePct), 0, 100) / 100;
  if (mode === 'usn_income_minus' && deductExpenses) {
    return Math.max(0, customerPrice - expensesPerUnit) * rate;
  }
  return customerPrice * rate;
}

export function calculateYandex(rawInputs: Partial<YandexInputs>): YandexResults {
  const inputs: YandexInputs = { ...YANDEX_DEFAULT_INPUTS, ...rawInputs };
  const seller = safeNumber(inputs.sellerPrice);
  const coinvest = clamp(safeNumber(inputs.coinvestPct), 0, 100) / 100;
  const customerPrice = round2(seller * (1 - coinvest));
  const buyoutPct = clamp(safeNumber(inputs.buyoutPct, 100), 1, 100) / 100;

  const volume = calcVolume(
    safeNumber(inputs.lengthCm),
    safeNumber(inputs.widthCm),
    safeNumber(inputs.heightCm),
  );

  const useFixed = shouldUseFixedTariff(customerPrice, volume, inputs.mode);

  const baseCommissionPct =
    clamp(safeNumber(inputs.commissionPct), 0, 100) +
    specialTariffPct(inputs.specialTariff, inputs.mode);
  const commission = round2((customerPrice * baseCommissionPct) / 100);

  const acquiring = round2((customerPrice * clamp(safeNumber(inputs.acquiringPct), 0, 100)) / 100);

  let lastMile = lastMileCost(customerPrice);
  let middleMile = middleMileCost(volume, inputs.mode);
  let fulfillment = fulfillmentCost(volume, inputs.mode);

  if (useFixed) {
    fulfillment = FIXED_TARIFF;
    middleMile = 0;
    lastMile = Math.min(lastMile, FIXED_TARIFF);
  }

  if (inputs.mode === 'fbs') {
    const discountPp = clamp(safeNumber(inputs.fbsFastShipDiscountPct), 0, 100);
    middleMile = round2(middleMile * (1 - discountPp / 100));
  }

  const storage = round2(safeNumber(inputs.storagePerUnit));

  const ads = round2((customerPrice * clamp(safeNumber(inputs.drrPct), 0, 100)) / 100 / buyoutPct);

  const cogs = round2(safeNumber(inputs.cost));
  const overhead = round2(safeNumber(inputs.overheadPerUnit));

  const vat = round2((customerPrice * clamp(safeNumber(inputs.vatPct), 0, 100)) / 100);

  const expensesBeforeTax =
    commission + acquiring + lastMile + middleMile + fulfillment + storage + ads + cogs + overhead + vat;

  const tax = round2(
    calcTax(
      customerPrice,
      expensesBeforeTax,
      inputs.taxMode,
      inputs.taxRatePct,
      inputs.taxDeductExpenses,
    ),
  );

  const profitPerUnit = round2(customerPrice - expensesBeforeTax - tax);
  const marginCustomerPct = customerPrice > 0 ? round2((profitPerUnit / customerPrice) * 100) : 0;
  const marginSellerPct = seller > 0 ? round2((profitPerUnit / seller) * 100) : 0;
  const roiPct = cogs > 0 ? round2((profitPerUnit / cogs) * 100) : 0;

  const sales = Math.max(0, safeNumber(inputs.salesPerMonth));
  const profitPerMonth = round2(profitPerUnit * sales);
  const moneyInStock = round2(cogs * Math.max(0, safeNumber(inputs.stock)));

  return {
    customerPrice,
    volume,
    commission,
    acquiring,
    lastMile,
    middleMile,
    fulfillment,
    storage,
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
