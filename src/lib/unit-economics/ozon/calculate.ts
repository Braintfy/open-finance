// PURPOSE: Чистый расчёт Ozon юнит-экономики.
// Без сторонних зависимостей; принимает OzonInputs, возвращает OzonResults.
// Логистика — multi-cluster weighted-sum (см. computeLogistics).

import type { OzonInputs, OzonResults, TaxMode, OzonFbsClusterShare } from '../types';
import { clamp, round2, safeNumber } from '../types';
import {
  OZON_TARIFF_VERSION,
  autoCommissionPct,
  fboLogisticsCost,
  fbsLogisticsCost,
  FBS_FAST_SHIPMENT_COMMISSION_BUMP_PCT,
  HIGH_VOLUME_FBO_DISCOUNT,
  NON_LOCAL_CLUSTER_MULTIPLIER,
  PAID_ACCEPTANCE_FEE_PER_UNIT_RUB,
  RETURN_LOGISTICS_PCT_OF_FORWARD,
  FBS_CLUSTER_BY_KEY,
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
  fbsClusters: [],
  commissionMode: 'auto',
  commissionPct: 16,
  extraCommissionPct: 0,
  acquiringPct: 1.5,
  deliveryPvzPct: 4,
  deliveryPvzCap: 25,
  buyoutPct: 90,
  returnsPct: 5,
  cancelPct: 5,
  returnProcessing: 25,
  drrPct: 5,
  coInvestPct: 0,
  freeAcceptance: true,
  taxMode: 'usn_income',
  taxRatePct: 6,
  documentedExpensesMonth: 0,
  vatPct: 0,
  salesPerMonth: 0,
  batchSize: 0,
  stock: 0,
  overheadPerUnit: 0,
  indirectExpensesMonth: 0,
  supplyLeadWeeks: 4,
};

/**
 * Налог на одну продажу.
 * - usn_income (УСН Доходы): taxRatePct% от цены покупателя.
 * - usn_income_minus (УСН Д-Р): taxRatePct% от max(0, buyerPrice - documentedExpensesPerUnit).
 *   Если documentedExpensesPerUnit=0 — фактически как usn_income.
 * - osno: taxRatePct% от цены (упрощение для v1; реальный НДС считается отдельно через vatPct).
 * - none: 0.
 */
function calcTax(
  buyerPrice: number,
  documentedExpensesPerUnit: number,
  mode: TaxMode,
  ratePct: number,
): number {
  if (mode === 'none') return 0;
  const rate = clamp(safeNumber(ratePct), 0, 100) / 100;
  if (mode === 'usn_income_minus') {
    const taxable = Math.max(0, buyerPrice - documentedExpensesPerUnit);
    return taxable * rate;
  }
  return buyerPrice * rate;
}

/**
 * Multi-cluster логистика: weighted-sum по выбранным кластерам.
 * Если `fbsClusters` пуст — fallback к single-cluster через `isLocalCluster`.
 *
 * Доли нормализуются — если сумма != 100%, расчёт делится на фактическую сумму
 * (защита от частичного выбора, не превращающего пустые кластеры в "всё локально").
 */
function computeLogistics(
  inputs: OzonInputs,
  baseLogistics: number,
  highVolumeMultiplier: number,
): number {
  const clusters: OzonFbsClusterShare[] = Array.isArray(inputs.fbsClusters)
    ? inputs.fbsClusters.filter((c) => c && typeof c.key === 'string' && safeNumber(c.sharePct) > 0)
    : [];
  if (clusters.length === 0 || inputs.mode === 'fbo') {
    const clusterMultiplier = inputs.isLocalCluster ? 1 : NON_LOCAL_CLUSTER_MULTIPLIER;
    return baseLogistics * clusterMultiplier * highVolumeMultiplier;
  }
  const totalShare = clusters.reduce((acc, c) => acc + safeNumber(c.sharePct), 0);
  if (totalShare <= 0) return baseLogistics * highVolumeMultiplier;
  let weighted = 0;
  for (const c of clusters) {
    const meta = FBS_CLUSTER_BY_KEY[c.key];
    const local = meta?.local ?? false;
    const multiplier = local ? 1 : NON_LOCAL_CLUSTER_MULTIPLIER;
    const share = safeNumber(c.sharePct) / totalShare;
    weighted += baseLogistics * multiplier * highVolumeMultiplier * share;
  }
  return weighted;
}

