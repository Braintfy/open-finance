// PURPOSE: Оффлайн smoke-тесты маппинга /v2/warehouse/list и
// /v2/product/info/stocks-by-warehouse/fbs в строки ozon_warehouse_stocks
// (source='FBS'). Фикстуры — примеры ответов из справочника seller-api-docs.md
// (без сети и БД). Запуск: pnpm tsx scripts/test-ozon-fbs-stocks-map.ts

import {
  buildFbsStockInsertRows,
  collectCursorPages,
  parseStocksByWarehouseFbsPage,
  parseWarehouseListPage,
} from '../src/lib/marketplaces/ozon/fbs-stocks-map';
import {
  StocksByWarehouseFbsResponseSchema,
  WarehouseListResponseSchema,
} from '../src/lib/marketplaces/ozon/types';
import { OZON_API_VERSION_MAP } from '../src/lib/marketplaces/ozon/endpoints';

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

// Пример ответа /v2/warehouse/list из справочника (сокращён до используемых полей).
const WAREHOUSE_RESPONSE = {
  cursor: 'string',
  warehouses: [
    {
      is_rfbs: true,
      name: '17023',
      status: 'created',
      warehouse_type: 'string',
      warehouse_id: 20605650762000,
      is_kgt: true,
    },
  ],
  has_next: 'string',
};

// Пример ответа /v2/product/info/stocks-by-warehouse/fbs из справочника + вторая страница.
const STOCKS_RESPONSE = {
  cursor: 'string',
  has_next: true,
  products: [
    {
      free_stock: 4,
      offer_id: 'OFFER-1',
      present: 6,
      product_id: 111,
      reserved: 2,
      sku: 1001,
      warehouse_id: 20605650762000,
      warehouse_name: 'Мой склад',
    },
  ],
};

console.log('# версии методов');
expect(OZON_API_VERSION_MAP.warehouseList === '/v2/warehouse/list', 'warehouseList = /v2');
expect(
  OZON_API_VERSION_MAP.productStocksByWarehouseFbs === '/v2/product/info/stocks-by-warehouse/fbs',
  'productStocksByWarehouseFbs = /v2',
);

console.log('# /v2/warehouse/list');
expect(WarehouseListResponseSchema.safeParse(WAREHOUSE_RESPONSE).success, 'схема принимает пример справочника');
expect(
  !WarehouseListResponseSchema.safeParse({ result: [] }).success,
  'схема отвергает ответ без warehouses (ключевое поле обязательно)',
);
const wl = parseWarehouseListPage(WAREHOUSE_RESPONSE);
expect(wl.shapeOk && wl.items.length === 1, 'один склад распознан');
expect(wl.items[0]?.warehouseId === '20605650762000', 'warehouse_id int64 → строка');
expect(wl.items[0]?.warehouseType === 'rFBS', 'is_rfbs=true → rFBS');
expect(wl.items[0]?.name === '17023' && wl.items[0]?.status === 'created', 'name/status');
expect(wl.hasNext === false, 'has_next="string" не считается true');
expect(parseWarehouseListPage({ has_next: 'true', cursor: 'c', warehouses: [] }).hasNext === true, 'has_next="true" → true');
const wlBad = parseWarehouseListPage({ result: [] });
expect(!wlBad.shapeOk && wlBad.problems.length === 1, 'без warehouses → shapeOk=false + problem (не «складов нет»)');
const wlSkip = parseWarehouseListPage({ warehouses: [{ name: 'x' }, { warehouse_id: '5' }] });
expect(wlSkip.items.length === 1 && wlSkip.items[0]!.name === 'Склад 5', 'склад без id пропущен, без name → «Склад id»');
expect(wlSkip.problems.length === 1, 'пропуск склада попал в problems');

