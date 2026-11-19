// PURPOSE: Оффлайн smoke-тесты начислений Ozon (/v1/finance/accrual/by-day,
// /v1/finance/accrual/types): разбор сумм в копейки со знаком, маппинг в строки
// ozon_accruals, ключи идемпотентности, нарезка окна на дни, last_id-пагинация
// и правило «неполная выборка не заменяет окно дня». Фикстуры — по форме
// примеров ответа из справочника seller-api-docs.md (без сети и БД).
// Запуск: pnpm tsx scripts/test-ozon-accruals-map.ts

import {
  ACCRUAL_EARLIEST_DATE,
  MAX_ACCRUAL_WINDOW_DAYS,
  accrualRowKey,
  accrualSourcePart,
  accrualSourceRef,
  accrualWindowKey,
  TOTAL_COMPOSING_KINDS,
  assertNonOverlappingKinds,
  collectLastIdPages,
  decideAccrualDayWrite,
  mapAccrualDay,
  mapAccrualTypes,
  parseAccrualByDayPage,
  parseAmountKopecks,
  parseIntId,
  planAccrualWindow,
  type LastIdPage,
} from '../src/lib/marketplaces/ozon/accruals-map';
import type { OzonAccrualLineKind } from '../src/lib/db/schema/marketplaces';
import type { AccrualByDay } from '../src/lib/marketplaces/ozon/types';
import { OZON_FULL_STAGES, OZON_LEGACY_STAGES, OZON_ALL_STAGES } from '../src/lib/marketplaces/types';

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

const TENANT = '00000000-0000-0000-0000-00000000000t';
const ACCOUNT = '00000000-0000-0000-0000-00000000000a';
const DAY = '2026-11-17';

// Пример ответа by-day из справочника ДОСЛОВНО (плейсхолдеры "string"/0/null).
const REFERENCE_BY_DAY = {
  accruals: [
    {
      accrued_category: 'UNSPECIFIED',
      date: 'string',
      item_fees: {
        fees: [{ fees: [{ accrued: { amount: 'string', currency: 'string' }, type_id: 0 }], sku: 0 }],
      },
      non_item_fee: { accrued: { amount: 'string', currency: 'string' }, type_id: 0 },
      posting: {
        delivery_schema: 'string',
        delivery_speed: 0,
        products: [
          {
            commission: {
              bonus: { amount: 'string', currency: 'string' },
              coinvestment: { amount: 'string', currency: 'string' },
              commission: { amount: 'string', currency: 'string' },
              commission_ratio: 'string',
              sale_amount: { amount: 'string', currency: 'string' },
              sale_commission: { amount: 'string', currency: 'string' },
              sale_price: { amount: 'string', currency: 'string' },
              seller_price: { amount: 'string', currency: 'string' },
            },
            delivery: {
              services: [{ accrued: { amount: null, currency: null }, type_id: 0 }],
              total_accrued: { amount: 'string', currency: 'string' },
            },
            sku: 0,
          },
        ],
      },
      total_amount: { amount: 'string', currency: 'string' },
      type_id: 0,
      unit_number: 'string',
    },
  ],
  last_id: 'string',
};

// Та же форма с правдоподобными значениями: продажа с разбивкой и начисление без товара.
// Продажа (POSTING): total = sale_amount + commission + delivery_total = 756.60.
const SALE = {
  accrued_category: 'POSTING',
  date: '2026-11-17T10:15:00Z',
  non_item_fee: null,
  posting: {
    delivery_schema: 'FBO',
    delivery_speed: 0,
    products: [
      {
        sku: 1234567890,
        commission: {
          sale_amount: { amount: '1000.00', currency: 'RUB' },
          commission: { amount: '-180.00', currency: 'RUB' },
          sale_commission: { amount: '-180.00', currency: 'RUB' },
          bonus: { amount: '25.5', currency: 'RUB' },
          coinvestment: { amount: '0', currency: 'RUB' },
          commission_ratio: '0.18',
          sale_price: { amount: '1000.00', currency: 'RUB' },
          seller_price: { amount: '1100.00', currency: 'RUB' },
        },
        delivery: {
          services: [
            { accrued: { amount: '-63.40', currency: 'RUB' }, type_id: 21 },
            { accrued: { amount: null, currency: null }, type_id: 22 },
          ],
          total_accrued: { amount: '-63.40', currency: 'RUB' },
        },
      },
    ],
  },
  total_amount: { amount: '756.60', currency: 'RUB' },
  type_id: 1,
  unit_number: '41517061-0214-1',
};
// Сборы по товарам (ITEM): total = сумма item_fee = -165.60.
const SALE_ITEM = {
  accrued_category: 'ITEM',
  date: '2026-11-17',
  item_fees: {
    fees: [
      {
        sku: 1234567890,
        quantity: 2,
        fees: [
          { accrued: { amount: '-120.50', currency: 'RUB' }, type_id: 11 },
          { accrued: { amount: '-35.10', currency: 'RUB' }, type_id: 12 },
        ],
      },
      { sku: '987654321', fees: [{ accrued: { amount: '-10', currency: 'RUB' }, type_id: 11 }] },
    ],
  },
  total_amount: { amount: '-165.60', currency: 'RUB' },
  unit_number: 'x-1',
};
const STORAGE = {
  accrued_category: 'NON_ITEM',
  date: '2026-11-17',
  non_item_fee: { accrued: { amount: '-1500.005', currency: 'RUB' }, type_id: 31 },
  total_amount: { amount: '-1500.01', currency: 'RUB' },
  type_id: '7',
};