export function calculateOzon(rawInputs: Partial<OzonInputs>): OzonResults {
  const inputs: OzonInputs = { ...OZON_DEFAULT_INPUTS, ...rawInputs };
  const buyerPrice = round2(
    safeNumber(inputs.price) * (1 - clamp(safeNumber(inputs.discountPct), 0, 100) / 100),
  );

  // Buyout derived из returnsPct + cancelPct, либо legacy buyoutPct если оба 0.
  const returnsPct = clamp(safeNumber(inputs.returnsPct), 0, 100);
  const cancelPct = clamp(safeNumber(inputs.cancelPct), 0, 100);
  const sumLoss = returnsPct + cancelPct;
  const effectiveBuyoutPct =
    sumLoss > 0
      ? Math.max(1, 100 - sumLoss)
      : clamp(safeNumber(inputs.buyoutPct, 100), 1, 100);
  const buyout = effectiveBuyoutPct / 100;
  const lossShare = 1 - buyout;

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
  const highVolumeMultiplier =
    inputs.mode === 'fbo' && inputs.highVolumeDiscount ? 1 - HIGH_VOLUME_FBO_DISCOUNT : 1;
  const logisticsRaw = computeLogistics(inputs, baseLogistics, highVolumeMultiplier);
  const acceptanceFee =
    !inputs.freeAcceptance && inputs.mode === 'fbs' ? PAID_ACCEPTANCE_FEE_PER_UNIT_RUB : 0;
  const logistics = round2(logisticsRaw + acceptanceFee);

  // Доставка до ПВЗ — только FBO; учитывает выкуп (логистика на 1 проданную единицу).
  let deliveryPvz = 0;
  if (inputs.mode === 'fbo') {
    const cap = safeNumber(inputs.deliveryPvzCap, 25);
    const pct = clamp(safeNumber(inputs.deliveryPvzPct, 4), 0, 100) / 100;
    const raw = Math.min(buyerPrice * pct, cap);
    deliveryPvz = round2(raw / buyout);
  }

  // Возврат: на каждую проданную единицу приходится lossShare возвратов/отмен,
  // каждый стоит как часть прямой логистики + обработка.
  const returns = round2(
    (logistics * RETURN_LOGISTICS_PCT_OF_FORWARD + safeNumber(inputs.returnProcessing)) *
      (lossShare / buyout),
  );

  // Реклама: ДРР рассчитывается от цены, и распределяется на одну выкупленную единицу.
  const ads = round2((buyerPrice * clamp(safeNumber(inputs.drrPct), 0, 100)) / 100 / buyout);

  const cogs = round2(safeNumber(inputs.cost) + safeNumber(inputs.crossDockingCost));
  const sales = Math.max(0, safeNumber(inputs.salesPerMonth));
  const indirectPerUnit =
    sales > 0 ? safeNumber(inputs.indirectExpensesMonth) / sales : 0;
  const overhead = round2(safeNumber(inputs.overheadPerUnit) + indirectPerUnit);

  const vat = round2((buyerPrice * clamp(safeNumber(inputs.vatPct), 0, 100)) / 100);

  // Расходы до соинвеста и налога — для расчёта компенсации баллами.
  const expensesGross =
    commission + acquiring + logistics + deliveryPvz + returns + ads + cogs + overhead + vat;
  const coInvestSavings = round2(
    (expensesGross * clamp(safeNumber(inputs.coInvestPct), 0, 100)) / 100,
  );
  const expensesAfterCoInvest = expensesGross - coInvestSavings;

  // Документально подтверждённые расходы на единицу — для УСН Д-Р.
  const documentedPerUnit =
    sales > 0 ? safeNumber(inputs.documentedExpensesMonth) / sales : 0;
  const tax = round2(
    calcTax(buyerPrice, documentedPerUnit, inputs.taxMode, inputs.taxRatePct),
  );

  const profitPerUnit = round2(buyerPrice - expensesAfterCoInvest - tax);
  const marginPct = buyerPrice > 0 ? round2((profitPerUnit / buyerPrice) * 100) : 0;
  const roiPct = cogs > 0 ? round2((profitPerUnit / cogs) * 100) : 0;

  const profitPerMonth = round2(profitPerUnit * sales);
  const annualRoiPct =
    cogs > 0
      ? round2(((profitPerUnit * sales * 12) / Math.max(cogs * Math.max(1, safeNumber(inputs.batchSize)), cogs)) * 100)
      : 0;
  const turnoverWeeks =
    sales > 0 ? round2((Math.max(1, safeNumber(inputs.stock)) / sales) * (52 / 12)) : 0;
  const moneyInStock = round2(cogs * Math.max(0, safeNumber(inputs.stock)));
  const profitPerBatch = round2(profitPerUnit * Math.max(0, safeNumber(inputs.batchSize)));

  return {
    buyerPrice,
    priceWithSpp: buyerPrice,
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
    coInvestSavings,
    profitPerUnit,
    marginPct,
    roiPct,
    profitPerMonth,
    annualRoiPct,
    turnoverWeeks,
    moneyInStock,
    profitPerBatch,
    effectiveBuyoutPct,
    tariffVersion: OZON_TARIFF_VERSION,
  };
}