console.log('# /v2/product/info/stocks-by-warehouse/fbs');
expect(StocksByWarehouseFbsResponseSchema.safeParse(STOCKS_RESPONSE).success, 'схема принимает пример справочника');
expect(
  !StocksByWarehouseFbsResponseSchema.safeParse({ products: [{ sku: 1 }] }).success,
  'схема отвергает строку без warehouse_id/present/reserved',
);
const st = parseStocksByWarehouseFbsPage(STOCKS_RESPONSE);
expect(st.shapeOk && st.rows.length === 1 && st.hasNext && st.cursor === 'string', 'строка + курсор + has_next');
expect(st.rows[0]?.freeStock === 4 && st.rows[0]?.present === 6 && st.rows[0]?.reserved === 2, 'free_stock/present/reserved');
const stBad = parseStocksByWarehouseFbsPage({ result: [] });
expect(!stBad.shapeOk, 'без products → shapeOk=false');
const stSkip = parseStocksByWarehouseFbsPage({
  products: [{ sku: 1, warehouse_id: 2, present: 3 }, { sku: 1, warehouse_id: 2, present: 3, reserved: 0 }],
});
expect(stSkip.rows.length === 1 && stSkip.problems.length >= 1, 'строка без reserved пропущена с problem (не 0)');
expect(!stSkip.shapeOk, 'пропущено >10% строк → shapeOk=false (окно не заменять)');
const stOneOfMany = parseStocksByWarehouseFbsPage({
  products: [
    ...Array.from({ length: 19 }, (_, i) => ({ sku: i + 1, warehouse_id: 2, present: 3, reserved: 0 })),
    { sku: 99, warehouse_id: 2, present: 3 },
  ],
});
expect(stOneOfMany.shapeOk && stOneOfMany.rows.length === 19 && stOneOfMany.problems.length === 1, '1 из 20 пропущена → warning, shapeOk=true');
const stStr = parseStocksByWarehouseFbsPage({ products: [{ sku: '1', warehouse_id: '2', present: '5', reserved: '2', free_stock: '3' }] });
expect(stStr.rows[0]?.present === 5 && stStr.rows[0]?.reserved === 2 && stStr.rows[0]?.freeStock === 3, 'числовые строки present/reserved/free_stock принимаются');
expect(StocksByWarehouseFbsResponseSchema.safeParse({ products: [{ sku: 1, warehouse_id: 2, present: '5', reserved: '2' }] }).success, 'схема принимает числовые строки');
const stEmpty = parseStocksByWarehouseFbsPage({});
expect(stEmpty.shapeOk && stEmpty.rows.length === 0 && !stEmpty.hasNext, 'пустой объект без products и has_next → пустая страница');
expect(!parseStocksByWarehouseFbsPage({ has_next: true, cursor: 'x' }).shapeOk, 'has_next=true без products → shapeOk=false');
expect(!parseStocksByWarehouseFbsPage({ products: 'x' }).shapeOk, 'products не массив → shapeOk=false');
const stNoFree = parseStocksByWarehouseFbsPage({
  products: [{ sku: '7', warehouse_id: '9', present: 5, reserved: 1 }],
});
expect(stNoFree.rows[0]?.freeStock === null, 'нет free_stock → null');

console.log('# строки ozon_warehouse_stocks');
const warehousesById = new Map(wl.items.map((w) => [w.warehouseId, w]));
const ins = buildFbsStockInsertRows({
  tenantId: 't1',
  accountId: 'a1',
  stocks: [...st.rows, ...stNoFree.rows],
  warehousesById,
  offerBySku: new Map([['1001', 'CATALOG-OFFER']]),
});
expect(ins.length === 2, '2 строки');
const r0 = ins[0]!;
expect(r0.tenantId === 't1' && r0.accountId === 'a1', 'tenant/account проставлены');
expect(r0.source === 'FBS' && r0.clusterId === null && r0.clusterName === null, "source='FBS', без кластера");
expect(r0.warehouseId === 20605650762000, 'warehouse_id числом');
expect(r0.warehouseType === 'rFBS' && r0.warehouseName === 'Мой склад', 'тип из справочника, имя из остатков');
expect(r0.freeToSellAmount === 4 && r0.reservedAmount === 2 && r0.promisedAmount === 0, 'free_stock → доступно, reserved, promised=0');
expect(r0.offerId === 'CATALOG-OFFER', 'offer_id из каталога приоритетнее');
const r1 = ins[1]!;
expect(r1.freeToSellAmount === 4, 'без free_stock fallback = present − reserved (резерв не задваивается)');
expect(r1.warehouseType === 'FBS' && r1.warehouseName === 'Склад 9', 'склад вне справочника: FBS и «Склад id»');
expect(r1.offerId === null, 'offer_id нет нигде → null');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