// ЖИВЫЕ образцы /v1/finance/accrual/by-day 2026-11-17 (по одному на форму).
const LIVE_ITEM = {
  accrual_id: 69972929647,
  date: '2026-11-17',
  total_amount: { amount: '-15.2', currency: 'RUB' },
  unit_number: '37084104-0477',
  accrued_category: 'ITEM',
  posting: null,
  item_fees: {
    fees: [{ sku: 3114601132, fees: [{ type_id: 1, accrued: { amount: '-15.2', currency: 'RUB' } }], quantity: 1 }],
  },
  non_item_fee: null,
  container_fees: null,
};
const LIVE_NON_ITEM = {
  accrual_id: 69973016198,
  date: '2026-11-17',
  total_amount: { amount: '-533.5', currency: 'RUB' },
  unit_number: '2000073178056',
  accrued_category: 'NON_ITEM',
  posting: null,
  item_fees: null,
  non_item_fee: { type_id: 12, accrued: { amount: '-533.5', currency: 'RUB' } },
  container_fees: null,
};
const LIVE_POSTING = {
  accrual_id: 69978312069,
  date: '2026-11-17',
  total_amount: { amount: '306.63', currency: 'RUB' },
  unit_number: '0164135132-0133-5',
  accrued_category: 'POSTING',
  posting: {
    delivery_schema: 'Fbo',
    products: [
      {
        sku: 2439003425,
        delivery: {
          total_accrued: { amount: '-117.22', currency: 'RUB' },
          services: [
            { type_id: 32, accrued: { amount: '-117', currency: 'RUB' } },
            { type_id: 29, accrued: { amount: '-0.22', currency: 'RUB' } },
          ],
        },
        commission: {
          seller_price: { amount: '865', currency: 'RUB' },
          sale_price: { amount: '437.14', currency: 'RUB' },
          sale_commission: { amount: '-441.15', currency: 'RUB' },
          commission: { amount: '-441.15', currency: 'RUB' },
          commission_ratio: 'value:"0.510000"',
          sale_amount: { amount: '865', currency: 'RUB' },
          coinvestment: { amount: '4.37', currency: 'RUB' },
          bonus: { amount: '423.49', currency: 'RUB' },
        },
        quantity: 1,
      },
    ],
  },
  item_fees: null,
  non_item_fee: null,
  container_fees: null,
};

