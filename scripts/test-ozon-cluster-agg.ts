// PURPOSE: Smoke-тест агрегации блока «Ozon · Остатки по кластерам».
//
// Часть 1 — unit-тесты pure-модуля `cluster-agg.ts` (без БД): резолв
// склад→кластер, регистро-независимость, разделение «Без кластера» /
// «Склад не указан», объединение кластеров с остатком и кластеров с
// заказами, distinct-семантика SKU.
//
// Часть 1b (Этап 2a) — разрез `groupBy='warehouse'`: иерархия кластер→склады,
// инвариант «строка кластера == Σ её складов», объединение «склады с
// остатком ∪ склады с заказами», лимит топ-N со свёрнутым хвостом.
//
// Часть 1c (Этап 2b) — источник FBO/FBS: псевдо-строка «FBS (свои склады)»,
// раздельность её и «Без кластера», резолв заказов с FBS-складов, разбиение
// `all == FBO + FBS`.
//
// Часть 2 — прогон боевого `loadOzonClusterStocks()` на дев-БД (read-only)
// плюс сравнение со СТАРОЙ логикой (raw->>'warehouseName' + case-sensitive
// JOIN через снапшот остатков), чтобы видеть распределение выручки ДО/ПОСЛЕ.
//
// Запуск:
//   pnpm tsx scripts/test-ozon-cluster-agg.ts            # unit + live (все ozon-аккаунты)
//   pnpm tsx scripts/test-ozon-cluster-agg.ts --unit     # только unit, без БД
//   pnpm tsx scripts/test-ozon-cluster-agg.ts <accountId>
//
// Скрипт read-only (write в БД не делает). exit 1 при провале unit-теста.

import { eq, sql } from 'drizzle-orm';
import {
  attachWarehousesToClusters,
  buildClusterRows,
  isStockSourceFilter,
  normalizeWarehouseName,
  resolveOrdersToClusters,
  resolveOrdersToWarehouses,
  FBS_LABEL,
  FBS_ROW_KEY,
  NO_CLUSTER_LABEL,
  NO_WAREHOUSE_LABEL,
  type ClusterAggRow,
  type ClusterRef,
  type ClusterStockAgg,
  type OrdersByWarehouse,
  type WarehouseStockAgg,
} from '../src/lib/marketplaces/ozon/cluster-agg';

