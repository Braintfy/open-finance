// PURPOSE: Smoke-тесты юнит-экономики Ozon, формул «Моего магазина» и
// XLSX-парсера Ozon. Полный набор тестов Яндекса — scripts/test-yandex-calc.ts.
// Запуск: pnpm tsx scripts/test-unit-economics.ts [path-to-xlsx]
import fs from 'node:fs';
import path from 'node:path';
import { calculateOzon, OZON_DEFAULT_INPUTS } from '../src/lib/unit-economics/ozon/calculate';
import { calculateYandex } from '../src/lib/unit-economics/yandex/calculate';
import type { OzonInputs } from '../src/lib/unit-economics/types';
import {
  autoCommissionPct,
  fboAcceptanceFee,
  fbsDropoffAcceptanceFee,
  fbsShipmentSpeedCommissionPp,
  paymentDeferralDiscountPp,
} from '../src/lib/unit-economics/ozon/tariffs-2026-08-30';
import { parseOzonPriceTemplate } from '../src/lib/unit-economics/import/ozon-price-template';
import { evalRowFormulas, evalSingleFormula } from '../src/lib/unit-economics/store-formula';

let failed = 0;
let passed = 0;

function expect(cond: boolean, name: string, hint?: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${hint ? ' — ' + hint : ''}`);
  }
}

function near(actual: number, expected: number, eps: number, name: string) {
  expect(Math.abs(actual - expected) <= eps, name, `actual=${actual.toFixed(2)} expected=${expected.toFixed(2)} eps=${eps}`);
}

/**
 * База для микротестов: всё «выключено», чтобы каждый тест проверял
 * ровно одну статью расчёта. Выкуп 100% (returnsPct+cancelPct=0).
 */
const BASE: Partial<OzonInputs> = {
  mode: 'fbo',
  price: 1000,
  discountPct: 0,
  cost: 0,
  crossDockingCost: 0,
  volumeL: 1,
  isLocalCluster: true,
  commissionMode: 'manual',
  commissionPct: 0,
  extraCommissionPct: 0,
  acquiringPct: 0,
  deliveryPvzPct: 0,
  deliveryPvzCap: 0,
  buyoutPct: 100,
  returnsPct: 0,
  cancelPct: 0,
  returnProcessing: 0,
  drrPct: 0,
  coInvestPct: 0,
  freeAcceptance: true,
  localityDiscount: false,
  paymentDeferralDays: 0,
  taxMode: 'none',
  taxRatePct: 0,
  vatPct: 0,
  salesPerMonth: 0,
  batchSize: 0,
  stock: 0,
  overheadPerUnit: 0,
  indirectExpensesMonth: 0,
};

console.log('\n# ЭТАЛОН A — FBO, локальный кластер, выкуп 77%');
{
  // 1500 ₽ / себест. 500 ₽ / 1 л / комиссия 20% / возвраты 15% + отмены 8%
  const r = calculateOzon({
    mode: 'fbo', price: 1500, discountPct: 0, cost: 500, volumeL: 1, isLocalCluster: true,
    commissionMode: 'manual', commissionPct: 20, extraCommissionPct: 0, acquiringPct: 1.5,
    deliveryPvzPct: 4, deliveryPvzCap: 25,
    returnsPct: 15, cancelPct: 8, returnProcessing: 25, drrPct: 5,
    coInvestPct: 0, freeAcceptance: true,
    taxMode: 'usn_income', taxRatePct: 6, vatPct: 0,
    salesPerMonth: 0, batchSize: 0, stock: 0, overheadPerUnit: 0,
  });
  near(r.effectiveBuyoutPct, 77, 0.01, 'Выкуп = 100 − 15 − 8 = 77%');
  near(r.commission, 300, 0.01, 'Комиссия 20% от 1500 = 300');
  near(r.acquiring, 22.5, 0.01, 'Эквайринг 1.5% = 22.50');
  near(r.logistics, 64.94, 0.01, 'Логистика 50 ₽ / 0.77 = 64.94 (было 50.00 — не делилась на выкуп)');
  near(r.deliveryPvz, 32.47, 0.01, 'ПВЗ min(60, 25) / 0.77 = 32.47');
  near(r.returns, 14.94, 0.01, 'Возвраты (50×0.5 + 25) × 0.23/0.77 = 14.94');
  near(r.ads, 97.4, 0.01, 'Реклама 5% × 1500 / 0.77 = 97.40');
  near(r.tax, 90, 0.01, 'УСН Доходы 6% от 1500 = 90');
  near(r.profitPerUnit, 377.75, 0.01, 'ЭТАЛОН A: прибыль = 377.75 ₽ (было 392.69 ₽)');
  near(r.marginPct, 25.18, 0.02, 'ЭТАЛОН A: маржа 25.18%');
  near(r.roiPct, 75.55, 0.02, 'ЭТАЛОН A: ROI 75.55%');
  // Регрессия: до фикса прямая логистика не делилась на выкуп → расходы были
  // на 14.94 ₽ меньше, прибыль 392.69 ₽ (маржа 26.18%) — завышение ~4%.
}

console.log('\n# ЭТАЛОН B — FBO, нелокальный кластер, НДС 20%, УСН Д-Р, платная приёмка');
{
  const r = calculateOzon({
    mode: 'fbo', price: 3000, discountPct: 0, cost: 900, volumeL: 5, isLocalCluster: false,
    commissionMode: 'manual', commissionPct: 22, extraCommissionPct: 0, acquiringPct: 1.5,
    deliveryPvzPct: 4, deliveryPvzCap: 25,
    returnsPct: 10, cancelPct: 5, returnProcessing: 30, drrPct: 8,
    coInvestPct: 0, freeAcceptance: false,
    taxMode: 'usn_income_minus', taxRatePct: 15, documentedExpensesMonth: 0, vatPct: 20,
    salesPerMonth: 100, batchSize: 0, stock: 0, overheadPerUnit: 0,
  });
  near(r.commission, 660, 0.01, 'Комиссия 22% от 3000 = 660');
  near(r.logistics, 156.06, 0.01, 'Логистика (100 × 1.25) / 0.85 + приёмка 9 = 156.06');
  near(r.returns, 16.32, 0.01, 'Возвраты (125×0.5 + 30) × 0.15/0.85 = 16.32');
  near(r.ads, 282.35, 0.01, 'Реклама 8% × 3000 / 0.85 = 282.35');
  near(r.vat, 500, 0.01, 'НДС = 3000 × 20/120 = 500 (было 600 — начислялся сверху)');
  near(r.tax, 61.63, 0.02, 'УСН Д-Р 15% от (2500 − 2089.14) = 61.63 (было 450 — 15% с выручки)');
  near(r.profitPerUnit, 349.23, 0.02, 'ЭТАЛОН B: прибыль = 349.23 ₽ (было −108.08 ₽)');
  near(r.marginPct, 11.64, 0.02, 'ЭТАЛОН B: маржа 11.64%');
  // Регрессия: старый движок давал УБЫТОК −108.08 ₽ из-за НДС сверху (600 ₽)
  // и налога 15% с полной выручки (450 ₽) — товар выглядел нерентабельным.
}

console.log('\n# ЭТАЛОН C — FBS, сдача в ПВЗ, отгрузка в слот');
{
  const r = calculateOzon({
    mode: 'fbs', price: 1200, discountPct: 0, cost: 400, volumeL: 2, isLocalCluster: true,
    commissionMode: 'manual', commissionPct: 20, extraCommissionPct: 0, acquiringPct: 1.5,
    returnsPct: 10, cancelPct: 5, returnProcessing: 25, drrPct: 5,
    fbsClusters: [{ key: 'moscow_region', sharePct: 100 }],
    fbsDropoffPoint: 'pickup_point', fbsShipmentSpeed: 'in_slot',
    coInvestPct: 0, freeAcceptance: true,
    taxMode: 'usn_income', taxRatePct: 6, vatPct: 0,
    salesPerMonth: 0, batchSize: 0, stock: 0, overheadPerUnit: 0,
  });
  near(r.commission, 216, 0.01, 'Комиссия (20 − 2 за отгрузку в слот)% = 18% × 1200 = 216');
  near(r.logistics, 120, 0.01, 'Логистика (92 + приёмка ПВЗ 10) / 0.85 = 120.00');
  near(r.deliveryPvz, 0, 0.01, 'FBS: доставки до ПВЗ нет');
  near(r.returns, 12.53, 0.01, 'Возвраты (92×0.5 + 25) × 0.15/0.85 = 12.53');
  near(r.profitPerUnit, 290.88, 0.02, 'ЭТАЛОН C: прибыль = 290.88 ₽');
  near(r.marginPct, 24.24, 0.02, 'ЭТАЛОН C: маржа 24.24%');
  // Регрессия старого движка (ozon_2026_04_07) на тех же входных данных:
  //  - скорости «в слот» не существовало; legacy 'standard' → комиссия 240 ₽,
  //    legacy 'fast' ДОБАВЛЯЛА +2% → 264 ₽ (вместо скидки);
  //  - приёмка ПВЗ 10 ₽ не начислялась (только при снятом флаге «бесплатная
  //    приёмка» и без деления на выкуп);
  //  - логистика не делилась на выкуп → 92 ₽ вместо 120 ₽.
  // Итог: прибыль 294.88 ₽ (standard) / 270.88 ₽ (fast) против 290.88 ₽ сейчас.
}

console.log('\n# Микро: прямая логистика делится на выкуп');
{
  const full = calculateOzon({ ...BASE, volumeL: 1 });
  const partial = calculateOzon({ ...BASE, volumeL: 1, returnsPct: 20, cancelPct: 3 });
  near(full.logistics, 50, 0.01, 'Выкуп 100% → логистика = 50 (тариф FBO 1 л)');
  near(partial.logistics, 64.94, 0.01, 'Выкуп 77% → 50 / 0.77 = 64.94');
  near(partial.returns, 7.47, 0.01, 'Обратная логистика = (50 × 0.5) × 0.23/0.77 = 7.47');
}

console.log('\n# Микро: НДС извлекается из цены покупателя');
{
  const noVat = calculateOzon({ ...BASE });
  const withVat = calculateOzon({ ...BASE, vatPct: 20 });
  near(noVat.vat, 0, 0.01, 'vatPct=0 → НДС = 0');
  near(withVat.vat, 166.67, 0.01, 'vatPct=20 → 1000 × 20/120 = 166.67 (было 200 — сверху)');
  near(withVat.profitPerUnit, noVat.profitPerUnit - 166.67, 0.01, 'Прибыль ниже ровно на НДС');
  const withVat5 = calculateOzon({ ...BASE, vatPct: 5 });
  near(withVat5.vat, 47.62, 0.01, 'vatPct=5 → 1000 × 5/105 = 47.62');
}

console.log('\n# Микро: соинвест (СПП) не уменьшает расходы продавца');
{
  const noCo = calculateOzon({ ...BASE, commissionPct: 20, taxMode: 'usn_income', taxRatePct: 6 });
  const withCo = calculateOzon({
    ...BASE, commissionPct: 20, coInvestPct: 20, taxMode: 'usn_income', taxRatePct: 6,
  });
  near(withCo.buyerPrice, 1000, 0.01, 'Выручка продавца не меняется — 1000');
  near(withCo.priceWithSpp, 800, 0.01, 'Цена с СПП = 1000 × (1 − 20%) = 800');
  near(withCo.coInvestSavings, 200, 0.01, 'coInvestSavings = сумма скидки за счёт Ozon = 200');
  near(withCo.commission, 200, 0.01, 'Комиссия по-прежнему от цены продавца: 20% × 1000');
  near(withCo.tax, 48, 0.01, 'Налог с цены покупателя: 6% × 800 = 48');
  near(noCo.tax, 60, 0.01, 'Без СПП налог 6% × 1000 = 60');
  near(withCo.profitPerUnit, noCo.profitPerUnit + 12, 0.01, 'Разница в прибыли = только экономия налога (12 ₽)');
  // Регрессия: раньше coInvestSavings = 20% ОТ ВСЕХ РАСХОДОВ и вычитался из
  // них → прибыль раздувалась на 240 ₽ (20% × (200 комиссия + 50 логистика +
  // 1000×... )). Теперь СПП влияет только на цену покупателя и налог.
}

console.log('\n# Микро: приёмка FBO (обработка в составе грузоместа)');
{
  near(fboAcceptanceFee(1), 5, 0.01, '1 л → 5 + (1−1) = 5 ₽');
  near(fboAcceptanceFee(5), 9, 0.01, '5 л → 5 + (5−1) = 9 ₽');
  near(fboAcceptanceFee(0.5), 5, 0.01, '0.5 л → верхняя граница 0.6 → ceil 1 → 5 ₽');
  near(fboAcceptanceFee(100), 60, 0.01, '100 л → 104 → потолок 60 ₽');
  const free = calculateOzon({ ...BASE, volumeL: 5, freeAcceptance: true });
  const paid = calculateOzon({ ...BASE, volumeL: 5, freeAcceptance: false });
  near(paid.logistics - free.logistics, 9, 0.01, 'Платная приёмка FBO 5 л добавляет 9 ₽ к логистике');
  const paidLowBuyout = calculateOzon({ ...BASE, volumeL: 5, freeAcceptance: false, returnsPct: 20, cancelPct: 0 });
  near(paidLowBuyout.logistics, 100 / 0.8 + 9, 0.01, 'Приёмка FBO НЕ делится на выкуп (разовая на единицу)');
}

console.log('\n# Микро: приёмка FBS по точке сдачи (делится на выкуп)');
{
  near(fbsDropoffAcceptanceFee('sorting_center'), 0, 0.01, 'СЦ = 0 ₽');
  near(fbsDropoffAcceptanceFee('courier'), 4.13, 0.01, 'Курьер = 4.13 ₽');
  near(fbsDropoffAcceptanceFee('pickup_point'), 10, 0.01, 'ПВЗ/ППЗ = 10 ₽');
  near(fbsDropoffAcceptanceFee('utk'), 17, 0.01, 'УТК = 17 ₽');
  near(fbsDropoffAcceptanceFee('gorbushka'), 2, 0.01, 'Горбушка = 2 ₽');
  const sc = calculateOzon({ ...BASE, mode: 'fbs', volumeL: 1, fbsDropoffPoint: 'sorting_center' });
  const utk = calculateOzon({ ...BASE, mode: 'fbs', volumeL: 1, fbsDropoffPoint: 'utk' });
  near(sc.logistics, 65, 0.01, 'FBS СЦ, выкуп 100% → 65 ₽ (тариф FBS 1 л), приёмка 0');
  near(utk.logistics, 82, 0.01, 'FBS УТК → 65 + 17 = 82 ₽');
  const utk80 = calculateOzon({ ...BASE, mode: 'fbs', volumeL: 1, fbsDropoffPoint: 'utk', returnsPct: 20, cancelPct: 0 });
  near(utk80.logistics, 82 / 0.8, 0.01, 'Приёмка FBS делится на выкуп (начисляется на заказ)');
}

console.log('\n# Микро: скорость отгрузки FBS — две сетки, скидка вместо надбавки');
{
  near(fbsShipmentSpeedCommissionPp('sorting_center', 'le12h'), -3, 0.001, 'СЦ ≤12 ч → −3 п.п.');
  near(fbsShipmentSpeedCommissionPp('sorting_center', 'h12_24'), -2, 0.001, 'СЦ 12–24 ч → −2 п.п.');
  near(fbsShipmentSpeedCommissionPp('sorting_center', 'h24_36'), 0, 0.001, 'СЦ 24–36 ч → 0');
  near(fbsShipmentSpeedCommissionPp('sorting_center', 'h36_48'), 1, 0.001, 'СЦ 36–48 ч → +1 п.п.');
  near(fbsShipmentSpeedCommissionPp('sorting_center', 'gt48h'), 2, 0.001, 'СЦ >48 ч → +2 п.п.');
  near(fbsShipmentSpeedCommissionPp('pickup_point', 'in_slot'), -2, 0.001, 'ПВЗ в слот → −2 п.п.');
  near(fbsShipmentSpeedCommissionPp('pickup_point', 'h0_24'), 0, 0.001, 'ПВЗ 24 ч после слота → 0');
  near(fbsShipmentSpeedCommissionPp('pickup_point', 'h24_48'), 1, 0.001, 'ПВЗ 24–48 ч → +1 п.п.');
  near(fbsShipmentSpeedCommissionPp('utk', 'gt48h'), 2, 0.001, 'УТК считается по сетке ПВЗ');
  // Legacy-ключи сохранённых конфигов
  near(fbsShipmentSpeedCommissionPp('sorting_center', 'fast'), -2, 0.001, 'legacy fast → −2 п.п. (было +2)');
  near(fbsShipmentSpeedCommissionPp('sorting_center', 'standard'), 0, 0.001, 'legacy standard → 0');
  near(fbsShipmentSpeedCommissionPp('sorting_center', 'slow'), 2, 0.001, 'legacy slow → +2 п.п.');
  const fast = calculateOzon({ ...BASE, mode: 'fbs', commissionPct: 15, fbsShipmentSpeed: 'le12h' });
  const slow = calculateOzon({ ...BASE, mode: 'fbs', commissionPct: 15, fbsShipmentSpeed: 'gt48h' });
  near(fast.commission, 120, 0.01, 'FBS ≤12 ч: (15 − 3)% × 1000 = 120');
  near(slow.commission, 170, 0.01, 'FBS >48 ч: (15 + 2)% × 1000 = 170');
  const fbo = calculateOzon({ ...BASE, mode: 'fbo', commissionPct: 15, fbsShipmentSpeed: 'le12h' });
  near(fbo.commission, 150, 0.01, 'FBO: скорость отгрузки FBS не влияет');
}

console.log('\n# Микро: скидка за локальность (3 п.п. к комиссии) и исключения');
{
  const off = calculateOzon({ ...BASE, commissionPct: 20, localityDiscount: false });
  const on = calculateOzon({ ...BASE, commissionPct: 20, localityDiscount: true });
  near(off.commission, 200, 0.01, 'Без флага локальности — 20%');
  near(on.commission, 170, 0.01, 'Со скидкой за локальность — 17% = 170');
  const excluded = calculateOzon({ ...BASE, commissionPct: 20, localityDiscount: true, cluster: 'moscow_region' });
  near(excluded.commission, 200, 0.01, 'Москва/МО+ДВ — скидка не действует');
  const spb = calculateOzon({ ...BASE, commissionPct: 20, localityDiscount: true, cluster: 'spb_szo' });
  near(spb.commission, 200, 0.01, 'СПб+СЗО — скидка не действует');
  const half = calculateOzon({
    ...BASE, mode: 'fbs', commissionPct: 20, localityDiscount: true,
    fbsClusters: [
      { key: 'moscow_region', sharePct: 50 },
      { key: 'kazan', sharePct: 50 },
    ],
  });
  near(half.commission, 185, 0.01, 'Multi-cluster: 50% исключённых → скидка 1.5 п.п. → 18.5%');
  // Регрессия: раньше флаг highVolumeDiscount снижал ЛОГИСТИКУ на 15% —
  // такой скидки у Ozon нет; теперь этот флаг не влияет на расчёт.
  const legacyFlag = calculateOzon({ ...BASE, highVolumeDiscount: true });
  near(legacyFlag.logistics, 50, 0.01, 'highVolumeDiscount больше не трогает логистику (было 42.50)');
}

console.log('\n# Микро: отсрочка выплат — скидка к комиссии 0.45 п.п. / 14 дней');
{
  near(paymentDeferralDiscountPp(0), 0, 0.001, '0 дней → 0 п.п.');
  near(paymentDeferralDiscountPp(14), 0.45, 0.001, '14 дней → 0.45 п.п.');
  near(paymentDeferralDiscountPp(28), 0.9, 0.001, '28 дней → 0.90 п.п.');
  near(paymentDeferralDiscountPp(42), 1.35, 0.001, '42 дня → 1.35 п.п.');
  near(paymentDeferralDiscountPp(56), 1.8, 0.001, '56 дней → 1.80 п.п.');
  near(paymentDeferralDiscountPp(84), 2.7, 0.001, '84 дня → 2.70 п.п.');
  near(paymentDeferralDiscountPp(112), 3.6, 0.001, '112 дней → 3.60 п.п.');
  near(paymentDeferralDiscountPp(168), 5.4, 0.001, '168 дней → 5.40 п.п.');
  near(paymentDeferralDiscountPp(1000), 5.4, 0.001, 'Больше 168 дней — потолок 5.40 п.п.');
  const r = calculateOzon({ ...BASE, commissionPct: 20, paymentDeferralDays: 168 });
  near(r.commission, 146, 0.01, 'Комиссия (20 − 5.4)% × 1000 = 146');
}

console.log('\n# Микро: УСН Д-Р считает базу от реальных расходов + минимальный налог 1%');
{
  // Расходы: комиссия 200 + логистика 50 + себестоимость 300 = 550.
  const dr = calculateOzon({
    ...BASE, commissionPct: 20, cost: 300, taxMode: 'usn_income_minus', taxRatePct: 15,
  });
  near(dr.tax, 67.5, 0.01, 'УСН Д-Р: 15% × (1000 − 550) = 67.50 (было 150 — 15% с выручки)');
  // Дополнительные документально подтверждённые расходы: 5000/мес / 50 продаж.
  const withDocs = calculateOzon({
    ...BASE, commissionPct: 20, cost: 300, salesPerMonth: 50, documentedExpensesMonth: 5000,
    taxMode: 'usn_income_minus', taxRatePct: 15,
  });
  near(withDocs.tax, 52.5, 0.01, 'Доп. расходы 100 ₽/ед → 15% × (1000 − 650) = 52.50');
  // Убыточный товар → минимальный налог 1% от выручки.
  const minTax = calculateOzon({
    ...BASE, commissionPct: 20, cost: 900, taxMode: 'usn_income_minus', taxRatePct: 15,
  });
  near(minTax.tax, 10, 0.01, 'Расходы > доходов → минимальный налог 1% = 10');
  const usn6 = calculateOzon({ ...BASE, taxMode: 'usn_income', taxRatePct: 6, vatPct: 20 });
  near(usn6.tax, 50, 0.01, 'УСН Доходы: база — выручка без НДС (1000 − 166.67) × 6% = 50');
}

console.log('\n# Микро: автокомиссия по ценовым порогам (сетка с 28.08.2026)');
{
  expect(autoCommissionPct(100, 25) === 20, '≤100 ₽ → 20% (было 14%)');
  expect(autoCommissionPct(200, 25) === 26, '101–300 ₽ → 26% (было 20%)');
  expect(autoCommissionPct(1000, 25) === 25, '>300 ₽ → категорийная ручная ставка');
  const auto = calculateOzon({ ...BASE, price: 200, commissionMode: 'auto', commissionPct: 25 });
  near(auto.commission, 52, 0.01, 'commissionMode=auto, 200 ₽ → 26% = 52');
  const manual = calculateOzon({ ...BASE, price: 200, commissionMode: 'manual', commissionPct: 25 });
  near(manual.commission, 50, 0.01, 'commissionMode=manual → 25% = 50');
  expect(OZON_DEFAULT_INPUTS.commissionMode === 'manual', 'Дефолтный режим комиссии — manual');
}

console.log('\n# Ozon: multi-cluster логистика — weighted-sum');
{
  const moscowOnly = calculateOzon({
    ...BASE, mode: 'fbs', volumeL: 1,
    fbsClusters: [{ key: 'moscow_region', sharePct: 100 }],
  });
  const farEastOnly = calculateOzon({
    ...BASE, mode: 'fbs', volumeL: 1,
    fbsClusters: [{ key: 'far_east', sharePct: 100 }],
  });
  const split = calculateOzon({
    ...BASE, mode: 'fbs', volumeL: 1,
    fbsClusters: [
      { key: 'moscow_region', sharePct: 50 },
      { key: 'far_east', sharePct: 50 },
    ],
  });
  expect(farEastOnly.logistics > moscowOnly.logistics, 'Дальний Восток (non-local) дороже Москвы');
  near(split.logistics, (moscowOnly.logistics + farEastOnly.logistics) / 2, 0.5, '50/50 Москва+ДВ ≈ среднее');
  near(farEastOnly.logistics, 81.25, 0.01, 'ДВ: 65 × 1.25 = 81.25');
}

console.log('\n# Ozon: базовая маржа/ROI и версия тарифов');
{
  const r = calculateOzon({
    mode: 'fbo', price: 1000, discountPct: 10, cost: 300, volumeL: 1, isLocalCluster: true,
    commissionMode: 'manual', commissionPct: 15, acquiringPct: 1.5,
    deliveryPvzPct: 4, deliveryPvzCap: 25, returnProcessing: 25, drrPct: 5,
    taxMode: 'usn_income', taxRatePct: 6, salesPerMonth: 50, batchSize: 100, stock: 80,
    overheadPerUnit: 0,
  });
  expect(r.buyerPrice === 900, 'buyerPrice = 900 (1000 − 10%)', `actual=${r.buyerPrice}`);
  expect(r.commission === 135, 'commission = 135 (15% от 900)', `actual=${r.commission}`);
  expect(Number.isFinite(r.roiPct), 'ROI — finite число');
  expect(r.moneyInStock === 24000, 'moneyInStock = 300 × 80 = 24000', `actual=${r.moneyInStock}`);
  expect(r.tariffVersion === 'ozon_2026_08_30', 'tariffVersion = ozon_2026_08_30', `actual=${r.tariffVersion}`);
}

console.log('\n# Yandex: sanity (полный набор — scripts/test-yandex-calc.ts)');
{
  const r = calculateYandex({
    mode: 'fby', sellerPrice: 2500, coinvestPct: 0,
    lengthCm: 30, widthCm: 20, heightCm: 5, cost: 800,
    commissionPct: 46.5, acquiringPct: 2.5, specialTariff: 'none',
    fbsFastShipDiscountPct: 0, buyoutPct: 85, storagePerUnit: 0,
    drrPct: 0, overheadPerUnit: 0,
    taxMode: 'usn_income', taxRatePct: 6, vatPct: 0,
    salesPerMonth: 0, stock: 0,
  });
  near(r.profitPerUnit, 81.94, 0.01, 'Эталонный кейс ЯМ: прибыль 81.94 ₽');
  expect(r.tariffVersion === 'yandex_2026_07_01', 'tariffVersion = yandex_2026_07_01', `actual=${r.tariffVersion}`);
}

console.log('\n# Store formula: маржа и циклы');
{
  const result = evalRowFormulas(
    { cost: 100, packaging: 10, delivery: 5, priceRetail: 200, salesPerMonth: 50 },
    {
      marginRetail: '=priceRetail - cost - packaging - delivery',
      revenueMonth: '=priceRetail * salesPerMonth',
      profitMonth: '=marginRetail * salesPerMonth',
    },
  );
  expect(result.marginRetail === 85, `marginRetail = 200 - 100 - 10 - 5 = 85`, `actual=${result.marginRetail}`);
  expect(result.revenueMonth === 10000, `revenueMonth = 200*50 = 10000`, `actual=${result.revenueMonth}`);
  expect(result.profitMonth === 4250, `profitMonth = marginRetail * salesPerMonth = 85*50 = 4250`, `actual=${result.profitMonth}`);
}
{
  const result = evalRowFormulas(
    { a: 1 },
    {
      x: '=y + 1',
      y: '=x + 1',
    },
  );
  expect(result.x === '#CYCLE' && result.y === '#CYCLE', 'Цикл x↔y → #CYCLE для обоих');
}
{
  const v = evalSingleFormula('=cost * 1.2', { cost: 100 });
  near(typeof v === 'number' ? v : NaN, 120, 0.01, 'evalSingleFormula: cost * 1.2');
}

console.log('\n# XLSX парсер');
{
  const candidates = [
    process.argv[2],
    path.join(process.cwd(), 'Шаблон для обновления цен_18.05.26.xlsx'),
    path.join(process.cwd(), 'Цены товаров_14.05.2026.xlsx'),
  ].filter(Boolean) as string[];
  const xlsxPath = candidates.find((p) => fs.existsSync(p));
  if (!xlsxPath) {
    console.log(`  SKIP  XLSX (нет ни одного шаблона: ${candidates.join(', ')})`);
  } else {
    const buf = fs.readFileSync(xlsxPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const result = parseOzonPriceTemplate(ab);
    expect(result.totalRows > 0, `XLSX: распознано строк (${result.totalRows} > 0) — ${path.basename(xlsxPath)}`);
    expect(
      Object.keys(result.recognizedColumns).length >= 3,
      `XLSX: распознано колонок ≥ 3 (${Object.keys(result.recognizedColumns).length})`,
    );
    expect(
      result.warnings.every((w) => typeof w === 'string'),
      'XLSX: warnings — массив строк',
    );
    // Регрессия: «Цена» больше НЕ должна биндиться к «Цена до скидки».
    if (result.recognizedColumns.price) {
      const priceHeader = String(result.recognizedColumns.price);
      expect(
        priceHeader.toLowerCase().includes('со скидкой') ||
          priceHeader.toLowerCase().includes('текущая цена') ||
          priceHeader.toLowerCase().includes('новая цена') ||
          priceHeader.toLowerCase().includes('действующая'),
        `XLSX: price -> "${priceHeader}" — это «текущая/новая цена», не «цена до скидки»`,
      );
    }
    if (result.rows.length > 0) {
      const sample = result.rows[0];
      console.log(
        `  INFO  первая строка: article="${sample.article}", name="${sample.name.slice(0, 40)}", price=${sample.price}, oldPrice=${sample.oldPrice}, cost=${sample.cost}, vat=${sample.vatPct}, fbo=${sample.fboCommissionPct}, fbs=${sample.fbsCommissionPct}`,
      );
      // Хотя бы одна строка должна иметь price > 0 в реалистичном шаблоне.
      const anyPrice = result.rows.some((r) => r.price > 0);
      expect(anyPrice, 'XLSX: хотя бы у одной строки price > 0');
    }
  }
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