async function main() {
  console.log('\n# parseAmountKopecks / parseIntId');
  expect(parseAmountKopecks('1234.56') === 123456, '"1234.56" → 123456');
  expect(parseAmountKopecks('-150.25') === -15025, 'знак сохраняется: "-150.25" → -15025');
  expect(parseAmountKopecks('+7') === 700, '"+7" → 700');
  expect(parseAmountKopecks('12.345') === 1235, 'третий знак округляется от нуля: 12.345 → 1235');
  expect(parseAmountKopecks('-12.345') === -1235, '-12.345 → -1235');
  expect(parseAmountKopecks('0.1') === 10, '"0.1" → 10 (без float-ошибки)');
  expect(Object.is(parseAmountKopecks('-0.00'), 0), '"-0.00" → 0 (не -0)');
  expect(parseAmountKopecks(99.9) === 9990, 'число 99.9 → 9990');
  expect(parseAmountKopecks(-1234.565) === -123457, 'число -1234.565 → -123457 (то же правило, что у строки)');
  expect(parseAmountKopecks(-1234.565) === parseAmountKopecks('-1234.565'), 'число и строка округляются одинаково');
  expect(parseAmountKopecks(12.345) === 1235 && parseAmountKopecks(-12.345) === -1235, 'число 12.345 → 1235, -12.345 → -1235');
  expect(parseAmountKopecks(1e21) === null && parseAmountKopecks(Number.NaN) === null, 'экспонента/NaN → null');
  expect(parseAmountKopecks('string') === null, 'плейсхолдер "string" → null, не 0');
  expect(parseAmountKopecks('') === null, 'пустая строка → null');
  expect(parseAmountKopecks(null) === null, 'null → null');
  expect(parseAmountKopecks('1 200') === null, 'строка с пробелом → null (Ozon шлёт без разрядов)');
  expect(parseAmountKopecks('1,5') === null, 'запятая → null');
  expect(parseIntId('1234567890', 1) === 1234567890, 'sku строкой');
  expect(parseIntId(0, 1) === null && parseIntId(0, 0) === 0, 'sku 0 не sku, type_id 0 допустим');
  expect(parseIntId('12a', 0) === null && parseIntId(1.5, 0) === null, 'мусор → null');

  console.log('\n# Пример справочника: схема принимает, маппинг НЕ пишет нули');
  const refPage = parseAccrualByDayPage(REFERENCE_BY_DAY);
  expect(refPage.shapeOk && refPage.items.length === 1 && refPage.lastId === 'string', 'форма примера by-day проходит схему');
  const refMap = mapAccrualDay({
    tenantId: TENANT,
    accountId: ACCOUNT,
    day: DAY,
    accruals: refPage.items,
    offerBySku: new Map(),
  });
  expect(refMap.rows.length === 0, 'начисление с суммой "string" не записано');
  expect(refMap.fatal.some((f) => f.includes('total_amount')), 'битая total_amount → fatal', refMap.fatal.join(' | '));
  expect(refMap.fatal.some((f) => f.includes('item_fees.fees[0].sku')), 'sku 0 в item_fees → fatal');
  expect(refMap.fatal.some((f) => f.includes('posting.products[0].sku')), 'sku 0 в posting.products → fatal');
  const refDecision = decideAccrualDayWrite({ complete: true, shapeOk: true, fatal: refMap.fatal });
  expect(!refDecision.replace, 'fatal → окно дня не заменяется');

  console.log('\n# Маппинг правдоподобного дня');
  const page = parseAccrualByDayPage({ accruals: [SALE, STORAGE, SALE_ITEM], last_id: 'abc' });
  expect(page.shapeOk && page.items.length === 3, 'страница проходит схему');
  const offerBySku = new Map([['1234567890', 'ART-1']]);
  const m = mapAccrualDay({ tenantId: TENANT, accountId: ACCOUNT, day: DAY, accruals: page.items, offerBySku });
  expect(m.fatal.length === 0, 'нет fatal', m.fatal.join(' | '));
  expect(m.accrualCount === 3, 'начислений 3');
  expect(!m.problems.some((p) => p.includes('не сходится')), 'все фикстуры сходятся с total (нет «не сходится»)', m.problems.join(' | '));
  const sale = m.rows.filter((r) => r.seq === 0);
  const storage = m.rows.filter((r) => r.seq === 1);
  const itemAcc = m.rows.filter((r) => r.seq === 2);
  // SALE: total + 5 commission + 1 delivery_service (вторая null) + delivery_total = 8
  expect(sale.length === 8, `строк продажи 8 (есть ${sale.length})`);
  expect(storage.length === 2, `строк хранения 2: total + non_item_fee (есть ${storage.length})`);
  const total = sale.find((r) => r.lineKind === 'total');
  expect(total?.lineNo === 0 && total.amountKopecks === 75660, 'total: line_no 0, 756.60 → 75660');
  expect(total?.accrualTypeId === 0 && total.sku === null, 'total: accrual_type_id = 0 (sentinel), без sku');
  expect(total?.unitNumber === '41517061-0214-1' && total.postingNumber === '41517061-0214-1', 'unit_number сохранён; у POSTING он же posting_number');
  expect(total?.ozonDate === '2026-11-17T10:15:00Z' && total.accrualDate === DAY, 'date строкой, день = день запроса');
  expect(total?.deliverySchema === 'FBO' && total.currency === 'RUB', 'схема доставки и валюта');

  console.log('\n# Валюта: нормализация регистра и предупреждение о чужой');
  const cur = mapAccrualDay({
    tenantId: TENANT,
    accountId: ACCOUNT,
    day: DAY,
    accruals: [
      { ...STORAGE, total_amount: { amount: '-10', currency: 'rub' } },
      { ...STORAGE, total_amount: { amount: '-5', currency: 'usd' } },
    ] as AccrualByDay[],
    offerBySku: new Map(),
  });
  const curTotals = cur.rows.filter((r) => r.lineKind === 'total');
  expect(curTotals[0]?.currency === 'RUB', "'rub' → 'RUB' (фильтр потребителей по 'RUB' не промахнётся)");
  expect(curTotals[1]?.currency === 'USD', "'usd' → 'USD', записано как есть");
  expect(cur.problems.some((p) => p.includes('USD')), 'чужая валюта → предупреждение');
  expect(
    (total?.raw as Record<string, unknown>)?.type_id === 1 && sale.filter((r) => Object.keys(r.raw ?? {}).length > 0).length === 1,
    'raw — только у строки total',
  );
  const fees = itemAcc.filter((r) => r.lineKind === 'item_fee');
  expect(
    fees.map((r) => `${r.sku}:${r.feeTypeId}:${r.amountKopecks}`).join(',') ===
      '1234567890:11:-12050,1234567890:12:-3510,987654321:11:-1000',
    'item_fee: sku × type_id × копейки со знаком',
    fees.map((r) => `${r.sku}:${r.feeTypeId}:${r.amountKopecks}`).join(','),
  );
  expect(fees[0].offerId === 'ART-1' && fees[2].offerId === null, 'offer_id по каталогу; нет в каталоге → null');
  expect(fees[0].qty === 2 && fees[1].qty === 2 && fees[2].qty === null, 'qty из quantity группы; нет quantity → null');
  const comm = Object.fromEntries(sale.filter((r) => r.lineKind.startsWith('commission_')).map((r) => [r.lineKind, r.amountKopecks]));
  expect(
    comm.commission_sale_amount === 100000 &&
      comm.commission_commission === -18000 &&
      comm.commission_sale_commission === -18000 &&
      comm.commission_bonus === 2550 &&
      comm.commission_coinvestment === 0,
    'компоненты комиссии в копейках',
    JSON.stringify(comm),
  );
  expect(!sale.some((r) => (r.lineKind as string).includes('price')), 'цены (sale_price/seller_price) строками не пишутся');
  const svc = sale.filter((r) => r.lineKind === 'delivery_service');
  expect(svc.length === 1 && svc[0].feeTypeId === 21 && svc[0].amountKopecks === -6340, 'услуга доставки; null-сумма пропущена, не 0');
  expect(m.problems.some((p) => p.includes('type 22')), 'пропуск null-услуги виден в problems');
  expect(sale.some((r) => r.lineKind === 'delivery_total' && r.amountKopecks === -6340), 'delivery_total');
  const st = storage.find((r) => r.lineKind === 'non_item_fee');
  expect(st?.amountKopecks === -150001 && st.feeTypeId === 31 && st.sku === null, 'non_item_fee: -1500.005 → -150001, без sku');
  expect(storage[0].accrualTypeId === 0 && storage[1].accrualTypeId === 31, 'total → 0, non_item_fee → свой type_id 31');
  expect(sale.map((r) => r.lineNo).join(',') === '0,1,2,3,4,5,6,7', 'line_no сквозной внутри начисления');

  console.log('\n# ЖИВОЙ ответ: ITEM / NON_ITEM / POSTING без верхнего type_id');
  {
    // порядок выдачи намеренно не по accrual_id: seq идёт по accrual_id
    const livePage = parseAccrualByDayPage({ accruals: [LIVE_POSTING, LIVE_ITEM, LIVE_NON_ITEM], last_id: '' });
    expect(livePage.shapeOk && livePage.items.length === 3, 'живая страница проходит схему', livePage.problems.join('|'));
    const lm = mapAccrualDay({ tenantId: TENANT, accountId: ACCOUNT, day: DAY, accruals: livePage.items, offerBySku: new Map() });
    expect(lm.fatal.length === 0, 'нет fatal', lm.fatal.join(' | '));
    expect(lm.problems.length === 0, 'строки сходятся с total_amount (нет problems)', lm.problems.join(' | '));
    const item = lm.rows.filter((r) => r.seq === 0);
    const nonItem = lm.rows.filter((r) => r.seq === 1);
    const posting = lm.rows.filter((r) => r.seq === 2);
    expect(
      item.length === 2 && item[0].lineKind === 'total' && item[0].amountKopecks === -1520 && item[0].accrualTypeId === 0,
      'ITEM: total -15.2 -> -1520, accrual_type_id 0 (sentinel)',
    );
    expect(
      item[1].lineKind === 'item_fee' && item[1].feeTypeId === 1 && item[1].accrualTypeId === 1 &&
        item[1].sku === '3114601132' && item[1].qty === 1 && item[1].amountKopecks === -1520,
      'ITEM: item_fee type 1, sku числом -> строка, qty 1',
    );
    expect(item[0].postingNumber === null && item[0].unitNumber === '37084104-0477', 'ITEM: posting_number не выдуман');
    expect((item[0].raw as Record<string, unknown>).accrual_id === 69972929647, 'accrual_id хранится в raw строки total');
    expect(
      nonItem.length === 2 && nonItem[1].lineKind === 'non_item_fee' && nonItem[1].feeTypeId === 12 && nonItem[1].amountKopecks === -53350,
      'NON_ITEM: non_item_fee type 12, -533.5 -> -53350',
    );
    expect(posting.length === 1 + 5 + 2 + 1, `POSTING: total + 5 commission + 2 услуги + delivery_total (есть ${posting.length})`);
    expect(
      posting.every((r) => r.postingNumber === '0164135132-0133-5' && r.deliverySchema === 'Fbo'),
      'POSTING: unit_number -> posting_number, схема Fbo',
    );
    const pk = (k: string) => posting.find((r) => r.lineKind === k);
    expect(
      pk('total')?.amountKopecks === 30663 &&
        pk('commission_sale_amount')?.amountKopecks === 86500 &&
        pk('commission_commission')?.amountKopecks === -44115 &&
        pk('commission_bonus')?.amountKopecks === 42349 &&
        pk('commission_coinvestment')?.amountKopecks === 437 &&
        pk('delivery_total')?.amountKopecks === -11722,
      'POSTING: суммы строк в копейках',
    );
    const svcs = posting.filter((r) => r.lineKind === 'delivery_service');
    expect(
      svcs.map((r) => `${r.feeTypeId}:${r.amountKopecks}`).join(',') === '32:-11700,29:-22' &&
        svcs.reduce((x, r) => x + r.amountKopecks, 0) === pk('delivery_total')?.amountKopecks,
      'POSTING: услуги 32/29 в сумме = delivery_total',
    );
    expect(
      posting.filter((r) => r.lineKind !== 'total').every((r) => r.sku === '2439003425' && r.qty === 1) && pk('total')?.qty === null,
      'POSTING: sku/qty у строк товара, total без qty',
    );
    // total = sale_amount + commission + delivery_total (bonus/coinvestment/sale_commission не входят)
    expect(86500 - 44115 - 11722 === 30663, 'арифметика итога POSTING: 865 - 441.15 - 117.22 = 306.63');
    const lm2 = mapAccrualDay({
      tenantId: TENANT, accountId: ACCOUNT, day: DAY,
      accruals: [LIVE_NON_ITEM, LIVE_ITEM, LIVE_POSTING] as AccrualByDay[], offerBySku: new Map(),
    });
    expect(
      JSON.stringify(lm2.rows.map((r) => [accrualRowKey(r), r.amountKopecks])) ===
        JSON.stringify(lm.rows.map((r) => [accrualRowKey(r), r.amountKopecks])),
      'seq по accrual_id: другой порядок выдачи -> те же ключи и суммы',
    );
    const bad = mapAccrualDay({
      tenantId: TENANT, accountId: ACCOUNT, day: DAY,
      accruals: [{ ...LIVE_ITEM, total_amount: { amount: '-99', currency: 'RUB' } }] as AccrualByDay[], offerBySku: new Map(),
    });
    expect(bad.problems.some((p) => p.includes('не сходится')), 'расхождение total и строк -> problems (не fatal)');
    expect(bad.fatal.length === 0, 'расхождение не блокирует запись дня');
  }

  console.log('\n# Дубли accrual_id');
  {
    const run = (list: unknown[]) =>
      mapAccrualDay({ tenantId: TENANT, accountId: ACCOUNT, day: DAY, accruals: list as AccrualByDay[], offerBySku: new Map() });
    const same = run([LIVE_ITEM, LIVE_NON_ITEM, { ...LIVE_ITEM }]);
    expect(same.fatal.length === 0 && same.rows.filter((r) => r.lineKind === 'total').length === 2, 'дубль с теми же данными отброшен');
    expect(same.problems.some((p) => p.includes('повторён')), 'дубль даёт предупреждение');
    expect(same.rows.every((r) => r.accrualId !== null), 'accrual_id заполнен у каждой строки');
    const diff = run([LIVE_ITEM, { ...LIVE_ITEM, total_amount: { amount: '-1', currency: 'RUB' } }]);
    expect(diff.fatal.some((f) => f.includes('РАЗНЫМИ')), 'тот же accrual_id с другими суммами -> fatal');
    expect(!decideAccrualDayWrite({ complete: true, shapeOk: true, fatal: diff.fatal }).replace, 'fatal -> день не перезаписывается');
    expect(accrualSourceRef(DAY, 3, 69972929647) === 'acc:69972929647', 'source_ref из accrual_id');
    expect(accrualSourceRef(DAY, 3, null) === '2026-11-17:3', 'без accrual_id - день:seq');
  }

  console.log('\n# Fee type_id: 0 зарезервирован');
  {
    const zeroFee = mapAccrualDay({
      tenantId: TENANT, accountId: ACCOUNT, day: DAY, offerBySku: new Map(),
      accruals: [{ ...LIVE_NON_ITEM, non_item_fee: { type_id: 0, accrued: { amount: '-533.5', currency: 'RUB' } } }] as AccrualByDay[],
    });
    expect(zeroFee.fatal.some((f) => f.includes('non_item_fee.type_id')) && zeroFee.rows.length === 0, 'non_item_fee type_id 0 -> fatal');
    const zeroItem = mapAccrualDay({
      tenantId: TENANT, accountId: ACCOUNT, day: DAY, offerBySku: new Map(),
      accruals: [{ ...LIVE_ITEM, item_fees: { fees: [{ sku: 1, fees: [{ type_id: 0, accrued: { amount: '-15.2' } }] }] } }] as AccrualByDay[],
    });
    expect(zeroItem.fatal.length === 1, 'item_fee type_id 0 -> fatal');
  }

  console.log('\n# container_fees / незнакомая категория');
  {
    const odd = mapAccrualDay({
      tenantId: TENANT, accountId: ACCOUNT, day: DAY, offerBySku: new Map(),
      accruals: [{ ...LIVE_NON_ITEM, accrued_category: 'WEIRD', container_fees: { x: 1 } }] as unknown as AccrualByDay[],
    });
    expect(odd.problems.some((p) => p.includes('accrued_category')), 'незнакомая accrued_category -> предупреждение');
    expect(odd.problems.some((p) => p.includes('container_fees')), 'container_fees не пуст -> предупреждение');
    expect(odd.fatal.length === 0, 'оба - не fatal');
  }

  console.log('\n# sumOzonAccruals: пересекающиеся виды');
  {
    const bad: OzonAccrualLineKind[][] = [
      ['total', 'item_fee'],
      ['delivery_service', 'delivery_total'],
      ['commission_commission', 'commission_sale_commission'],
    ];
    for (const kinds of bad) {
      let threw = false;
      try {
        assertNonOverlappingKinds(kinds);
      } catch {
        threw = true;
      }
      expect(threw, `${kinds.join(' + ')} -> исключение`);
    }
    let ok = true;
    try {
      assertNonOverlappingKinds(['total']);
      assertNonOverlappingKinds(Array.from(TOTAL_COMPOSING_KINDS));
      assertNonOverlappingKinds(['commission_bonus', 'commission_coinvestment', 'delivery_service']);
    } catch {
      ok = false;
    }
    expect(ok, 'total отдельно, составляющие итога вместе, справочные виды - допустимы');
    expect(!TOTAL_COMPOSING_KINDS.has('commission_bonus') && !TOTAL_COMPOSING_KINDS.has('delivery_service'), 'bonus/service вне TOTAL_COMPOSING_KINDS');
  }

  console.log('\n# Ключи идемпотентности');
  const rowKeys = new Set(m.rows.map(accrualRowKey));
  expect(rowKeys.size === m.rows.length, 'ключ строки уникален внутри окна дня');
  expect(
    new Set(m.rows.map((r) => accrualWindowKey(r.accountId, r.accrualDate))).size === 1,
    'все строки дня — одно окно замены (аккаунт × день)',
  );
  const again = mapAccrualDay({ tenantId: TENANT, accountId: ACCOUNT, day: DAY, accruals: page.items, offerBySku });
  expect(
    JSON.stringify(again.rows.map(accrualRowKey)) === JSON.stringify(m.rows.map(accrualRowKey)),
    'повторный маппинг той же выдачи даёт те же ключи',
  );
  expect(accrualSourceRef(DAY, 3) === '2026-11-17:3', 'source_ref = день:seq');
  expect(accrualSourcePart(fees[0]) === 'item_fee:1/sku:1234567890', 'source_part с sku');
  expect(accrualSourcePart(total!) === 'total:0', 'source_part без sku');

  console.log('\n# Схема: денежные и ключевые поля обязательны');
  const noTotal = parseAccrualByDayPage({ accruals: [{ ...STORAGE, total_amount: undefined }] });
  expect(!noTotal.shapeOk, 'нет total_amount → форма не та');
  const noAmount = parseAccrualByDayPage({ accruals: [{ ...STORAGE, total_amount: { currency: 'RUB' } }] });
  expect(!noAmount.shapeOk, 'нет total_amount.amount → форма не та');
  const noType = parseAccrualByDayPage({ accruals: [{ ...STORAGE, type_id: undefined }] });
  expect(noType.shapeOk, 'верхний type_id необязателен (в живом ответе его нет)');
  const noDate = parseAccrualByDayPage({ accruals: [{ ...STORAGE, date: undefined }] });
  expect(!noDate.shapeOk, 'нет date → форма не та');
  const feeNoAccrued = parseAccrualByDayPage({
    accruals: [{ ...SALE, item_fees: { fees: [{ sku: 1, fees: [{ type_id: 1 }] }] } }],
  });
  expect(!feeNoAccrued.shapeOk, 'сбор без accrued → форма не та');
  // Ключ `accruals` обязателен: тело без него — дрейф формы, а не «пустой день»
  // (иначе decideAccrualDayWrite разрешил бы стереть уже записанный день).
  for (const [label, body] of [
    ['{}', {}],
    ['{accruals:null}', { accruals: null }],
    ['{result:{accruals,last_id}}', { result: { accruals: [STORAGE], last_id: 'a' } }],
    ['{code,message} с HTTP 200', { code: 3, message: 'err' }],
  ] as const) {
    const page = parseAccrualByDayPage(body);
    expect(!page.shapeOk, `${label} → форма не та`);
    const d = decideAccrualDayWrite({ complete: false, shapeOk: page.shapeOk, fatal: [] });
    expect(!d.replace, `${label} → день не заменяется`);
  }
  const emptyPage = parseAccrualByDayPage({ accruals: [], last_id: '' });
  expect(
    emptyPage.shapeOk && emptyPage.items.length === 0 && emptyPage.lastId === '',
    '{accruals: []} → легитимный пустой день',
  );
  expect(!parseAccrualByDayPage([]).shapeOk, 'массив вместо объекта → форма не та');

  console.log('\n# last_id-пагинация');
  const pages = (list: Array<LastIdPage<number>>) => {
    const seen: string[] = [];
    let i = 0;
    return {
      seen,
      run: (maxPages = 50) =>
        collectLastIdPages<number>({
          label: 'test',
          maxPages,
          fetchPage: async (lastId) => {
            seen.push(lastId);
            return list[Math.min(i++, list.length - 1)];
          },
          parse: (d) => d as LastIdPage<number>,
        }),
    };
  };
  const ok = (items: number[], lastId: string): LastIdPage<number> => ({ items, lastId, shapeOk: true, problems: [] });
  {
    const p = pages([ok([1, 2], 'a'), ok([3], 'b'), ok([], 'b')]);
    const r = await p.run();
    expect(r.complete && r.items.join(',') === '1,2,3', 'конец по пустой странице → complete');
    expect(p.seen.join('|') === '|a|b', 'первый last_id пустой, дальше из ответа');
  }
  {
    const r = await pages([ok([1], 'a'), ok([2], '')]).run();
    expect(r.complete && r.items.length === 2, 'конец по пустому last_id → complete');
  }
  {
    const r = await pages([ok([1], 'a'), ok([2], 'a')]).run();
    expect(!r.complete && r.warnings.some((w) => w.includes('не изменился')), 'last_id не сдвинулся → неполная');
  }
  {
    const r = await pages([ok([1], 'a'), ok([2], 'b'), ok([3], 'c')]).run(2);
    expect(!r.complete && r.warnings.some((w) => w.includes('лимит')), 'лимит страниц → неполная');
  }
  {
    const r = await pages([ok([1], 'a'), { items: [], lastId: '', shapeOk: false, problems: ['bad'] }]).run();
    expect(!r.complete && !r.shapeOk && r.items.length === 1, 'дрейф формы на 2-й странице → неполная, а не «конец»');
    const d = decideAccrualDayWrite({ complete: r.complete, shapeOk: r.shapeOk, fatal: [] });
    expect(!d.replace, 'неполная выборка НЕ даёт команду на замену окна');
  }

  console.log('\n# decideAccrualDayWrite');
  expect(decideAccrualDayWrite({ complete: true, shapeOk: true, fatal: [] }).replace, 'полная без ошибок → заменить');
  expect(!decideAccrualDayWrite({ complete: false, shapeOk: true, fatal: [] }).replace, 'неполная → не заменять');
  expect(!decideAccrualDayWrite({ complete: true, shapeOk: false, fatal: [] }).replace, 'форма не та → не заменять');
  expect(!decideAccrualDayWrite({ complete: true, shapeOk: true, fatal: ['x'] }).replace, 'fatal → не заменять');
  const emptyDay = mapAccrualDay({ tenantId: TENANT, accountId: ACCOUNT, day: DAY, accruals: [] as AccrualByDay[], offerBySku });
  expect(
    emptyDay.rows.length === 0 && decideAccrualDayWrite({ complete: true, shapeOk: true, fatal: emptyDay.fatal }).replace,
    'полный пустой день → заменить пустым (день без начислений)',
  );

  console.log('\n# planAccrualWindow');
  {
    const p = planAccrualWindow({ todayMsk: '2026-11-18' });
    expect(p.from === '2026-09-01' && p.to === '2026-11-18', 'по умолчанию: с 1-го числа позапрошлого месяца по сегодня');
    expect(p.days.length === 79 && p.days[0] === '2026-11-18' && p.days[78] === '2026-09-01', '79 дней, от новых к старым');
    expect(!p.error && p.problems.length === 0, 'без замечаний');
  }
  {
    const p = planAccrualWindow({ todayMsk: '2026-01-05' });
    expect(p.from === '2025-11-01', 'через границу года: 2026-01-05 → с 2025-11-01');
  }
  {
    const p = planAccrualWindow({ todayMsk: '2026-11-18', overrideFrom: '2026-10-01', overrideTo: '2026-10-03' });
    expect(p.days.join(',') === '2026-10-03,2026-10-02,2026-10-01', 'override включительно');
  }
  {
    const p = planAccrualWindow({ todayMsk: '2026-11-18', overrideFrom: '2026-11-17', overrideTo: '2026-11-25' });
    expect(p.to === '2026-11-18' && p.days.length === 2 && p.problems.length === 1, 'будущие дни отсечены с замечанием');
  }
  {
    const p = planAccrualWindow({ todayMsk: '2026-11-18', overrideFrom: '2021-12-30', overrideTo: '2022-01-02' });
    expect(p.from === ACCRUAL_EARLIEST_DATE && p.days.length === 2, 'раньше 2022-01-01 — сдвиг начала');
  }
  {
    const p = planAccrualWindow({ todayMsk: '2026-11-18', overrideFrom: '2024-01-01', overrideTo: '2026-11-18' });
    expect(
      p.days.length === MAX_ACCRUAL_WINDOW_DAYS && p.days[0] === '2026-11-18' && p.problems.some((x) => x.includes('лимит')),
      'длинный диапазон урезан до лимита с замечанием (свежие дни сохранены)',
    );
  }
  expect(!!planAccrualWindow({ todayMsk: '2026-11-18', overrideFrom: '2026-10-05', overrideTo: '2026-10-01' }).error, 'from > to → ошибка');
  expect(!!planAccrualWindow({ todayMsk: '2026-11-18', overrideFrom: '2026-10-05' }).error, 'задана одна граница → ошибка');
  expect(!!planAccrualWindow({ todayMsk: '2026-11-18', overrideFrom: '2026-02-30', overrideTo: '2026-03-01' }).error, 'несуществующая дата → ошибка');

  console.log('\n# mapAccrualTypes');
  {
    const r = mapAccrualTypes({ accrual_types: [{ description: 'string', id: 0, name: 'string' }] });
    expect(r.shapeOk && r.rows.length === 1 && r.rows[0].typeId === 0, 'пример справочника разбирается');
  }
  {
    const r = mapAccrualTypes({
      accrual_types: [
        { id: 11, name: 'Логистика', description: '' },
        { id: '11', name: 'Логистика (новое имя)' },
        { id: 'x', name: 'мусор' },
      ],
    });
    expect(r.rows.length === 1 && r.rows[0].name === 'Логистика (новое имя)' && r.rows[0].description === null, 'дубли id схлопнуты, пустое описание → null');
    expect(r.problems.length === 1, 'битый id → замечание');
  }
  expect(!mapAccrualTypes({}).shapeOk, 'нет accrual_types → форма не та (не «пустой справочник»)');

  console.log('\n# Набор стейджей');
  expect((OZON_FULL_STAGES as readonly string[]).includes('accruals'), 'accruals в полном синке');
  expect(!(OZON_FULL_STAGES as readonly string[]).includes('transactions'), 'transactions НЕ в полном синке');
  expect(
    (OZON_LEGACY_STAGES as readonly string[]).includes('transactions') && (OZON_ALL_STAGES as readonly string[]).includes('transactions'),
    'transactions сохранён как устаревший стейдж',
  );

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
