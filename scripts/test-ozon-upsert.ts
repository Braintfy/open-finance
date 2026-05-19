// PURPOSE: Smoke-тесты для planUnitProductUpsertFromOzon().
// Проверяем что частичные payload'ы (products→prices→stocks) НЕ затирают
// уже загруженные значения через conditional set + sql fallback.
// Запуск: pnpm tsx scripts/test-ozon-upsert.ts

import {
  planUnitProductUpsertFromOzon,
  parseMoneyRu,
} from '../src/lib/marketplaces/ozon/upsert-plan';
import type {
  ProductInfo,
  PricesItem,
  StocksItem,
} from '../src/lib/marketplaces/ozon/types';

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

function makeInfo(over: Partial<ProductInfo> = {}): ProductInfo {
  return {
    id: 12345,
    offer_id: 'SKU-001',
    name: 'Test product',
    visible: true,
    barcode: '4607000000001',
    images: ['https://cdn/img.png'],
    primary_image: ['https://cdn/img.png'],
    weight: 250,
    weight_unit: 'g',
    depth: 200,
    width: 100,
    height: 50,
    dimension_unit: 'mm',
    status: { state: 'price_sent' },
    ...over,
  } as ProductInfo;
}

function makePrices(over: Partial<PricesItem> = {}): PricesItem {
  return {
    offer_id: 'SKU-001',
    product_id: 12345,
    price: { price: '1500', marketing_seller_price: '1450', currency_code: 'RUB' },
    commissions: {
      sales_percent_fbo: 15.5,
      sales_percent_fbs: 12.5,
      fbo_fulfillment_amount: 45,
    },
    ...over,
  } as PricesItem;
}

function makeStocks(over: Partial<StocksItem> = {}): StocksItem {
  return {
    offer_id: 'SKU-001',
    product_id: 12345,
    stocks: [
      { type: 'fbo', present: 7, reserved: 1 },
      { type: 'fbs', present: 3, reserved: 0 },
    ],
    ...over,
  } as StocksItem;
}

console.log('\n=== Stage products (info only) ===');
{
  const plan = planUnitProductUpsertFromOzon({ info: makeInfo() });
  expect(plan !== null, 'plan built');
  if (plan) {
    expect(plan.insert.priceKopecks === 0, 'price=0 in insert (no prices payload)');
    expect(plan.updates.priceKopecks === 'keep', 'price update = keep (no prices)');
    expect(plan.updates.stockMarketplace === 'keep', 'stockFbo update = keep (no stocks)');
    expect(plan.updates.stockOwn === 'keep', 'stockFbs update = keep (no stocks)');
    expect(plan.updates.sku === 'keep', 'sku update = keep when real Ozon SKU is absent');
    expect(plan.updates.volumeL === 'fresh', 'volume update = fresh (dims came with info)');
    expect(plan.insert.sku === '12345', 'fallback sku = product_id only when real SKU is absent');
    expect(plan.insert.volumeL > 0, 'volume calculated from dims');
    expect(plan.metadataDeltaKeys.includes('dimensionsMm'), 'metadata has dims');
    expect(plan.metadataDeltaKeys.includes('images'), 'metadata has images');
    expect(!plan.metadataDeltaKeys.includes('priceWithSpp'), 'metadata NO priceWithSpp (no prices)');
    expect(!plan.metadataDeltaKeys.includes('commissions'), 'metadata NO commissions (no prices)');
    expect(!plan.metadataDeltaKeys.includes('stockByType'), 'metadata NO stockByType (no stocks)');
  }
}

console.log('\n=== Real Ozon SKU from product sources ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ sources: [{ sku: 987654321, source: 'fbo' }] }),
  });
  expect(plan !== null, 'plan built');
  if (plan) {
    expect(plan.insert.sku === '987654321', 'unit_products.sku = real Ozon SKU');
    expect(plan.updates.sku === 'fresh', 'sku update = fresh when real Ozon SKU present');
    expect(plan.metadataDelta.ozonSku === 987654321, 'metadata has ozonSku');
    expect(plan.metadataDelta.productId === 12345, 'metadata keeps productId separately');
  }
}

