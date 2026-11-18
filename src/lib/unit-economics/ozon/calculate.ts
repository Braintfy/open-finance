// PURPOSE: Чистый расчёт Ozon юнит-экономики.
// Без сторонних зависимостей; принимает OzonInputs, возвращает OzonResults.
// Логистика — multi-cluster weighted-sum (см. computeForwardLogistics).
//
// Модель выручки и расходов (тарифы ozon_2026_08_30):
//  - Выручка продавца = `buyerPrice` (цена после ЕГО скидки).
//  - СПП/соинвест — скидка за счёт Ozon: уменьшает только `priceWithSpp`
//    и налоговую базу, НЕ уменьшает расходы и НЕ увеличивает прибыль.
//  - Логистика/приёмка начисляются на ЗАКАЗ → на выкупленную единицу
//    делятся на процент выкупа. Исключение — приёмка FBO (на единицу).
//  - НДС ИЗВЛЕКАЕТСЯ из цены покупателя, а не начисляется сверху.

import type { OzonInputs, OzonResults, OzonFbsClusterShare } from '../types';
import { clamp, round2, safeNumber } from '../types';
import { calcUnitTax } from '@/lib/metrics/tax';
import {
  OZON_TARIFF_VERSION,
  autoCommissionPct,
  fboAcceptanceFee,
  fboLogisticsCost,
  fbsDropoffAcceptanceFee,
  fbsLogisticsCost,
  fbsShipmentSpeedCommissionPp,
  isLocalityDiscountExcluded,
  LOCALITY_COMMISSION_DISCOUNT_PP,
  NON_LOCAL_CLUSTER_MULTIPLIER,
  paymentDeferralDiscountPp,
  RETURN_LOGISTICS_PCT_OF_FORWARD,
  FBS_CLUSTER_BY_KEY,
} from './tariffs-2026-08-30';

