// PURPOSE: Smoke-тесты юнит-экономики и XLSX-парсера Ozon.
// Запуск: pnpm tsx scripts/test-unit-economics.ts [path-to-xlsx]
import fs from 'node:fs';
import path from 'node:path';
import { calculateOzon } from '../src/lib/unit-economics/ozon/calculate';
import { calculateYandex } from '../src/lib/unit-economics/yandex/calculate';
import { parseOzonPriceTemplate } from '../src/lib/unit-economics/import/ozon-price-template';

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

console.log('\n# Ozon: автокомиссия по диапазонам');
{
  // <=100 → 14%
  const r = calculateOzon({
    mode: 'fbo',
    price: 100,
    discountPct: 0,
    cost: 30,
    volumeL: 0.5,
    isLocalCluster: true,
    commissionMode: 'auto',
    commissionPct: 25,
    acquiringPct: 0,
    deliveryPvzPct: 0,
    deliveryPvzCap: 0,
    buyoutPct: 100,
    returnProcessing: 0,
    drrPct: 0,
    taxMode: 'none',
    taxRatePct: 0,
    salesPerMonth: 0,
    batchSize: 0,
    stock: 0,
    overheadPerUnit: 0,
  });
  near(r.commission, 14, 0.5, 'price=100 → commission≈14₽ (14%)');
}
{
  // 200 → 20%
  const r = calculateOzon({
    mode: 'fbo',
    price: 200,
    discountPct: 0,
    cost: 30,
    volumeL: 0.5,
    isLocalCluster: true,
    commissionMode: 'auto',
    commissionPct: 25,
    acquiringPct: 0,
    deliveryPvzPct: 0,
    deliveryPvzCap: 0,
    buyoutPct: 100,
    returnProcessing: 0,
    drrPct: 0,
    taxMode: 'none',
    taxRatePct: 0,
    salesPerMonth: 0,
    batchSize: 0,
    stock: 0,
    overheadPerUnit: 0,
  });
  near(r.commission, 40, 0.5, 'price=200 → commission≈40₽ (20%)');
}
{
  // 1000 → manual 16%
  const r = calculateOzon({
    mode: 'fbo',
    price: 1000,
    discountPct: 0,
    cost: 200,
    volumeL: 1,
    isLocalCluster: true,
    commissionMode: 'auto',
    commissionPct: 16,
    acquiringPct: 0,
    deliveryPvzPct: 0,
    deliveryPvzCap: 0,
    buyoutPct: 100,
    returnProcessing: 0,
    drrPct: 0,
    taxMode: 'none',
    taxRatePct: 0,
    salesPerMonth: 0,
    batchSize: 0,
    stock: 0,
    overheadPerUnit: 0,
  });
  near(r.commission, 160, 0.5, 'price=1000 → commission≈160₽ (16%)');
}

console.log('\n# Ozon: маржа и ROI');
{
  const r = calculateOzon({
    mode: 'fbo',
    price: 1000,
    discountPct: 10,
    cost: 300,
    volumeL: 1,
    isLocalCluster: true,
    commissionMode: 'manual',
    commissionPct: 15,
    acquiringPct: 1.5,
    deliveryPvzPct: 4,
    deliveryPvzCap: 25,
    buyoutPct: 90,
    returnProcessing: 25,
    drrPct: 5,
    taxMode: 'usn_income',
    taxRatePct: 6,
    salesPerMonth: 50,
    batchSize: 100,
    stock: 80,
    overheadPerUnit: 0,
  });
  expect(r.buyerPrice === 900, `buyerPrice=900 (1000 - 10%)`, `actual=${r.buyerPrice}`);
  expect(r.commission === 135, `commission=135 (15% от 900)`, `actual=${r.commission}`);
  expect(r.profitPerUnit > 0 || r.profitPerUnit < 0, 'profitPerUnit рассчитан');
  expect(typeof r.roiPct === 'number' && Number.isFinite(r.roiPct), 'ROI — finite число');
  expect(r.tariffVersion === 'ozon_2026_04_07', 'tariffVersion проставлена');
}