console.log('\n=== Stage prices (info + prices, no stocks/dims) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    prices: makePrices(),
  });
  expect(plan !== null, 'plan built');
  if (plan) {
    expect(plan.updates.priceKopecks === 'fresh', 'price update = fresh');
    expect(plan.insert.priceKopecks === 150_000, 'price=1500 rub -> 150000 kop');
    expect(plan.updates.volumeL === 'keep', 'volume update = keep (no dims)');
    expect(plan.updates.stockMarketplace === 'keep', 'stockFbo = keep');
    expect(plan.updates.stockOwn === 'keep', 'stockFbs = keep');
    expect(plan.metadataDeltaKeys.includes('commissions'), 'metadata has commissions');
    expect(!plan.metadataDeltaKeys.includes('dimensionsMm'), 'metadata NO dims');
  }
}

console.log('\n=== Stage stocks (info + stocks, no prices/dims) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    stocks: makeStocks(),
  });
  expect(plan !== null, 'plan built');
  if (plan) {
    expect(plan.updates.priceKopecks === 'keep', 'price = keep (no prices)');
    expect(plan.updates.volumeL === 'keep', 'volume = keep (no dims)');
    expect(plan.updates.stockMarketplace === 'fresh', 'stockFbo = fresh');
    expect(plan.updates.stockOwn === 'fresh', 'stockFbs = fresh');
    expect(plan.insert.stockMarketplace === 7, 'FBO present=7');
    expect(plan.insert.stockOwn === 3, 'FBS present=3');
    expect(plan.metadataDeltaKeys.includes('stockByType'), 'metadata has stockByType');
  }
}

console.log('\n=== All three combined (one-shot upsert) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo(),
    prices: makePrices(),
    stocks: makeStocks(),
  });
  expect(plan !== null, 'plan built');
  if (plan) {
    expect(plan.updates.priceKopecks === 'fresh', 'price = fresh');
    expect(plan.updates.volumeL === 'fresh', 'volume = fresh');
    expect(plan.updates.stockMarketplace === 'fresh', 'stocks fbo = fresh');
    expect(plan.updates.stockOwn === 'fresh', 'stocks fbs = fresh');
    expect(plan.insert.priceKopecks === 150_000, 'price kopecks');
    expect(plan.insert.stockMarketplace === 7, 'fbo stocks');
    expect(plan.insert.stockOwn === 3, 'fbs stocks');
  }
}

console.log('\n=== Skip without keys ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: { ...(makeInfo() as unknown as ProductInfo), id: undefined as unknown as number },
  });
  expect(plan === null, 'plan=null when id missing');
}
{
  const plan = planUnitProductUpsertFromOzon({
    info: { ...makeInfo(), offer_id: '' as unknown as string },
  });
  expect(plan === null, 'plan=null when offer_id empty');
}

console.log('\n=== Visibility hidden ===');
{
  const plan = planUnitProductUpsertFromOzon({ info: makeInfo({ visible: false }) });
  expect(plan !== null && plan.insert.visibility === 'hidden', 'visible=false -> hidden');
  expect(plan !== null && plan.updates.visibility === 'fresh', 'visibility update = fresh');
}

console.log('\n=== Visibility undefined (preserve existing) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ visible: undefined as unknown as boolean }),
  });
  expect(plan !== null && plan.updates.visibility === 'keep', 'visible undefined -> keep');
  // insert.visibility defaults to 'visible' (since `!== false`); but in practice
  // we only care about update path. New rows get 'visible'.
}

console.log('\n=== Primary image as string (legacy format) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({
      primary_image: 'https://legacy.cdn/img.png' as unknown as string[],
      images: [],
    }),
  });
  expect(
    plan !== null && Array.isArray(plan.metadataDelta.images),
    'images is array from string primary_image',
  );
  expect(
    plan !== null && (plan.metadataDelta.images as string[])[0] === 'https://legacy.cdn/img.png',
    'string primary_image normalized',
  );
}

console.log('\n=== Stock by type (crossborder folds into FBS bucket) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    stocks: {
      offer_id: 'SKU-001',
      product_id: 12345,
      stocks: [
        { type: 'fbo', present: 10, reserved: 0 },
        { type: 'fbs', present: 2, reserved: 0 },
        { type: 'crossborder', present: 5, reserved: 0 },
      ],
    } as StocksItem,
  });
  expect(plan !== null && plan.insert.stockMarketplace === 10, 'FBO=10');
  expect(plan !== null && plan.insert.stockOwn === 7, 'FBS+crossborder=2+5=7');
}

console.log('\n=== Empty stocks array ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    stocks: { offer_id: 'SKU-001', product_id: 12345, stocks: [] } as StocksItem,
  });
  expect(plan !== null && plan.updates.stockMarketplace === 'fresh', 'empty stocks still = fresh');
  expect(plan !== null && plan.insert.stockMarketplace === 0, 'empty stocks -> 0');
}

