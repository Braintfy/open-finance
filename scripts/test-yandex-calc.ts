// PURPOSE: Smoke-тесты калькулятора юнит-экономики Яндекс Маркет.
// Эталонные кейсы + микротесты на каждую статью тарифов yandex_2026_07_01.
// Запуск: pnpm tsx scripts/test-yandex-calc.ts
import { calculateYandex, YANDEX_DEFAULT_INPUTS } from '../src/lib/unit-economics/yandex/calculate';
import type { YandexInputs } from '../src/lib/unit-economics/types';
import {
  middleMileCost,
  orderProcessingCost,
  specialTariffPct,
} from '../src/lib/unit-economics/yandex/tariffs-2026-07-01';

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
  expect(
    Math.abs(actual - expected) <= eps,
    name,
    `actual=${actual.toFixed(2)} expected=${expected.toFixed(2)} eps=${eps}`,
  );
}

/** База: всё «выключено», чтобы каждый микротест проверял ровно одну статью. */
const BASE: Partial<YandexInputs> = {
  mode: 'fby',
  sellerPrice: 1000,
  coinvestPct: 0,
  lengthCm: 10,
  widthCm: 10,
  heightCm: 10,
  cost: 0,
  commissionPct: 0,
  acquiringPct: 0,
  specialTariff: 'none',
  fbsFastShipDiscountPct: 0,
  buyoutPct: 100,
  storagePerUnit: 0,
  returnStorageDays: 0,
  drrPct: 0,
  overheadPerUnit: 0,
  taxMode: 'none',
  taxRatePct: 0,
  vatPct: 0,
  salesPerMonth: 0,
  stock: 0,
};

console.log('\n# ЭТАЛОН: 2500 ₽ / себест. 800 ₽ / 30x20x5 / комиссия 46.5% / FBY / выкуп 85%');
{
  const r = calculateYandex({
    mode: 'fby',
    sellerPrice: 2500,
    coinvestPct: 0,
    lengthCm: 30,
    widthCm: 20,
    heightCm: 5,
    cost: 800,
    commissionPct: 46.5,
    acquiringPct: 2.5, // «перевод платежей», середина диапазона 1.6–3.3%
    specialTariff: 'none',
    fbsFastShipDiscountPct: 0,
    buyoutPct: 85,
    storagePerUnit: 0,
    returnStorageDays: 0,
    drrPct: 0,
    overheadPerUnit: 0,
    taxMode: 'usn_income',
    taxRatePct: 6,
    vatPct: 0,
    salesPerMonth: 0,
    stock: 0,
  });
  expect(r.volume === 3, 'volume = ceil(30*20*5/1000) = 3', `actual=${r.volume}`);
  near(r.commission, 1162.5, 0.01, 'Комиссия 46.5% от 2500 = 1162.50');
  near(r.acquiring, 62.62, 0.01, 'Платежи = 2.5% × 2500 + 0.12 = 62.62');
  near(r.lastMile, 125, 0.01, 'Последняя миля = 5% от 2500 = 125 (в коридоре 50..500)');
  near(r.middleMile, 98, 0.01, 'Средняя миля 3 л = 80 + 2×9 = 98');
  near(r.orderProcessing, 0, 0.01, 'Обработка заказа FBY = 0');
  near(r.returns, 19.94, 0.01, 'Возвраты = (0.15/0.85) × (98 + 15) = 19.94');
  near(r.tax, 150, 0.01, 'УСН Доходы 6% от 2500 = 150');
  near(r.profitPerUnit, 81.94, 0.01, 'ЭТАЛОН: прибыль = +81.94 ₽');
  near(r.marginSellerPct, 3.28, 0.02, 'ЭТАЛОН: маржа ≈ 3.3%');
  // Регрессия старого движка (yandex_2026_04_01): комиссия 46.5% + «витрина» не
  // применялась, зато была статья fulfillment(3 л)=50, средняя миля FBY = 0,
  // возвратов не было вовсе, НДС начислялся сверху. Прибыль выходила
  // 2500 − (1162.5 + 37.5 + 125 + 0 + 50 + 800) − 150 = +175.00 ₽ (маржа 7.0%) —
  // завышение на 93 ₽ на единицу.
}