console.log('\n# Ozon: налоги (УСН Доходы vs Доходы-Расходы)');
{
  const usnIncome = calculateOzon({
    mode: 'fbo', price: 1000, discountPct: 0, cost: 200, volumeL: 1, isLocalCluster: true,
    commissionMode: 'manual', commissionPct: 15, acquiringPct: 0, deliveryPvzPct: 0, deliveryPvzCap: 0,
    buyoutPct: 100, returnProcessing: 0, drrPct: 0,
    taxMode: 'usn_income', taxRatePct: 6, salesPerMonth: 0, batchSize: 0, stock: 0, overheadPerUnit: 0,
  });
  const usnDR = calculateOzon({
    mode: 'fbo', price: 1000, discountPct: 0, cost: 200, volumeL: 1, isLocalCluster: true,
    commissionMode: 'manual', commissionPct: 15, acquiringPct: 0, deliveryPvzPct: 0, deliveryPvzCap: 0,
    buyoutPct: 100, returnProcessing: 0, drrPct: 0, taxDeductExpenses: true,
    taxMode: 'usn_income_minus', taxRatePct: 15, salesPerMonth: 0, batchSize: 0, stock: 0, overheadPerUnit: 0,
  });
  near(usnIncome.tax, 60, 0.1, 'УСН Доходы 6% от 1000 = 60');
  expect(usnDR.tax >= 0 && usnDR.tax < 200, 'УСН Д-Р: tax вычитает расходы (меньше чем при ОСНО на полную цену)');
}

console.log('\n# Yandex: customerPrice + спецтариф');
{
  const r = calculateYandex({
    mode: 'fby', sellerPrice: 1000, coinvestPct: 5,
    cost: 200, lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 0.5,
    commissionPct: 7, acquiringPct: 1.5, specialTariff: 'showcase',
    fbsFastShipDiscountPct: 0, buyoutPct: 100, storagePerUnit: 0,
    drrPct: 0, overheadPerUnit: 0,
    taxMode: 'usn_income', taxRatePct: 6,
    salesPerMonth: 0, batchSize: 0, stock: 0,
  });
  near(r.customerPrice, 950, 0.01, 'customerPrice = 1000 * (1 - 5%) = 950');
  near(r.commission, 950 * 0.12, 1, 'commission = 7% базовых + 5% витрины = 12%');
  expect(r.volume === 1, `volume = ceil(10*10*10/1000) = 1`, `actual=${r.volume}`);
  expect(r.tariffVersion === 'yandex_2026_04_01', 'tariffVersion проставлена');
}

console.log('\n# Yandex: Fixed tariff (price<=300, volume<=5)');
{
  const r = calculateYandex({
    mode: 'fby', sellerPrice: 200, coinvestPct: 0,
    cost: 50, lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 0.2,
    commissionPct: 7, acquiringPct: 1.5, specialTariff: 'none',
    fbsFastShipDiscountPct: 0, buyoutPct: 100, storagePerUnit: 0,
    drrPct: 0, overheadPerUnit: 0,
    taxMode: 'none', taxRatePct: 0,
    salesPerMonth: 0, batchSize: 0, stock: 0,
  });
  expect(r.fulfillment === 25, `Fixed fulfillment = 25 (volume=1, price=200)`, `actual=${r.fulfillment}`);
  expect(r.middleMile === 0, 'middleMile = 0 при Fixed');
}

console.log('\n# XLSX парсер');
{
  const xlsxPath =
    process.argv[2] ?? path.join(process.cwd(), 'Цены товаров_14.05.2026.xlsx');
  if (!fs.existsSync(xlsxPath)) {
    console.log(`  SKIP  XLSX (нет файла ${xlsxPath})`);
  } else {
    const buf = fs.readFileSync(xlsxPath);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const result = parseOzonPriceTemplate(ab);
    expect(result.totalRows > 0, `XLSX: распознано строк (${result.totalRows} > 0)`);
    expect(
      Object.keys(result.recognizedColumns).length >= 3,
      `XLSX: распознано колонок ≥ 3 (${Object.keys(result.recognizedColumns).length})`,
    );
    expect(
      result.warnings.every((w) => typeof w === 'string'),
      'XLSX: warnings — массив строк',
    );
    if (result.rows.length > 0) {
      const sample = result.rows[0];
      console.log(`  INFO  первая строка: article="${sample.article}", name="${sample.name}", stockMP=${sample.stockMarketplace}`);
    }
  }
}

console.log(`\nИтого: ${passed} PASS, ${failed} FAIL`);
process.exit(failed > 0 ? 1 : 0);
