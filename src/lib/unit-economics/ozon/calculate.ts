// PURPOSE: Чистый расчёт Ozon юнит-экономики.
// Без сторонних зависимостей; принимает OzonInputs, возвращает OzonResults.

import type { OzonInputs, OzonResults, TaxMode } from '../types';
import { clamp, round2, safeNumber } from '../types';
import {
  OZON_TARIFF_VERSION,
  autoCommissionPct,
  fboLogisticsCost,
  fbsLogisticsCost,
  FBS_FAST_SHIPMENT_COMMISSION_BUMP_PCT,
  HIGH_VOLUME_FBO_DISCOUNT,
  NON_LOCAL_CLUSTER_MULTIPLIER,
  RETURN_LOGISTICS_PCT_OF_FORWARD,
} from './tariffs-2026-04-07';

export const OZON_DEFAULT_INPUTS: OzonInputs = {
  mode: 'fbo',
  price: 0,
  discountPct: 0,
  cost: 0,
  crossDockingCost: 0,
  volumeL: 1,
  isLocalCluster: true,
  highVolumeDiscount: false,
  fbsDropoffPoint: 'sorting_center',
  fbsShipmentSpeed: 'standard',
  fbsWarehouse: 'almaty',
  commissionMode: 'auto',
  commissionPct: 16,
  extraCommissionPct: 0,
  acquiringPct: 1.5,
  deliveryPvzPct: 4,
  deliveryPvzCap: 25,
  buyoutPct: 90,
  returnProcessing: 25,
  drrPct: 5,
  taxMode: 'usn_income',
  taxRatePct: 6,
  taxDeductExpenses: false,
  vatPct: 0,
  salesPerMonth: 0,
  batchSize: 0,
  stock: 0,
  overheadPerUnit: 0,
};

/**
 * Налог на одну продажу.
 * - usn_income (УСН Доходы): taxRatePct% от цены покупателя.
 * - usn_income_minus (УСН Д-Р): taxRatePct% от (buyerPrice - расходы) при taxDeductExpenses=true,
 *   иначе как usn_income.
 * - osno: taxRatePct% от цены (упрощение для v1; реальный НДС считается отдельно).
 * - nds: НДС начисляется на цену.
 * - none: 0.
 */
function calcTax(
  buyerPrice: number,
  expensesPerUnit: number,
  mode: TaxMode,
  ratePct: number,
  deductExpenses: boolean,
): number {
  if (mode === 'none') return 0;
  const rate = clamp(safeNumber(ratePct), 0, 100) / 100;
  if (mode === 'usn_income_minus' && deductExpenses) {
    return Math.max(0, buyerPrice - expensesPerUnit) * rate;
  }
  return buyerPrice * rate;
}