export const OZON_DEFAULT_INPUTS: OzonInputs = {
  mode: 'fbo',
  price: 0,
  discountPct: 0,
  cost: 0,
  crossDockingCost: 0,
  volumeL: 1,
  isLocalCluster: true,
  highVolumeDiscount: false,
  localityDiscount: false,
  paymentDeferralDays: 0,
  fbsDropoffPoint: 'sorting_center',
  fbsShipmentSpeed: 'standard',
  fbsClusters: [],
  // 'manual' — то, что де-факто делают оба UI-блока. Режим 'auto' оставлен
  // рабочим (autoCommissionPct), но по умолчанию не включается.
  commissionMode: 'manual',
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
 * Multi-cluster прямая логистика на ЗАКАЗ: weighted-sum по выбранным кластерам.
 * Если `fbsClusters` пуст — fallback к single-cluster через `isLocalCluster`.
 *
 * Доли нормализуются — если сумма != 100%, расчёт делится на фактическую сумму
 * (защита от частичного выбора, не превращающего пустые кластеры в "всё локально").
 */
function computeForwardLogistics(inputs: OzonInputs, baseLogistics: number): number {
  const clusters = activeClusters(inputs);
  if (clusters.length === 0 || inputs.mode === 'fbo') {
    const clusterMultiplier = inputs.isLocalCluster ? 1 : NON_LOCAL_CLUSTER_MULTIPLIER;
    return baseLogistics * clusterMultiplier;
  }
  const totalShare = clusters.reduce((acc, c) => acc + safeNumber(c.sharePct), 0);
  if (totalShare <= 0) return baseLogistics;
  let weighted = 0;
  for (const c of clusters) {
    const meta = FBS_CLUSTER_BY_KEY[c.key];
    const local = meta?.local ?? false;
    const multiplier = local ? 1 : NON_LOCAL_CLUSTER_MULTIPLIER;
    const share = safeNumber(c.sharePct) / totalShare;
    weighted += baseLogistics * multiplier * share;
  }
  return weighted;
}

function activeClusters(inputs: OzonInputs): OzonFbsClusterShare[] {
  return Array.isArray(inputs.fbsClusters)
    ? inputs.fbsClusters.filter((c) => c && typeof c.key === 'string' && safeNumber(c.sharePct) > 0)
    : [];
}

/**
 * Доля отгрузок, на которую распространяется скидка за локальность (0..1).
 * Исключения — Москва/МО+ДВ, СПб+СЗО, Беларусь. Для multi-cluster FBS
 * считается доля неисключённых кластеров, иначе смотрим на `inputs.cluster`.
 */
function localityEligibleShare(inputs: OzonInputs): number {
  const clusters = activeClusters(inputs);
  if (inputs.mode === 'fbs' && clusters.length > 0) {
    const total = clusters.reduce((acc, c) => acc + safeNumber(c.sharePct), 0);
    if (total <= 0) return 0;
    const eligible = clusters
      .filter((c) => !isLocalityDiscountExcluded(c.key))
      .reduce((acc, c) => acc + safeNumber(c.sharePct), 0);
    return eligible / total;
  }
  return isLocalityDiscountExcluded(inputs.cluster) ? 0 : 1;
}

export function calculateOzon(rawInputs: Partial<OzonInputs>): OzonResults {
  const inputs: OzonInputs = { ...OZON_DEFAULT_INPUTS, ...rawInputs };

  // Выручка продавца — цена после ЕГО скидки. СПП её не уменьшает.
  const buyerPrice = round2(
    safeNumber(inputs.price) * (1 - clamp(safeNumber(inputs.discountPct), 0, 100) / 100),
  );
  // Цена, которую фактически платит покупатель (скидка за счёт Ozon).
  const coInvest = clamp(safeNumber(inputs.coInvestPct), 0, 100) / 100;
  const priceWithSpp = round2(buyerPrice * (1 - coInvest));
  // Справочно: сколько скидки оплатил Ozon. НЕ участвует в P&L продавца.
  const coInvestSavings = round2(buyerPrice - priceWithSpp);

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

  // ----- Комиссия -----
  const baseCommissionPct =
    inputs.commissionMode === 'auto'
      ? autoCommissionPct(buyerPrice, safeNumber(inputs.commissionPct))
      : safeNumber(inputs.commissionPct);
  // FBS: скорость отгрузки даёт скидку (быстро) или штраф (медленно), п.п.
  const speedPp =
    inputs.mode === 'fbs'
      ? fbsShipmentSpeedCommissionPp(
          inputs.fbsDropoffPoint ?? 'sorting_center',
          inputs.fbsShipmentSpeed ?? 'standard',
        )
      : 0;
  // Скидка за локальность — 3 п.п., пропорционально доле неисключённых кластеров.
  const localityPp = inputs.localityDiscount
    ? -LOCALITY_COMMISSION_DISCOUNT_PP * localityEligibleShare(inputs)
    : 0;
  // Скидка за отсрочку выплат — 0.45 п.п. за каждые 14 дней.
  const deferralPp = -paymentDeferralDiscountPp(safeNumber(inputs.paymentDeferralDays));
  const totalCommissionPct = clamp(
    baseCommissionPct + safeNumber(inputs.extraCommissionPct) + speedPp + localityPp + deferralPp,
    0,
    100,
  );
  const commission = round2((buyerPrice * totalCommissionPct) / 100);

  const acquiring = round2((buyerPrice * clamp(safeNumber(inputs.acquiringPct), 0, 100)) / 100);

  // ----- Логистика и приёмка -----
  const baseLogistics =
    inputs.mode === 'fbo'
      ? fboLogisticsCost(safeNumber(inputs.volumeL, 1))
      : fbsLogisticsCost(safeNumber(inputs.volumeL, 1));
  // Прямая логистика начисляется на ЗАКАЗ; на выкупленную единицу приходится
  // 1/buyout заказов (за невыкупы прямая логистика тоже уплачена).
  const forwardPerOrder = computeForwardLogistics(inputs, baseLogistics);
  const acceptance =
    inputs.mode === 'fbs'
      ? // приёмка по точке сдачи — на заказ, значит делится на выкуп
        fbsDropoffAcceptanceFee(inputs.fbsDropoffPoint ?? 'sorting_center') / buyout
      : // FBO: «обработка в составе грузоместа» — разово на единицу поставки
        inputs.freeAcceptance
        ? 0
        : fboAcceptanceFee(safeNumber(inputs.volumeL, 1));
  const logistics = round2(forwardPerOrder / buyout + acceptance);

  // Доставка до ПВЗ — только FBO; учитывает выкуп (на 1 проданную единицу).
  let deliveryPvz = 0;
  if (inputs.mode === 'fbo') {
    const cap = safeNumber(inputs.deliveryPvzCap, 25);
    const pct = clamp(safeNumber(inputs.deliveryPvzPct, 4), 0, 100) / 100;
    const raw = Math.min(buyerPrice * pct, cap);
    deliveryPvz = round2(raw / buyout);
  }

  // Обратная логистика: на каждую ВЫКУПЛЕННУЮ единицу приходится
  // (1 − buyout)/buyout возвратов/отмен, каждый стоит часть прямой логистики
  // ЗАКАЗА плюс обработка возврата.
  const returns = round2(
    (forwardPerOrder * RETURN_LOGISTICS_PCT_OF_FORWARD + safeNumber(inputs.returnProcessing)) *
      (lossShare / buyout),
  );

  // Реклама: ДРР рассчитывается от цены, и распределяется на одну выкупленную единицу.
  const ads = round2((buyerPrice * clamp(safeNumber(inputs.drrPct), 0, 100)) / 100 / buyout);

  const cogs = round2(safeNumber(inputs.cost) + safeNumber(inputs.crossDockingCost));
  const sales = Math.max(0, safeNumber(inputs.salesPerMonth));
  const indirectPerUnit =
    sales > 0 ? safeNumber(inputs.indirectExpensesMonth) / sales : 0;
  const overhead = round2(safeNumber(inputs.overheadPerUnit) + indirectPerUnit);

  // ----- Налоги -----
  // НДС извлекается из цены покупателя (он уже «сидит» в цене), а не сверху.
  const vatRate = clamp(safeNumber(inputs.vatPct), 0, 100);
  const vat = round2((priceWithSpp * vatRate) / (100 + vatRate));
  // Доход для целей налога — то, что заплатил покупатель, без НДС.
  const netRevenue = round2(priceWithSpp - vat);

  const expensesBeforeTax =
    commission + acquiring + logistics + deliveryPvz + returns + ads + cogs + overhead;
  // Дополнительные документально подтверждённые расходы (сверх статей расчёта).
  const documentedPerUnit =
    sales > 0 ? safeNumber(inputs.documentedExpensesMonth) / sales : 0;
  const tax = round2(
    calcUnitTax(netRevenue, expensesBeforeTax + documentedPerUnit, inputs.taxMode, inputs.taxRatePct),
  );

  // НДС — отдельная строка расхода (инвариант проекта), поэтому в прибыль
  // он входит вычетом, а не через уменьшение выручки.
  const profitPerUnit = round2(buyerPrice - expensesBeforeTax - vat - tax);
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
    priceWithSpp,
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