// ----- Усиленные предикаты (Phase 0): пустой/нулевой price больше НЕ
// затирает существующее значение через set='fresh'. --------------------

console.log('\n=== Prices object with empty string price ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    prices: {
      offer_id: 'SKU-001',
      product_id: 12345,
      price: { price: '', marketing_seller_price: '', currency_code: 'RUB' },
    } as PricesItem,
  });
  expect(plan !== null && plan.updates.priceKopecks === 'keep', 'empty price string -> keep');
  expect(plan !== null && plan.insert.priceKopecks === 0, 'empty price -> insert=0');
  expect(
    plan !== null && !plan.metadataDeltaKeys.includes('priceWithSpp'),
    'no priceWithSpp meta when SPP empty',
  );
}

console.log('\n=== Prices object with "0" string price ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    prices: {
      offer_id: 'SKU-001',
      product_id: 12345,
      price: { price: '0', marketing_seller_price: '0', currency_code: 'RUB' },
    } as PricesItem,
  });
  expect(plan !== null && plan.updates.priceKopecks === 'keep', '"0" price -> keep');
  expect(plan !== null && plan.insert.priceKopecks === 0, '"0" price -> insert=0');
}

console.log('\n=== Prices object with SPP only (no price) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    prices: {
      offer_id: 'SKU-001',
      product_id: 12345,
      price: { price: '0', marketing_seller_price: '5990', currency_code: 'RUB' },
    } as PricesItem,
  });
  expect(plan !== null && plan.updates.priceKopecks === 'keep', 'zero price -> keep even if SPP present');
  expect(
    plan !== null && plan.metadataDeltaKeys.includes('priceWithSpp'),
    'priceWithSpp meta written when >0',
  );
  expect(plan !== null && plan.metadataDelta.priceWithSpp === 5990, 'priceWithSpp value preserved');
}

console.log('\n=== Dimensions with zeros (W×H×D = 0×0×0) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ depth: 0, width: 0, height: 0 }),
  });
  expect(plan !== null && plan.updates.volumeL === 'keep', 'zero dims -> volume keep');
  expect(plan !== null && plan.insert.volumeL === 0, 'zero dims -> insert=0');
  expect(
    plan !== null && !plan.metadataDeltaKeys.includes('dimensionsMm'),
    'no dimensionsMm meta for zero dims',
  );
}

console.log('\n=== Commissions all null (no commission data) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    prices: {
      offer_id: 'SKU-001',
      product_id: 12345,
      price: { price: '1500', marketing_seller_price: '1450', currency_code: 'RUB' },
      commissions: {
        sales_percent_fbo: null,
        sales_percent_fbs: null,
        fbo_fulfillment_amount: null,
      },
    } as unknown as PricesItem,
  });
  expect(plan !== null && plan.updates.priceKopecks === 'fresh', 'price stays fresh');
  expect(
    plan !== null && !plan.metadataDeltaKeys.includes('commissions'),
    'commissions meta NOT written when all null (prevents wiping existing)',
  );
}

console.log('\n=== Commissions FBO only (FBS null) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    prices: {
      offer_id: 'SKU-001',
      product_id: 12345,
      price: { price: '1500', currency_code: 'RUB' },
      commissions: {
        sales_percent_fbo: 18.5,
        sales_percent_fbs: null,
      },
    } as unknown as PricesItem,
  });
  expect(plan !== null && plan.metadataDeltaKeys.includes('commissions'), 'commissions meta exists');
  const commissions = plan?.metadataDelta.commissions as Record<string, unknown>;
  expect(commissions.fboPct === 18.5, 'fboPct preserved');
  expect(!('fbsPct' in commissions), 'fbsPct OMITTED when null (no JSON-merge null overwrite)');
}

console.log('\n=== Commissions FBS only (FBO null) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    prices: {
      offer_id: 'SKU-001',
      product_id: 12345,
      price: { price: '1500', currency_code: 'RUB' },
      commissions: {
        sales_percent_fbo: null,
        sales_percent_fbs: 12.5,
      },
    } as unknown as PricesItem,
  });
  const commissions = plan?.metadataDelta.commissions as Record<string, unknown>;
  expect(commissions.fbsPct === 12.5, 'fbsPct preserved');
  expect(!('fboPct' in commissions), 'fboPct OMITTED when null');
}