export function calculateOzon(rawInputs: Partial<OzonInputs>): OzonResults {
  const inputs: OzonInputs = { ...OZON_DEFAULT_INPUTS, ...rawInputs };
  const buyerPrice = round2(
    safeNumber(inputs.price) * (1 - clamp(safeNumber(inputs.discountPct), 0, 100) / 100),
  );
  const buyoutPct = clamp(safeNumber(inputs.buyoutPct, 100), 1, 100) / 100;

  const baseCommissionPct =
    inputs.commissionMode === 'auto'
      ? autoCommissionPct(buyerPrice, safeNumber(inputs.commissionPct))
      : safeNumber(inputs.commissionPct);
  // FBS: быстрая отгрузка (12–24ч) добавляет фиксированный % к комиссии.
  const fastShipmentBumpPct =
    inputs.mode === 'fbs' && inputs.fbsShipmentSpeed === 'fast'
      ? FBS_FAST_SHIPMENT_COMMISSION_BUMP_PCT
      : 0;
  const totalCommissionPct = clamp(
    baseCommissionPct + safeNumber(inputs.extraCommissionPct) + fastShipmentBumpPct,
    0,
    100,
  );
  const commission = round2((buyerPrice * totalCommissionPct) / 100);

  const acquiring = round2((buyerPrice * clamp(safeNumber(inputs.acquiringPct), 0, 100)) / 100);

  const baseLogistics =
    inputs.mode === 'fbo'
      ? fboLogisticsCost(safeNumber(inputs.volumeL, 1))
      : fbsLogisticsCost(safeNumber(inputs.volumeL, 1));
  const clusterMultiplier = inputs.isLocalCluster ? 1 : NON_LOCAL_CLUSTER_MULTIPLIER;
  const highVolumeMultiplier =
    inputs.mode === 'fbo' && inputs.highVolumeDiscount ? 1 - HIGH_VOLUME_FBO_DISCOUNT : 1;
  const logistics = round2(baseLogistics * clusterMultiplier * highVolumeMultiplier);

  // Доставка до ПВЗ — только FBO; учитывает выкуп (логистика на 1 проданную единицу).
  let deliveryPvz = 0;
  if (inputs.mode === 'fbo') {
    const cap = safeNumber(inputs.deliveryPvzCap, 25);
    const pct = clamp(safeNumber(inputs.deliveryPvzPct, 4), 0, 100) / 100;
    const raw = Math.min(buyerPrice * pct, cap);
    deliveryPvz = round2(raw / buyoutPct);
  }

  // Возврат: на каждую проданную единицу приходится (1 - buyout) возвратов,
  // каждый стоит как часть прямой логистики + обработка.
  const notBoughtOutShare = 1 - buyoutPct;
  const returns = round2(
    (logistics * RETURN_LOGISTICS_PCT_OF_FORWARD + safeNumber(inputs.returnProcessing)) *
      (notBoughtOutShare / buyoutPct),
  );

  // Реклама: ДРР рассчитывается от цены, и распределяется на одну выкупленную единицу.
  const ads = round2((buyerPrice * clamp(safeNumber(inputs.drrPct), 0, 100)) / 100 / buyoutPct);

  const cogs = round2(safeNumber(inputs.cost) + safeNumber(inputs.crossDockingCost));
  const overhead = round2(safeNumber(inputs.overheadPerUnit));

  const vat = round2((buyerPrice * clamp(safeNumber(inputs.vatPct), 0, 100)) / 100);

  const expensesBeforeTax =
    commission + acquiring + logistics + deliveryPvz + returns + ads + cogs + overhead + vat;
  const tax = round2(
    calcTax(buyerPrice, expensesBeforeTax, inputs.taxMode, inputs.taxRatePct, inputs.taxDeductExpenses),
  );

  const profitPerUnit = round2(buyerPrice - expensesBeforeTax - tax);
  const marginPct = buyerPrice > 0 ? round2((profitPerUnit / buyerPrice) * 100) : 0;
  const roiPct = cogs > 0 ? round2((profitPerUnit / cogs) * 100) : 0;

  const sales = Math.max(0, safeNumber(inputs.salesPerMonth));
  const profitPerMonth = round2(profitPerUnit * sales);
  const annualRoiPct = cogs > 0 ? round2(((profitPerUnit * sales * 12) / Math.max(cogs * Math.max(1, safeNumber(inputs.batchSize)), cogs)) * 100) : 0;
  const turnoverWeeks = sales > 0 ? round2((Math.max(1, safeNumber(inputs.stock)) / sales) * (52 / 12)) : 0;
  const moneyInStock = round2(cogs * Math.max(0, safeNumber(inputs.stock)));
  const profitPerBatch = round2(profitPerUnit * Math.max(0, safeNumber(inputs.batchSize)));

  return {
    buyerPrice,
    commission,
    acquiring,
    logistics,
    deliveryPvz,
    returns,
    ads,
    vat,
    tax,
    cogs,
    overhead,
    profitPerUnit,
    marginPct,
    roiPct,
    profitPerMonth,
    annualRoiPct,
    turnoverWeeks,
    moneyInStock,
    profitPerBatch,
    tariffVersion: OZON_TARIFF_VERSION,
  };
}