console.log('\n# Выручка = цена продавца, соинвест — только цена покупателя и налог');
{
  const noCoinvest = calculateYandex({ ...BASE, commissionPct: 10, taxMode: 'usn_income', taxRatePct: 6 });
  const withCoinvest = calculateYandex({
    ...BASE,
    commissionPct: 10,
    coinvestPct: 10,
    taxMode: 'usn_income',
    taxRatePct: 6,
  });
  near(withCoinvest.revenue, 1000, 0.01, 'revenue = sellerPrice = 1000 (соинвест не уменьшает выручку)');
  near(withCoinvest.customerPrice, 900, 0.01, 'customerPrice = 1000 × (1 − 10%) = 900');
  near(withCoinvest.commission, 100, 0.01, 'Комиссия считается от цены продавца: 10% × 1000 = 100');
  near(withCoinvest.tax, 54, 0.01, 'Налог считается от цены покупателя: 6% × 900 = 54');
  near(noCoinvest.tax, 60, 0.01, 'Без соинвеста налог = 6% × 1000 = 60');
  // Регрессия: раньше customerPrice был и выручкой, и базой ВСЕХ расходов,
  // поэтому комиссия падала до 90 ₽, а прибыль систематически занижалась.
}

console.log('\n# Спецтариф ЗАМЕНЯЕТ комиссию (а не суммируется)');
{
  const manual = calculateYandex({ ...BASE, commissionPct: 40 });
  const subFby = calculateYandex({ ...BASE, commissionPct: 40, specialTariff: 'subscription_fby' });
  const subFbsOnFby = calculateYandex({
    ...BASE,
    commissionPct: 40,
    specialTariff: 'subscription_fbs',
  });
  const showcase = calculateYandex({ ...BASE, commissionPct: 40, specialTariff: 'showcase' });
  const subExpress = calculateYandex({
    ...BASE,
    mode: 'express',
    commissionPct: 40,
    specialTariff: 'subscription_express',
  });
  near(manual.commission, 400, 0.01, 'Без спецтарифа — ручные 40% = 400');
  near(subFby.commission, 90, 0.01, 'Подписка FBY 9% ЗАМЕНЯЕТ 40% → 90 (раньше было 49% = 490)');
  near(subFbsOnFby.commission, 400, 0.01, 'Подписка FBS на FBY не применяется → 40%');
  near(showcase.commission, 400, 0.01, 'Витрина отменена с 01.07.2026 → ставка не меняется');
  near(subExpress.commission, 90, 0.01, 'Подписка Express 9% на express → 90');
  expect(specialTariffPct('showcase', 'fby') === null, 'specialTariffPct(showcase) = null');
  expect(specialTariffPct('subscription_fby', 'fby') === 9, 'specialTariffPct(subscription_fby, fby) = 9');
}

console.log('\n# Фиксированный тариф — процент, а не 25 ₽');
{
  const fby = calculateYandex({ ...BASE, sellerPrice: 250, commissionPct: 40 });
  const fbs = calculateYandex({ ...BASE, mode: 'fbs', sellerPrice: 250, commissionPct: 40 });
  near(fby.commission, 87.5, 0.01, 'FBY fixed = 35% от 250 = 87.50 (раньше fulfillment = 25 ₽)');
  near(fbs.commission, 105, 0.01, 'FBS fixed = 42% от 250 = 105');
  near(fby.lastMile, 0, 0.01, 'Fixed включает последнюю милю → 0');
  near(fby.middleMile, 0, 0.01, 'Fixed включает среднюю милю → 0');
  near(fby.orderProcessing, 0, 0.01, 'Fixed включает обработку → 0');
}

console.log('\n# Средняя миля — прогрессивная шкала с потолком 5500 ₽');
{
  near(middleMileCost(1, 'fby'), 80, 0.01, '1 л = 80 ₽ (первый литр)');
  near(middleMileCost(3, 'fby'), 98, 0.01, '3 л = 80 + 2×9 = 98');
  near(middleMileCost(30, 'fbs'), 341, 0.01, '30 л = 80 + 29×9 = 341');
  near(middleMileCost(200, 'express'), 1531, 0.01, '200 л = 341 + 170×7 = 1531');
  near(middleMileCost(1000, 'fby'), 5500, 0.01, '1000 л → потолок 5500');
  near(middleMileCost(50, 'dbs'), 0, 0.01, 'DBS — средней мили нет');
  // Регрессия: раньше FBY всегда 0, а FBS/DBS/Express — ступенька 25/60/150.
  const r = calculateYandex({ ...BASE, lengthCm: 100, widthCm: 100, heightCm: 100 });
  near(r.middleMile, 5500, 0.01, 'FBY 1000 л через calculateYandex → 5500 (было 0)');
}

console.log('\n# Обработка заказа вместо «фулфилмента»');
{
  expect(orderProcessingCost('fbs') === 25, 'FBS → 25 ₽');
  expect(orderProcessingCost('fby') === 0, 'FBY → 0 ₽');
  expect(orderProcessingCost('dbs') === 0, 'DBS → 0 ₽');
  const fbs = calculateYandex({ ...BASE, mode: 'fbs' });
  near(fbs.orderProcessing, 25, 0.01, 'calculateYandex FBS → orderProcessing = 25');
  expect(fbs.fulfillment === fbs.orderProcessing, 'fulfillment — алиас orderProcessing');
}

