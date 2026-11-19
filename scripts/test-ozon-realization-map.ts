// PURPOSE: Оффлайн smoke-тесты маппинга отчёта о реализации Ozon v2
// (`mapRealizationRow`) — деньги, поэтому фиксируем арифметику на РЕАЛЬНЫХ
// строках, снятых с прода (июль 2026), а не на выдуманных числах.
// Запуск: pnpm tsx scripts/test-ozon-realization-map.ts
//
// Живая сверка с API и с `ozon_transactions` — в scripts/test-ozon-realization.ts
// (нужны креды и БД). Здесь только чистая функция, без сети.

import {
  MISMATCH_TOLERANCE_RUB,
  mapRealizationRow,
} from '../src/lib/marketplaces/ozon/realization-map';
import type { RealizationRow } from '../src/lib/marketplaces/ozon/types';

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

/** Строка 1 отчёта за 2026-07, аккаунт «Главный магазин» (реализация без возврата). */
const REAL_DELIVERY: RealizationRow = {
  rowNumber: 1,
  item: {
    name: 'Товар A 60 шт по 10мг',
    offer_id: 'rm-sesame-60-10',
    barcode: 'OZN1215255822',
    sku: 1215255823,
  },
  seller_price_per_instance: 6487,
  delivery_commission: {
    price_per_instance: 3706.52,
    quantity: 1,
    amount: 3706.52,
    compensation: 0,
    commission: 0,
    bonus: 2743.41,
    standard_fee: 2659.67,
    total: 3827.33,
    stars: 0,
    bank_coinvestment: 37.07,
    pick_up_point_coinvestment: 0,
  },
  return_commission: null,
  commission_ratio: 0.41,
};

/** Строка 237 того же отчёта: чистый возврат (delivery_commission = null). */
const REAL_RETURN: RealizationRow = {
  rowNumber: 237,
  item: {
    name: 'Товар B, 60 капсул по 50мг',
    offer_id: 'rm-ptero-60-50',
    barcode: 'OZN1268676875',
    sku: 1268676875,
  },
  seller_price_per_instance: 2576,
  delivery_commission: null,
  return_commission: {
    price_per_instance: 1235.24,
    quantity: 1,
    amount: 1235.24,
    compensation: 0,
    commission: 0,
    bonus: 1328.41,
    standard_fee: 875.84,
    total: 1700.16,
    stars: 0,
    bank_coinvestment: 12.35,
    pick_up_point_coinvestment: 0,
  },
  commission_ratio: 0.34,
};

console.log('=== Реализация без возврата (реальная строка прода) ===');
{
  const p = mapRealizationRow(REAL_DELIVERY);
  // gross = «итого к начислению» + вознаграждение = 3827.33 + 2659.67 = 6487.00,
  // ровно seller_price_per_instance × quantity.
  expect(p.grossKopecks === 648_700, 'gross = 6487.00 ₽ (цена продавца × 1)', String(p.grossKopecks));
  expect(p.commissionKopecks === 265_967, 'commission = standard_fee 2659.67 ₽', String(p.commissionKopecks));
  expect(p.netKopecks === 382_733, 'net = total 3827.33 ₽', String(p.netKopecks));
  expect(p.qty === 1, 'qty = 1');
  expect(p.sku === '1215255823', 'sku строкой');
  expect(p.offerId === 'rm-sesame-60-10', 'offer_id');
  expect(p.residualRub < MISMATCH_TOLERANCE_RUB, 'сходится с суммой компонентов выплат', String(p.residualRub));
  // commission_ratio = standard_fee / (цена продавца × qty): 2659.67 / 6487 = 0.41.
  expect(
    Math.abs(p.commissionKopecks / p.grossKopecks - 0.41) < 0.001,
    'доля вознаграждения = commission_ratio 0.41',
  );
}