console.log('\n=== Fulfillment only (commissions null) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    prices: {
      offer_id: 'SKU-001',
      product_id: 12345,
      price: { price: '1500', currency_code: 'RUB' },
      commissions: {
        sales_percent_fbo: null,
        sales_percent_fbs: null,
        fbo_fulfillment_amount: 65,
      },
    } as unknown as PricesItem,
  });
  expect(plan !== null && plan.metadataDeltaKeys.includes('commissions'), 'commissions meta written');
  const commissions = plan?.metadataDelta.commissions as Record<string, unknown>;
  expect(commissions.fboFulfillmentRub === 65, 'fulfillment kept');
}

console.log('\n=== Late stage stocks does NOT clobber price/dims (full scenario) ===');
{
  // 1) products+prices stage
  const planA = planUnitProductUpsertFromOzon({
    info: makeInfo(),
    prices: makePrices(),
  });
  expect(planA !== null && planA.updates.priceKopecks === 'fresh', 'A: prices fresh');
  expect(planA !== null && planA.updates.volumeL === 'fresh', 'A: volume fresh');

  // 2) stocks stage с info-stub без габаритов и без prices
  const planB = planUnitProductUpsertFromOzon({
    info: makeInfo({
      weight: undefined,
      depth: undefined,
      width: undefined,
      height: undefined,
    }),
    stocks: makeStocks(),
  });
  expect(planB !== null && planB.updates.priceKopecks === 'keep', 'B: prices keep (stocks stage)');
  expect(planB !== null && planB.updates.volumeL === 'keep', 'B: volume keep (stocks stage)');
}

// ----- parseMoneyRu: numeric/null/whitespace payloads --------------------
// Регрессия: Ozon отдаёт price числом (lenient client пропускает raw), а
// старый parseMoneyRu падал на `value.replace is not a function`.

console.log('\n=== parseMoneyRu: tolerant unknown input ===');
{
  expect(parseMoneyRu('1500') === 1500, 'string integer');
  expect(parseMoneyRu('1 500,75') === 1500.75, 'string with space + comma');
  expect(parseMoneyRu('1500.5') === 1500.5, 'string with dot');
  expect(parseMoneyRu('') === 0, 'empty string -> 0');
  expect(parseMoneyRu('  ') === 0, 'whitespace string -> 0 (NaN after parse)');
  expect(parseMoneyRu(undefined) === 0, 'undefined -> 0');
  expect(parseMoneyRu(null) === 0, 'null -> 0');
  expect(parseMoneyRu(1500) === 1500, 'number integer');
  expect(parseMoneyRu(1500.75) === 1500.75, 'number float');
  expect(parseMoneyRu(0) === 0, 'numeric zero -> 0');
  expect(parseMoneyRu(Number.NaN) === 0, 'NaN -> 0');
  expect(parseMoneyRu(Number.POSITIVE_INFINITY) === 0, '+Infinity -> 0');
  expect(parseMoneyRu({}) === 0, 'object -> 0');
  expect(parseMoneyRu([]) === 0, 'array -> 0');
  expect(parseMoneyRu(true) === 0, 'boolean -> 0');
}

console.log('\n=== Numeric price payload (Ozon variant) ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    prices: {
      offer_id: 'SKU-001',
      product_id: 12345,
      price: {
        price: 1500 as unknown as string,
        marketing_seller_price: 1450 as unknown as string,
        currency_code: 'RUB',
      },
    } as PricesItem,
  });
  expect(plan !== null, 'numeric price plan built');
  if (plan) {
    expect(plan.updates.priceKopecks === 'fresh', 'numeric price -> fresh');
    expect(plan.insert.priceKopecks === 150_000, 'numeric 1500 rub -> 150000 kop');
    expect(plan.metadataDelta.priceWithSpp === 1450, 'numeric SPP stored as rub');
  }
}

console.log('\n=== Mixed numeric/string price ===');
{
  const plan = planUnitProductUpsertFromOzon({
    info: makeInfo({ weight: undefined, depth: undefined, width: undefined, height: undefined }),
    prices: {
      offer_id: 'SKU-001',
      product_id: 12345,
      price: {
        price: '1 500,5' as unknown as string,
        marketing_seller_price: 1400 as unknown as string,
        currency_code: 'RUB',
      },
    } as PricesItem,
  });
  expect(plan !== null && plan.insert.priceKopecks === 150_050, 'string "1 500,5" -> 150050 kop');
  expect(plan !== null && plan.metadataDelta.priceWithSpp === 1400, 'numeric SPP 1400 rub');
}

console.log(`\n\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