console.log('\n# Возвраты и хранение невыкупа');
{
  const full = calculateYandex({ ...BASE, buyoutPct: 100 });
  const partial = calculateYandex({ ...BASE, buyoutPct: 80 });
  near(full.returns, 0, 0.01, 'Выкуп 100% → возвратов нет');
  // volume=1 → средняя миля 80; (0.2/0.8) × (80 + 15) = 23.75
  near(partial.returns, 23.75, 0.01, 'Выкуп 80% → (0.2/0.8) × (80 + 15) = 23.75');
  const stored = calculateYandex({ ...BASE, buyoutPct: 80, returnStorageDays: 10 });
  // 5 льготных дней → платных 5: (0.2/0.8) × 15 × 5 = 18.75
  near(stored.storage, 18.75, 0.01, 'Хранение невыкупа 10 дней → 5 платных → 18.75');
  const freeDays = calculateYandex({ ...BASE, buyoutPct: 80, returnStorageDays: 5 });
  near(freeDays.storage, 0, 0.01, 'Первые 5 дней хранения невыкупа бесплатны');
}

console.log('\n# Платежи: перевод (%) + приём (0.12 ₽)');
{
  const r = calculateYandex({ ...BASE, acquiringPct: 2.5 });
  near(r.acquiring, 25.12, 0.01, '2.5% × 1000 + 0.12 = 25.12');
  const zero = calculateYandex({ ...BASE, acquiringPct: 0 });
  near(zero.acquiring, 0.12, 0.01, 'Приём платежей 0.12 ₽ берётся всегда');
}

console.log('\n# НДС извлекается из цены, а не начисляется сверху');
{
  const r = calculateYandex({ ...BASE, sellerPrice: 1200, vatPct: 20 });
  near(r.vat, 200, 0.01, 'НДС = 1200 × 20/120 = 200 (раньше 1200 × 20% = 240)');
  const withCoinvest = calculateYandex({ ...BASE, sellerPrice: 1200, coinvestPct: 10, vatPct: 20 });
  near(withCoinvest.vat, 180, 0.01, 'НДС от цены покупателя 1080 × 20/120 = 180');
}

console.log('\n# Налоги: база = цена покупателя без НДС, минимальный налог 1%');
{
  const usn6 = calculateYandex({ ...BASE, sellerPrice: 1200, vatPct: 20, taxMode: 'usn_income', taxRatePct: 6 });
  near(usn6.tax, 60, 0.01, 'УСН Доходы 6% от (1200 − 200 НДС) = 60');
  // Расходы заведомо больше дохода → срабатывает минимальный налог 1%.
  const minTax = calculateYandex({
    ...BASE,
    sellerPrice: 1000,
    cost: 900,
    commissionPct: 40,
    taxMode: 'usn_income_minus',
    taxRatePct: 15,
  });
  near(minTax.tax, 10, 0.01, 'УСН Д-Р: расходы > доходов → минимальный налог 1% = 10');
  // Прибыльный кейс: расходы = комиссия 100 + платежи 0.12 + миля 50 + средняя 80.
  const profitable = calculateYandex({
    ...BASE,
    sellerPrice: 1000,
    cost: 0,
    commissionPct: 10,
    taxMode: 'usn_income_minus',
    taxRatePct: 15,
  });
  const expenses = 100 + 0.12 + 50 + 80;
  near(
    profitable.tax,
    Math.max((1000 - expenses) * 0.15, 10),
    0.02,
    'УСН Д-Р: 15% от (доход − реальные расходы)',
  );
  // Регрессия: раньше taxDeductExpenses по умолчанию false → налог 15%
  // считался с ПОЛНОЙ выручки (150 ₽ вместо ~115.5 ₽).
}

console.log('\n# Дефолты');
{
  expect(YANDEX_DEFAULT_INPUTS.buyoutPct === 85, 'buyoutPct по умолчанию 85 (было 95)');
  expect(YANDEX_DEFAULT_INPUTS.commissionPct === 30, 'commissionPct по умолчанию 30 (было 7)');
  expect(YANDEX_DEFAULT_INPUTS.acquiringPct === 2.5, 'acquiringPct по умолчанию 2.5 (было 1.5)');
  const r = calculateYandex({ sellerPrice: 1000, lengthCm: 10, widthCm: 10, heightCm: 10 });
  expect(r.tariffVersion === 'yandex_2026_07_01', 'tariffVersion = yandex_2026_07_01', `actual=${r.tariffVersion}`);
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