console.log('\n=== Чистый возврат: уменьшает и qty, и выручку, и вознаграждение ===');
{
  const p = mapRealizationRow(REAL_RETURN);
  expect(p.qty === -1, 'qty = -1');
  expect(p.grossKopecks === -257_600, 'gross = -2576.00 ₽ (вся цена продавца назад)', String(p.grossKopecks));
  expect(p.commissionKopecks === -87_584, 'commission = -875.84 ₽ (Ozon возвращает вознаграждение)');
  expect(p.netKopecks === -170_016, 'net = -1700.16 ₽');
  expect(p.residualRub < MISMATCH_TOLERANCE_RUB, 'возвратный блок тоже сходится');
}

console.log('\n=== Оба блока в одной строке: пишется НЕТТО ===');
{
  const both: RealizationRow = {
    ...REAL_DELIVERY,
    delivery_commission: {
      ...REAL_DELIVERY.delivery_commission!,
      quantity: 3,
      amount: 11_119.56,
      bonus: 8230.23,
      bank_coinvestment: 111.21,
      standard_fee: 7979.01,
      total: 11_481.99,
    },
    return_commission: REAL_RETURN.return_commission,
  };
  const p = mapRealizationRow(both);
  expect(p.qty === 2, 'qty = 3 - 1');
  // (11481.99 + 7979.01) - (1700.16 + 875.84) = 19461.00 - 2576.00 = 16885.00
  expect(p.grossKopecks === 1_688_500, 'gross = нетто 16885.00 ₽', String(p.grossKopecks));
  expect(p.commissionKopecks === 710_317, 'commission = 7979.01 - 875.84 = 7103.17 ₽', String(p.commissionKopecks));
  expect(p.netKopecks === 978_183, 'net = 11481.99 - 1700.16 = 9781.83 ₽', String(p.netKopecks));
  expect(p.residualRub < MISMATCH_TOLERANCE_RUB, 'нетто сходится с компонентами');
}

console.log('\n=== Новых полей выплат нет в ответе: не NaN и не тихий ноль ===');
{
  const lean: RealizationRow = {
    item: { sku: '777', offer_id: 'a-1' },
    seller_price_per_instance: 1000,
    delivery_commission: {
      price_per_instance: 1000,
      quantity: 1,
      amount: 1000,
      bonus: 0,
      commission: 0,
      standard_fee: 250,
      total: 750,
      // compensation / stars / bank_coinvestment / pick_up_point_coinvestment отсутствуют
    },
    return_commission: null,
  };
  const p = mapRealizationRow(lean);
  expect(p.grossKopecks === 100_000, 'gross = 1000.00 ₽ без опциональных полей');
  expect(p.commissionKopecks === 25_000, 'commission = 250.00 ₽');
  expect(p.residualRub === 0, 'residual = 0');
}

console.log('\n=== Ozon добавил невиданный вид выплат: расхождение видно ===');
{
  const drifted: RealizationRow = {
    item: { sku: '888' },
    seller_price_per_instance: 1000,
    delivery_commission: {
      price_per_instance: 1000,
      quantity: 1,
      amount: 1000,
      bonus: 0,
      commission: 0,
      standard_fee: 250,
      // Новая выплата 500 ₽ уже внутри total, но в известных нам компонентах её нет.
      total: 1250,
    },
    return_commission: null,
  };
  const p = mapRealizationRow(drifted);
  expect(p.grossKopecks === 150_000, 'gross берётся от total → 1500.00 ₽, новая выплата не потеряна');
  expect(
    p.residualRub > MISMATCH_TOLERANCE_RUB,
    'residual > порога → стейдж отдаст warning',
    String(p.residualRub),
  );
}

console.log('\n=== Пустая строка (ни реализации, ни возврата) ===');
{
  const empty: RealizationRow = {
    item: { sku: '999' },
    seller_price_per_instance: 0,
    delivery_commission: null,
    return_commission: null,
  };
  const p = mapRealizationRow(empty);
  expect(p.qty === 0 && p.grossKopecks === 0 && p.commissionKopecks === 0, 'нули, без NaN');
  expect(p.offerId === null, 'offerId = null когда offer_id нет');
}

console.log(`\n\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