let failures = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function eq2(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

// ---------------------------------------------------------------- unit tests

/**
 * Общие фикстуры для cluster- и warehouse-тестов: важно, чтобы обе части
 * гоняли ОДНИ И ТЕ ЖЕ данные — иначе инвариант «кластер == Σ складов»
 * проверялся бы на разных мирах.
 */
function buildFixtures() {
  // Справочник специально в «чужом» регистре — так и приходит из cluster/list.
  const directory = new Map<string, ClusterRef>([
    [
      normalizeWarehouseName('Екатеринбург_РФЦ_НОВЫЙ'),
      {
        clusterId: '176',
        clusterName: 'Екатеринбург',
        clusterType: 'OZON',
        warehouseName: 'Екатеринбург_РФЦ_НОВЫЙ',
      },
    ],
    [
      normalizeWarehouseName('ПЕТРОВСКОЕ_РФЦ'),
      {
        clusterId: '154',
        clusterName: 'Москва, МО и Дальние регионы',
        clusterType: 'OZON',
        warehouseName: 'Петровское_РФЦ',
      },
    ],
    [
      normalizeWarehouseName('МИНСК_МПСЦ'),
      {
        clusterId: '900',
        clusterName: 'Минск',
        clusterType: 'CIS',
        warehouseName: 'Минск_МПСЦ',
      },
    ],
  ]);
  const stockFallback = new Map<string, ClusterRef>([
    [
      normalizeWarehouseName('Новосибирск_РФЦ_НОВЫЙ'),
      {
        clusterId: '151',
        clusterName: 'Новосибирск',
        clusterType: 'OZON',
        warehouseName: 'Новосибирск_РФЦ_НОВЫЙ',
      },
    ],
  ]);

  const orders: OrdersByWarehouse[] = [
    // регистр из postings отличается от справочника
    { warehouseName: 'ЕКАТЕРИНБУРГ_РФЦ_НОВЫЙ', orders: 3, revenueRub: 3000 },
    { warehouseName: 'ПЕТРОВСКОЕ_РФЦ', orders: 10, revenueRub: 10000 },
    // резолв только через снапшот остатков (в справочнике нет)
    { warehouseName: 'НОВОСИБИРСК_РФЦ_НОВЫЙ', orders: 1, revenueRub: 500 },
    // CIS-кластер
    { warehouseName: 'МИНСК_МПСЦ', orders: 2, revenueRub: 700 },
    // склада нет нигде
    { warehouseName: 'НЕИЗВЕСТНЫЙ_РФЦ', orders: 4, revenueRub: 900 },
    // FBS: имени склада нет вовсе
    { warehouseName: null, orders: 7, revenueRub: 1800 },
  ];

  // Cluster-агрегат: skuCount = COUNT(DISTINCT sku) в пределах кластера.
  const stocks: ClusterStockAgg[] = [
    {
      clusterId: '154',
      clusterName: 'Москва, МО и Дальние регионы',
      clusterType: 'OZON',
      free: 100,
      promised: 10,
      reserved: 5,
      skuCount: 12,
    },
    // кластер с остатком, но без продаж
    {
      clusterId: '2',
      clusterName: 'Санкт-Петербург и СЗО',
      clusterType: 'OZON',
      free: 50,
      promised: 0,
      reserved: 0,
      skuCount: 8,
    },
  ];

  // Тот же снапшот, но с разбивкой по складам. Суммы остатков совпадают
  // с cluster-агрегатом; skuCount — НЕТ (8+7=15 против distinct 12):
  // один SKU лежит на обоих складах кластера.
  const warehouseStocks: WarehouseStockAgg[] = [
    {
      warehouseName: 'Петровское_РФЦ',
      clusterId: '154',
      clusterName: 'Москва, МО и Дальние регионы',
      clusterType: 'OZON',
      free: 60,
      promised: 5,
      reserved: 3,
      skuCount: 8,
    },
    {
      warehouseName: 'Хоругвино_РФЦ',
      clusterId: '154',
      clusterName: 'Москва, МО и Дальние регионы',
      clusterType: 'OZON',
      free: 40,
      promised: 5,
      reserved: 2,
      skuCount: 7,
    },
    {
      warehouseName: 'Санкт-Петербург_РФЦ',
      clusterId: '2',
      clusterName: 'Санкт-Петербург и СЗО',
      clusterType: 'OZON',
      free: 50,
      promised: 0,
      reserved: 0,
      skuCount: 8,
    },
  ];

  return { directory, stockFallback, orders, stocks, warehouseStocks };
}

function runUnitTests(): void {
  console.log('\n=== Unit: cluster-agg ===');

  const { directory, stockFallback, orders, stocks } = buildFixtures();

  check(
    'normalizeWarehouseName приводит кириллицу к нижнему регистру',
    normalizeWarehouseName(' Екатеринбург_РФЦ ') === 'екатеринбург_рфц',
    normalizeWarehouseName(' Екатеринбург_РФЦ '),
  );
  check(
    'normalizeWarehouseName схлопывает разделители (- / пробел / _)',
    normalizeWarehouseName('РОСТОВ-НА-ДОНУ_РФЦ') ===
      normalizeWarehouseName('Ростов_на_Дону_РФЦ') &&
      normalizeWarehouseName('НИЖНИЙ НОВГОРОД_СППЗ') === 'нижний_новгород_сппз',
    normalizeWarehouseName('РОСТОВ-НА-ДОНУ_РФЦ'),
  );

  const resolved = resolveOrdersToClusters(orders, directory, stockFallback);

  check(
    'регистро-независимый резолв через справочник',
    resolved.byClusterId.get('176')?.revenue === 3000,
    JSON.stringify(resolved.byClusterId.get('176')),
  );
  check(
    'fallback на снапшот остатков',
    resolved.byClusterId.get('151')?.revenue === 500,
    JSON.stringify(resolved.byClusterId.get('151')),
  );
  check('CIS-кластер резолвится', resolved.byClusterId.get('900')?.orders === 2);
  check(
    '«склад неизвестен» отделён от «склад не указан»',
    resolved.unknownWarehouse.revenue === 900 && resolved.noWarehouse.revenue === 1800,
    `unknown=${resolved.unknownWarehouse.revenue}, noWh=${resolved.noWarehouse.revenue}`,
  );
  check(
    'нерезолвящийся склад попал в диагностику',
    resolved.unresolvedWarehouses.length === 1 &&
      resolved.unresolvedWarehouses[0] === 'НЕИЗВЕСТНЫЙ_РФЦ',
    JSON.stringify(resolved.unresolvedWarehouses),
  );

  const rows = buildClusterRows(stocks, resolved);
  const byName = new Map(rows.map((r) => [r.clusterName, r]));

  check(
    'кластер с остатком получает выручку',
    byName.get('Москва, МО и Дальние регионы')?.revenueInPeriod === 10000,
  );
  check(
    'кластер с продажами, но без остатка, появляется строкой (выбит в ноль)',
    byName.get('Екатеринбург')?.totalStock === 0 &&
      byName.get('Екатеринбург')?.revenueInPeriod === 3000,
    JSON.stringify(byName.get('Екатеринбург')),
  );
  check(
    'кластер с остатком, но без продаж, сохраняется',
    byName.get('Санкт-Петербург и СЗО')?.totalStock === 50 &&
      byName.get('Санкт-Петербург и СЗО')?.ordersInPeriod === 0,
  );
  check(
    '«Без кластера» и «Склад не указан» — РАЗНЫЕ строки',
    byName.get(NO_CLUSTER_LABEL)?.revenueInPeriod === 900 &&
      byName.get(NO_WAREHOUSE_LABEL)?.revenueInPeriod === 1800,
    rows.map((r) => `${r.clusterName}=${r.revenueInPeriod}`).join(', '),
  );

  const totalRevenue = rows.reduce((s, r) => s + r.revenueInPeriod, 0);
  const inputRevenue = orders.reduce((s, o) => s + o.revenueRub, 0);
  check(
    'выручка сохраняется без потерь',
    eq2(totalRevenue, inputRevenue),
    `rows=${totalRevenue} vs input=${inputRevenue}`,
  );

  const totalOrders = rows.reduce((s, r) => s + r.ordersInPeriod, 0);
  check(
    'заказы сохраняются без потерь',
    totalOrders === orders.reduce((s, o) => s + o.orders, 0),
  );

  const share = rows.reduce((s, r) => s + r.sharePct, 0);
  check('sharePct суммируется в 100%', eq2(share, 100), String(share));

  // Регрессия старого бага: если бы резолв шёл только через остатки,
  // всё, кроме Москвы/Новосибирска, упало бы в «Без кластера».
  const onlyViaStocks = resolveOrdersToClusters(orders, new Map(), stockFallback);
  check(
    'регрессия: без справочника выручка действительно уезжает в «Без кластера»',
    onlyViaStocks.unknownWarehouse.revenue === 3000 + 10000 + 700 + 900,
    String(onlyViaStocks.unknownWarehouse.revenue),
  );

  // Пустой период — заказов нет, строки только из остатков.
  const stockOnly = buildClusterRows(stocks, null);
  check(
    'без периода строки строятся только из остатков',
    stockOnly.length === 2 && stockOnly.every((r) => r.ordersInPeriod === 0),
  );
}

// ------------------------------------------------ unit tests: groupBy=warehouse

/** Σ метрик показанных складов + свёрнутый хвост. */
function sumWarehouses(row: ClusterAggRow) {
  const acc = {
    freeStock: 0,
    promisedStock: 0,
    reservedStock: 0,
    totalStock: 0,
    ordersInPeriod: 0,
    revenueInPeriod: 0,
    sharePct: 0,
    count: 0,
  };
  for (const w of row.warehouses ?? []) {
    acc.freeStock += w.freeStock;
    acc.promisedStock += w.promisedStock;
    acc.reservedStock += w.reservedStock;
    acc.totalStock += w.totalStock;
    acc.ordersInPeriod += w.ordersInPeriod;
    acc.revenueInPeriod += w.revenueInPeriod;
    acc.sharePct += w.sharePct;
    acc.count += 1;
  }
  const h = row.hiddenWarehouses;
  if (h) {
    acc.freeStock += h.freeStock;
    acc.promisedStock += h.promisedStock;
    acc.reservedStock += h.reservedStock;
    acc.totalStock += h.totalStock;
    acc.ordersInPeriod += h.ordersInPeriod;
    acc.revenueInPeriod += h.revenueInPeriod;
    acc.sharePct += h.sharePct;
    acc.count += h.count;
  }
  return acc;
}

function runWarehouseUnitTests(): void {
  console.log('\n=== Unit: cluster-agg · groupBy=warehouse ===');

  const { directory, stockFallback, orders, stocks, warehouseStocks } = buildFixtures();

  const buckets = resolveOrdersToWarehouses(orders, directory, stockFallback);
  const clusterRows = buildClusterRows(stocks, resolveOrdersToClusters(orders, directory, stockFallback));
  const rows = attachWarehousesToClusters(clusterRows, warehouseStocks, buckets);
  const byName = new Map(rows.map((r) => [r.clusterName, r]));

  check(
    'иерархия: у каждой строки кластера появился список складов',
    rows.every((r) => Array.isArray(r.warehouses)),
  );

  const moscow = byName.get('Москва, МО и Дальние регионы');
  check(
    'кластер разложен по своим складам (2 шт)',
    moscow?.warehousesTotal === 2 &&
      (moscow?.warehouses ?? []).map((w) => w.warehouseName).sort().join(',') ===
        'Петровское_РФЦ,Хоругвино_РФЦ',
    JSON.stringify((moscow?.warehouses ?? []).map((w) => w.warehouseName)),
  );

  // Главный инвариант этапа 2a.
  let invariantOk = true;
  let invariantDetail = '';
  for (const row of rows) {
    const s = sumWarehouses(row);
    const ok =
      eq2(s.freeStock, row.freeStock) &&
      eq2(s.promisedStock, row.promisedStock) &&
      eq2(s.reservedStock, row.reservedStock) &&
      eq2(s.totalStock, row.totalStock) &&
      eq2(s.ordersInPeriod, row.ordersInPeriod) &&
      eq2(s.revenueInPeriod, row.revenueInPeriod) &&
      eq2(s.sharePct, row.sharePct);
    if (!ok) {
      invariantOk = false;
      invariantDetail = `${row.clusterName}: складов=${JSON.stringify(s)} vs кластер=${row.totalStock}/${row.revenueInPeriod}`;
    }
  }
  check('инвариант: Σ складов == строка кластера (все метрики)', invariantOk, invariantDetail);

  check(
    'skuCount складов НЕ складывается в distinct кластера (8+7 > 12)',
    (moscow?.warehouses ?? []).reduce((s, w) => s + w.skuCount, 0) === 15 &&
      moscow?.skuCount === 12,
  );

  // Объединение «остатки ∪ заказы» на уровне складов.
  const ekb = byName.get('Екатеринбург');
  check(
    'склад с продажами и БЕЗ остатка виден строкой (остаток 0, выручка > 0)',
    ekb?.warehousesTotal === 1 &&
      ekb?.warehouses?.[0]?.totalStock === 0 &&
      ekb?.warehouses?.[0]?.revenueInPeriod === 3000,
    JSON.stringify(ekb?.warehouses),
  );
  check(
    'имя склада берётся каноническое из справочника, не КАПС из постингов',
    ekb?.warehouses?.[0]?.warehouseName === 'Екатеринбург_РФЦ_НОВЫЙ',
    ekb?.warehouses?.[0]?.warehouseName,
  );

  const spb = byName.get('Санкт-Петербург и СЗО');
  check(
    'склад с остатком и БЕЗ продаж сохраняется',
    spb?.warehousesTotal === 1 &&
      spb?.warehouses?.[0]?.totalStock === 50 &&
      spb?.warehouses?.[0]?.ordersInPeriod === 0,
  );

  const noCluster = byName.get(NO_CLUSTER_LABEL);
  check(
    '«Без кластера» разложен на конкретные нерезолвнутые склады',
    noCluster?.warehousesTotal === 1 &&
      noCluster?.warehouses?.[0]?.warehouseName === 'НЕИЗВЕСТНЫЙ_РФЦ' &&
      noCluster?.warehouses?.[0]?.revenueInPeriod === 900,
    JSON.stringify(noCluster?.warehouses),
  );
  const noWarehouse = byName.get(NO_WAREHOUSE_LABEL);
  check(
    '«Склад не указан» — одна псевдо-строка склада',
    noWarehouse?.warehousesTotal === 1 &&
      noWarehouse?.warehouses?.[0]?.revenueInPeriod === 1800,
  );

  // Регистр: тот же склад двумя написаниями схлопывается в ОДНУ строку.
  const dupBuckets = resolveOrdersToWarehouses(
    [
      { warehouseName: 'ПЕТРОВСКОЕ_РФЦ', orders: 2, revenueRub: 2000 },
      { warehouseName: 'Петровское-РФЦ', orders: 3, revenueRub: 3000 },
    ],
    directory,
    stockFallback,
  );
  check(
    'разные написания одного склада схлопываются в одну строку',
    dupBuckets.length === 1 &&
      dupBuckets[0].orders === 5 &&
      dupBuckets[0].revenue === 5000,
    JSON.stringify(dupBuckets),
  );

  // Лимит топ-N + свёрнутый хвост.
  const limited = attachWarehousesToClusters(clusterRows, warehouseStocks, buckets, {
    limitPerCluster: 1,
  });
  const moscowLimited = limited.find(
    (r) => r.clusterName === 'Москва, МО и Дальние регионы',
  );
  check(
    'лимит топ-N режет список складов',
    moscowLimited?.warehouses?.length === 1 && moscowLimited?.warehousesTotal === 2,
    JSON.stringify(moscowLimited?.warehouses?.map((w) => w.warehouseName)),
  );
  check(
    'топ-N по умолчанию — по остатку (первым идёт больший склад)',
    moscowLimited?.warehouses?.[0]?.warehouseName === 'Петровское_РФЦ',
    moscowLimited?.warehouses?.[0]?.warehouseName,
  );
  check(
    'хвост свёрнут в hiddenWarehouses и инвариант сумм сохраняется',
    moscowLimited?.hiddenWarehouses?.count === 1 &&
      eq2(sumWarehouses(moscowLimited!).totalStock, moscowLimited!.totalStock) &&
      eq2(sumWarehouses(moscowLimited!).revenueInPeriod, moscowLimited!.revenueInPeriod),
    JSON.stringify(moscowLimited?.hiddenWarehouses),
  );

  // Сортировка топ-N по выручке: склад, выбитый в ноль, не должен теряться.
  const byRevenue = attachWarehousesToClusters(
    clusterRows,
    warehouseStocks,
    buckets,
    { limitPerCluster: 1, sortKey: 'revenueInPeriod', sortDir: 'desc' },
  );
  const moscowByRevenue = byRevenue.find(
    (r) => r.clusterName === 'Москва, МО и Дальние регионы',
  );
  check(
    'сортировка топ-N по выручке меняет отбор складов',
    moscowByRevenue?.warehouses?.[0]?.revenueInPeriod === 10000,
    JSON.stringify(moscowByRevenue?.warehouses),
  );

  // Строки кластеров одинаковы в обоих разрезах — иначе toggle «Кластеры |
  // Склады» показывал бы разные цифры на одном и том же периоде.
  const strip = (r: ClusterAggRow) => {
    const { warehouses: _w, warehousesTotal: _t, hiddenWarehouses: _h, ...rest } = r;
    return rest;
  };
  check(
    'цифры кластеров идентичны в обоих разрезах (groupBy не влияет на итоги)',
    JSON.stringify(clusterRows.map(strip)) === JSON.stringify(rows.map(strip)),
  );

  // Без периода (только остатки) режим складов тоже работает.
  const noPeriod = attachWarehousesToClusters(
    buildClusterRows(stocks, null),
    warehouseStocks,
    null,
  );
  check(
    'без периода склады строятся только из остатков',
    noPeriod.length === 2 &&
      noPeriod.every((r) => (r.warehouses ?? []).every((w) => w.ordersInPeriod === 0)) &&
      noPeriod.reduce((s, r) => s + (r.warehousesTotal ?? 0), 0) === 3,
  );
}

// ------------------------------------------- unit tests: источник FBO/FBS (2b)

/**
 * Фикстуры Этапа 2b: к FBO-миру добавлены собственные склады продавца.
 * У FBS-строк `clusterId === null` — ровно как в снапшоте (стейдж
 * `fbsWarehouseStocks` кластеры не резолвит).
 */
function buildSourceFixtures() {
  const base = buildFixtures();

  const fbsWarehouses = new Set(
    ['Мой склад Москва', 'Мой склад Казань'].map(normalizeWarehouseName),
  );

  const fbsClusterStocks: ClusterStockAgg[] = [
    {
      clusterId: null,
      clusterName: null,
      clusterType: null,
      source: 'FBS',
      free: 30,
      promised: 0,
      reserved: 4,
      skuCount: 5,
    },
  ];
  // Нерезолвнутый FBO-склад: должен остаться в «Без кластера», а не уехать
  // в строку FBS — это два разных смысла.
  const unresolvedFboStocks: ClusterStockAgg[] = [
    {
      clusterId: null,
      clusterName: null,
      clusterType: null,
      source: 'FBO',
      free: 7,
      promised: 0,
      reserved: 0,
      skuCount: 2,
    },
  ];

  const fbsWarehouseStocks: WarehouseStockAgg[] = [
    {
      warehouseName: 'Мой склад Москва',
      clusterId: null,
      clusterName: null,
      clusterType: null,
      source: 'FBS',
      free: 20,
      promised: 0,
      reserved: 4,
      skuCount: 4,
    },
    {
      warehouseName: 'Мой склад Казань',
      clusterId: null,
      clusterName: null,
      clusterType: null,
      source: 'FBS',
      free: 10,
      promised: 0,
      reserved: 0,
      skuCount: 1,
    },
  ];

  // Тот же нерезолвнутый FBO-остаток, но в разрезе склада: без него
  // инвариант «Σ складов == строка» падал бы из-за дырки в фикстуре, а не
  // из-за кода (в бою оба среза считаются из одной и той же таблицы).
  const unresolvedFboWarehouseStocks: WarehouseStockAgg[] = [
    {
      warehouseName: 'НЕИЗВЕСТНЫЙ_РФЦ',
      clusterId: null,
      clusterName: null,
      clusterType: null,
      source: 'FBO',
      free: 7,
      promised: 0,
      reserved: 0,
      skuCount: 2,
    },
  ];

  const fbsOrders: OrdersByWarehouse[] = [
    { warehouseName: 'МОЙ СКЛАД МОСКВА', orders: 6, revenueRub: 4200 },
  ];

  return {
    ...base,
    fbsWarehouses,
    fbsClusterStocks,
    unresolvedFboStocks,
    unresolvedFboWarehouseStocks,
    fbsWarehouseStocks,
    fbsOrders,
  };
}

function runSourceUnitTests(): void {
  console.log('\n=== Unit: cluster-agg · источник FBO/FBS (Этап 2b) ===');

  const {
    directory,
    stockFallback,
    orders,
    stocks,
    warehouseStocks,
    fbsWarehouses,
    fbsClusterStocks,
    unresolvedFboStocks,
    unresolvedFboWarehouseStocks,
    fbsWarehouseStocks,
    fbsOrders,
  } = buildSourceFixtures();

  check(
    'isStockSourceFilter принимает all/FBO/FBS и режет мусор',
    isStockSourceFilter('all') &&
      isStockSourceFilter('FBO') &&
      isStockSourceFilter('FBS') &&
      !isStockSourceFilter('fbs') &&
      !isStockSourceFilter('drop table'),
  );

  // ---- source='all': оба источника в одной таблице ----
  const allStocks = [...stocks, ...unresolvedFboStocks, ...fbsClusterStocks];
  const allOrders = [...orders, ...fbsOrders];
  const resolvedAll = resolveOrdersToClusters(
    allOrders,
    directory,
    stockFallback,
    fbsWarehouses,
  );
  const rowsAll = buildClusterRows(allStocks, resolvedAll);
  const byNameAll = new Map(rowsAll.map((r) => [r.clusterName, r]));

  const fbsRow = byNameAll.get(FBS_LABEL);
  check(
    'FBS-остатки уходят в отдельную строку «FBS (свои склады)»',
    fbsRow?.rowKey === FBS_ROW_KEY && fbsRow?.totalStock === 34,
    JSON.stringify(fbsRow),
  );
  check(
    'заказы с FBS-склада попадают в ту же строку, а не в «Без кластера»',
    fbsRow?.ordersInPeriod === 6 && fbsRow?.revenueInPeriod === 4200,
    JSON.stringify(fbsRow),
  );
  check(
    'нерезолвнутый FBO-склад остаётся в «Без кластера» (смыслы не смешаны)',
    byNameAll.get(NO_CLUSTER_LABEL)?.totalStock === 7 &&
      byNameAll.get(NO_CLUSTER_LABEL)?.revenueInPeriod === 900,
    JSON.stringify(byNameAll.get(NO_CLUSTER_LABEL)),
  );
  check(
    'FBS-склад не попал в диагностику «нерезолвящиеся склады»',
    !resolvedAll.unresolvedWarehouses.includes('МОЙ СКЛАД МОСКВА'),
    JSON.stringify(resolvedAll.unresolvedWarehouses),
  );

  const totalRevenueAll = rowsAll.reduce((s, r) => s + r.revenueInPeriod, 0);
  check(
    'выручка обоих источников сохраняется без потерь',
    eq2(totalRevenueAll, allOrders.reduce((s, o) => s + o.revenueRub, 0)),
    String(totalRevenueAll),
  );

  // ---- source='FBO' / 'FBS': фильтр отдаёт непересекающиеся половины ----
  // Фильтр физически живёт в SQL (cluster-stocks-query), здесь эмулируем его
  // ровно тем же способом: срез входа по source + по scheme заказа.
  const rowsFbo = buildClusterRows(
    allStocks.filter((s) => (s.source ?? 'FBO') === 'FBO'),
    resolveOrdersToClusters(orders, directory, stockFallback, fbsWarehouses),
  );
  const rowsFbs = buildClusterRows(
    allStocks.filter((s) => s.source === 'FBS'),
    resolveOrdersToClusters(fbsOrders, directory, stockFallback, fbsWarehouses),
  );

  check(
    'source=FBO не показывает строку FBS',
    rowsFbo.every((r) => r.rowKey !== FBS_ROW_KEY),
    rowsFbo.map((r) => r.clusterName).join(', '),
  );
  check(
    'source=FBS показывает ТОЛЬКО свои склады',
    rowsFbs.length === 1 &&
      rowsFbs[0].rowKey === FBS_ROW_KEY &&
      rowsFbs[0].totalStock === 34 &&
      rowsFbs[0].revenueInPeriod === 4200,
    JSON.stringify(rowsFbs),
  );
  check(
    'FBO + FBS == all (остаток и выручка бьются)',
    eq2(
      rowsFbo.reduce((s, r) => s + r.totalStock, 0) +
        rowsFbs.reduce((s, r) => s + r.totalStock, 0),
      rowsAll.reduce((s, r) => s + r.totalStock, 0),
    ) &&
      eq2(
        rowsFbo.reduce((s, r) => s + r.revenueInPeriod, 0) +
          rowsFbs.reduce((s, r) => s + r.revenueInPeriod, 0),
        totalRevenueAll,
      ),
  );
  check(
    'sharePct пересчитывается от знаменателя своего среза (FBS = 100%)',
    eq2(rowsFbs[0].sharePct, 100),
    String(rowsFbs[0]?.sharePct),
  );

  // ---- groupBy=warehouse: FBS-строка тоже раскрывается по складам ----
  const bucketsAll = resolveOrdersToWarehouses(
    allOrders,
    directory,
    stockFallback,
    fbsWarehouses,
  );
  const hierarchical = attachWarehousesToClusters(
    rowsAll,
    [...warehouseStocks, ...unresolvedFboWarehouseStocks, ...fbsWarehouseStocks],
    bucketsAll,
  );
  const fbsHier = hierarchical.find((r) => r.rowKey === FBS_ROW_KEY);
  check(
    'строка FBS раскрывается на конкретные склады продавца',
    fbsHier?.warehousesTotal === 2 &&
      (fbsHier?.warehouses ?? [])
        .map((w) => w.warehouseName)
        .sort()
        .join(',') === 'Мой склад Казань,Мой склад Москва',
    JSON.stringify((fbsHier?.warehouses ?? []).map((w) => w.warehouseName)),
  );
  check(
    'заказ с FBS-склада лёг именно на свой склад (регистр не помешал)',
    (fbsHier?.warehouses ?? []).find((w) => w.warehouseName === 'Мой склад Москва')
      ?.revenueInPeriod === 4200,
    JSON.stringify(fbsHier?.warehouses),
  );

  let invariantOk = true;
  let invariantDetail = '';
  for (const row of hierarchical) {
    const s = sumWarehouses(row);
    if (
      !eq2(s.totalStock, row.totalStock) ||
      !eq2(s.ordersInPeriod, row.ordersInPeriod) ||
      !eq2(s.revenueInPeriod, row.revenueInPeriod)
    ) {
      invariantOk = false;
      invariantDetail = `${row.clusterName}: Σскладов=${s.totalStock}/${s.ordersInPeriod}/${s.revenueInPeriod} vs кластер=${row.totalStock}/${row.ordersInPeriod}/${row.revenueInPeriod}`;
    }
  }
  check(
    'инвариант «Σ складов == строка» держится и с FBS в наборе',
    invariantOk,
    invariantDetail,
  );

  // Регрессия: без множества FBS-складов заказ с «Мой склад Москва» уезжает
  // в «Без кластера» и рвётся пополам с собственным остатком.
  const withoutFbsSet = resolveOrdersToClusters(allOrders, directory, stockFallback);
  check(
    'регрессия: без множества FBS-складов заказ уходит в «Без кластера»',
    withoutFbsSet.unknownWarehouse.revenue === 900 + 4200 &&
      withoutFbsSet.fbs.revenue === 0,
    String(withoutFbsSet.unknownWarehouse.revenue),
  );
}

// ---------------------------------------------------------------- live check

/** Старая (сломанная) логика — воспроизводим 1:1 для сравнения ДО/ПОСЛЕ. */
async function legacyDistribution(
  db: typeof import('../src/lib/db/client')['db'],
  tenantId: string,
  accountId: string,
  fromIso: string,
  toIso: string,
): Promise<{ noCluster: { orders: number; revenue: number }; clustered: number }> {
  const res = await db.execute<{
    cluster_key: string;
    orders: number;
    revenue_rub: number;
  }>(sql`
    WITH order_items AS (
      SELECT
        o.id,
        (o.raw->>'warehouseName')::text AS warehouse_name,
        COALESCE(NULLIF(it->>'price', '')::numeric, 0) AS price_rub,
        COALESCE(NULLIF(it->>'quantity', '')::numeric, 0) AS qty
      FROM ozon_orders o
      CROSS JOIN LATERAL jsonb_array_elements(o.items) AS it
      WHERE o.tenant_id = ${tenantId} AND o.account_id = ${accountId}
        AND o.order_created_at >= ${fromIso}::timestamp
        AND o.order_created_at < ${toIso}::timestamp
        AND o.cancelled_at IS NULL AND o.returned_at IS NULL
    ),
    order_sums AS (
      SELECT id, warehouse_name, SUM(price_rub * qty) AS total_rub
      FROM order_items GROUP BY id, warehouse_name
    ),
    warehouse_cluster AS (
      SELECT DISTINCT ON (ws.warehouse_name) ws.warehouse_name, ws.cluster_id
      FROM ozon_warehouse_stocks ws
      WHERE ws.tenant_id = ${tenantId} AND ws.account_id = ${accountId}
    )
    SELECT
      COALESCE(wc.cluster_id, '__none__') AS cluster_key,
      COUNT(DISTINCT os.id)::int AS orders,
      COALESCE(SUM(os.total_rub), 0)::numeric AS revenue_rub
    FROM order_sums os
    LEFT JOIN warehouse_cluster wc ON wc.warehouse_name = os.warehouse_name
    GROUP BY COALESCE(wc.cluster_id, '__none__')
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows ?? []) as Array<{
    cluster_key: string;
    orders: number;
    revenue_rub: number;
  }>;
  let noCluster = { orders: 0, revenue: 0 };
  let clustered = 0;
  for (const r of rows) {
    if (r.cluster_key === '__none__') {
      noCluster = { orders: Number(r.orders), revenue: Number(r.revenue_rub) };
    } else {
      clustered += Number(r.revenue_rub);
    }
  }
  return { noCluster, clustered };
}

async function runLive(filterAccountId: string | null): Promise<void> {
  const { db } = await import('../src/lib/db/client');
  const { marketplaceAccounts } = await import('../src/lib/db/schema/marketplaces');
  const { loadOzonClusterStocks } = await import(
    '../src/lib/marketplaces/ozon/cluster-stocks-query'
  );

  const accounts = await db
    .select({
      id: marketplaceAccounts.id,
      tenantId: marketplaceAccounts.tenantId,
      name: marketplaceAccounts.name,
    })
    .from(marketplaceAccounts)
    .where(
      filterAccountId
        ? eq(marketplaceAccounts.id, filterAccountId)
        : eq(marketplaceAccounts.marketplace, 'ozon'),
    );

  if (accounts.length === 0) {
    console.log('\n=== Live: Ozon-аккаунтов нет, пропускаем ===');
    return;
  }

  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  for (const acc of accounts) {
    console.log(`\n=== Live: ${acc.name ?? acc.id} (30 дней) ===`);
    const before = await legacyDistribution(db, acc.tenantId, acc.id, fromIso, toIso);
    const after = await loadOzonClusterStocks({
      tenantId: acc.tenantId,
      accountId: acc.id,
      fromIso,
      toIso,
    });

    const noClusterRow = after.rows.find((r) => r.clusterName === NO_CLUSTER_LABEL);
    const noWarehouseRow = after.rows.find((r) => r.clusterName === NO_WAREHOUSE_LABEL);
    const clusteredRevenue = after.rows
      .filter((r) => r.clusterId !== null)
      .reduce((s, r) => s + r.revenueInPeriod, 0);
    const totalRevenue = after.totals.revenueInPeriod;

    const fmt = (v: number) => Math.round(v).toLocaleString('ru-RU');
    console.log('  ДО  (старая логика):');
    console.log(
      `    «Без кластера»: ${fmt(before.noCluster.revenue)} ₽ / ${before.noCluster.orders} зак.`,
    );
    console.log(`    по кластерам:   ${fmt(before.clustered)} ₽`);
    console.log('  ПОСЛЕ:');
    console.log(
      `    по кластерам:      ${fmt(clusteredRevenue)} ₽ (${
        after.rows.filter((r) => r.clusterId !== null && r.revenueInPeriod > 0).length
      } кластеров с продажами)`,
    );
    console.log(
      `    «Без кластера»:    ${fmt(noClusterRow?.revenueInPeriod ?? 0)} ₽ / ${
        noClusterRow?.ordersInPeriod ?? 0
      } зак.`,
    );
    console.log(
      `    «Склад не указан»: ${fmt(noWarehouseRow?.revenueInPeriod ?? 0)} ₽ / ${
        noWarehouseRow?.ordersInPeriod ?? 0
      } зак.`,
    );
    console.log(`    ИТОГО:             ${fmt(totalRevenue)} ₽`);
    if (after.meta.unresolved.warehouses.length > 0) {
      console.log(
        `    нерезолвящиеся склады: ${after.meta.unresolved.warehouses.join(', ')}`,
      );
    }
    console.log(
      `    SKU (distinct): ${after.totals.skuCount}, строк остатков: ${after.meta.warehouseStocksCount}, кластеров в справочнике: ${after.meta.clustersCount}`,
    );

    console.log('  Топ-8 по выручке:');
    for (const r of [...after.rows]
      .sort((a, b) => b.revenueInPeriod - a.revenueInPeriod)
      .slice(0, 8)) {
      console.log(
        `    ${r.clusterName.padEnd(30)} остаток=${String(r.totalStock).padStart(6)}  зак=${String(
          r.ordersInPeriod,
        ).padStart(5)}  выручка=${fmt(r.revenueInPeriod).padStart(12)} ₽`,
      );
    }

    // Инвариант: выручка не теряется и не задваивается.
    check(
      'live: сумма выручки по строкам == итог старой логики',
      eq2(totalRevenue, before.noCluster.revenue + before.clustered),
      `after=${totalRevenue} vs before=${before.noCluster.revenue + before.clustered}`,
    );
    if (before.noCluster.revenue > 0 && after.meta.clustersCount > 0) {
      check(
        'live: выручка ушла из «Без кластера» в реальные кластеры',
        clusteredRevenue > 0 &&
          (noClusterRow?.revenueInPeriod ?? 0) < before.noCluster.revenue,
        `clustered=${clusteredRevenue}, noCluster=${noClusterRow?.revenueInPeriod ?? 0}`,
      );
    }

    // ---- Этап 2a: разрез по складам на тех же данных ----
    const byWarehouse = await loadOzonClusterStocks({
      tenantId: acc.tenantId,
      accountId: acc.id,
      fromIso,
      toIso,
      groupBy: 'warehouse',
      warehouseLimit: 20,
    });
    const whMeta = byWarehouse.meta.warehouses;
    console.log('  Разрез по складам:');
    console.log(
      `    складов в объединении: ${whMeta?.total ?? 0} (с остатком ${
        whMeta?.withStock ?? 0
      }, с заказами ${whMeta?.withOrders ?? 0}, выбито в ноль но продавали ${
        whMeta?.soldOutWithOrders ?? 0
      })`,
    );

    check(
      'live: groupBy=warehouse не меняет цифры кластеров',
      JSON.stringify(
        after.rows.map((r) => [r.rowKey, r.totalStock, r.ordersInPeriod, Math.round(r.revenueInPeriod)]),
      ) ===
        JSON.stringify(
          byWarehouse.rows.map((r) => [r.rowKey, r.totalStock, r.ordersInPeriod, Math.round(r.revenueInPeriod)]),
        ),
    );
    check(
      'live: totals идентичны в обоих разрезах',
      eq2(after.totals.totalStock, byWarehouse.totals.totalStock) &&
        eq2(after.totals.revenueInPeriod, byWarehouse.totals.revenueInPeriod),
    );

    let liveInvariantOk = true;
    let liveDetail = '';
    for (const row of byWarehouse.rows) {
      const s = sumWarehouses(row);
      if (
        !eq2(s.totalStock, row.totalStock) ||
        !eq2(s.ordersInPeriod, row.ordersInPeriod) ||
        !eq2(s.revenueInPeriod, row.revenueInPeriod)
      ) {
        liveInvariantOk = false;
        liveDetail = `${row.clusterName}: Σскладов=${s.totalStock}/${s.ordersInPeriod}/${Math.round(
          s.revenueInPeriod,
        )} vs кластер=${row.totalStock}/${row.ordersInPeriod}/${Math.round(row.revenueInPeriod)}`;
      }
    }
    check('live: Σ складов == строка кластера', liveInvariantOk, liveDetail);

    const soldOut = byWarehouse.rows
      // «Склад не указан» — не склад, а FBS-постинги без analytics_data.
      .filter((r) => r.clusterName !== NO_WAREHOUSE_LABEL)
      .flatMap((r) =>
        (r.warehouses ?? [])
          .filter((w) => w.totalStock === 0 && w.ordersInPeriod > 0)
          .map((w) => ({ cluster: r.clusterName, ...w })),
      );
    check(
      'live: склады, выбитые в ноль, но продававшие, попали в объединение',
      (whMeta?.soldOutWithOrders ?? 0) === 0 || soldOut.length > 0,
      `soldOutWithOrders=${whMeta?.soldOutWithOrders ?? 0}, показано=${soldOut.length}`,
    );
    if (soldOut.length > 0) {
      console.log(`    склады с остатком 0 и продажами (${soldOut.length}, топ-5 по выручке):`);
      for (const w of soldOut
        .sort((a, b) => b.revenueInPeriod - a.revenueInPeriod)
        .slice(0, 5)) {
        console.log(
          `      ${w.warehouseName.padEnd(32)} [${w.cluster}] зак=${String(
            w.ordersInPeriod,
          ).padStart(4)} выручка=${fmt(w.revenueInPeriod).padStart(10)} ₽`,
        );
      }
    }

    // ---- Этап 2b: разбиение по источнику остатков ----
    const [fboOnly, fbsOnly] = await Promise.all([
      loadOzonClusterStocks({
        tenantId: acc.tenantId,
        accountId: acc.id,
        fromIso,
        toIso,
        source: 'FBO',
      }),
      loadOzonClusterStocks({
        tenantId: acc.tenantId,
        accountId: acc.id,
        fromIso,
        toIso,
        source: 'FBS',
      }),
    ]);
    console.log('  Источники остатков:');
    console.log(
      `    строк FBO=${after.meta.bySource.fbo}, FBS=${after.meta.bySource.fbs}` +
        ` · остаток FBO=${fmt(fboOnly.totals.totalStock)}, FBS=${fmt(
          fbsOnly.totals.totalStock,
        )}` +
        ` · выручка FBO=${fmt(fboOnly.totals.revenueInPeriod)} ₽, FBS=${fmt(
          fbsOnly.totals.revenueInPeriod,
        )} ₽`,
    );
    if (after.meta.bySource.fbs === 0) {
      console.log(
        '    (FBS-остатков нет — стейдж fbsWarehouseStocks ещё не запускался либо своих складов нет)',
      );
    }
    check(
      'live: FBO + FBS == all по остатку',
      eq2(
        fboOnly.totals.totalStock + fbsOnly.totals.totalStock,
        after.totals.totalStock,
      ),
      `${fboOnly.totals.totalStock} + ${fbsOnly.totals.totalStock} vs ${after.totals.totalStock}`,
    );
    check(
      'live: FBO + FBS == all по выручке периода (scheme — полное разбиение)',
      eq2(
        fboOnly.totals.revenueInPeriod + fbsOnly.totals.revenueInPeriod,
        after.totals.revenueInPeriod,
      ),
      `${Math.round(fboOnly.totals.revenueInPeriod)} + ${Math.round(
        fbsOnly.totals.revenueInPeriod,
      )} vs ${Math.round(after.totals.revenueInPeriod)}`,
    );
    check(
      'live: в разрезе FBS нет строк географических кластеров',
      fbsOnly.rows.every((r) => r.clusterId === null),
      fbsOnly.rows.map((r) => r.clusterName).join(', '),
    );

    const truncated = byWarehouse.rows.filter((r) => r.hiddenWarehouses);
    console.log(
      `    кластеров со складами: ${
        byWarehouse.rows.filter((r) => (r.warehousesTotal ?? 0) > 0).length
      }, обрезано лимитом: ${truncated.length}`,
    );
    console.log('    Топ-3 кластера с раскрытием складов:');
    for (const r of [...byWarehouse.rows].slice(0, 3)) {
      console.log(`      ${r.clusterName} (${r.warehousesTotal ?? 0} складов)`);
      for (const w of (r.warehouses ?? []).slice(0, 4)) {
        console.log(
          `        ${w.warehouseName.padEnd(32)} остаток=${String(w.totalStock).padStart(
            6,
          )} зак=${String(w.ordersInPeriod).padStart(4)} выручка=${fmt(
            w.revenueInPeriod,
          ).padStart(10)} ₽`,
        );
      }
    }
  }
}

async function main() {
  const arg = process.argv[2];
  const unitOnly = process.argv.includes('--unit');
  const filterAccountId = arg && !arg.startsWith('--') ? arg : null;

  runUnitTests();
  runWarehouseUnitTests();
  runSourceUnitTests();
  if (!unitOnly) {
    try {
      await runLive(filterAccountId);
    } catch (e) {
      console.error(
        '\n=== Live-часть пропущена (нет доступа к БД?):',
        e instanceof Error ? e.message : e,
      );
    }
  }

  console.log(`\n=== ${failures === 0 ? 'OK' : `FAILED (${failures})`} ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('Script failed:', e);
  process.exit(1);
});
