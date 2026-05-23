// PURPOSE: Тесты для mapping Ozon Analytics → my-store-table (v0.22.0).
// Покрытие:
//   - OZON_TO_MY_STORE_COLUMN_MAP содержит все TableColumnKey
//   - extractOzonValue корректно извлекает значения
//   - merge by article/sku работает (replicated client logic)
// Запуск: pnpm tsx scripts/test-ozon-import-mapping.ts

import {
  OZON_TO_MY_STORE_COLUMN_MAP,
  extractOzonValue,
  DEFAULT_IMPORT_COLUMNS,
} from '../src/lib/unit-economics/ozon-to-my-store';
import type { OzonAnalyticsRow } from '../src/lib/blocks/catalog/unit-ozon-analytics-types';
import type { TableColumnKey } from '../src/components/unit-economics/ozon-analytics-table';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}`);
    failed += 1;
  }
}

function row(overrides: Partial<OzonAnalyticsRow> = {}): OzonAnalyticsRow {
  return {
    productId: 'p1',
    article: 'ART1',
    sku: '1001',
    name: 'Товар 1',
    primaryImage: null,
    stockMarketplace: 10,
    stockOwn: 5,
    priceRub: 1000,
    costRub: 400,
    delivered: 20,
    deliveredFbo: 12,
    deliveredFbs: 8,
    cancelled: 2,
    returned: 1,
    qtyDelivered: 25,
    revenueRub: 20000,
    adsRub: 1500,
    adsCpcRub: 1000,
    adsCpoAllocRub: 500,
    adsHasCpo: true,
    drrPct: 7.5,
    buyoutPct: 95,
    daysOfStock: 30,
    views: 1000,
    clicks: 100,
    cartAdds: 20,
    ...overrides,
  };
}

// ============================================================================

console.log('\n=== OZON_TO_MY_STORE_COLUMN_MAP completeness ===');
const ALL_KEYS: TableColumnKey[] = [
  'article', 'name', 'sku', 'priceRub', 'costRub', 'marginRub',
  'delivered', 'deliveredFbo', 'deliveredFbs', 'qtyDelivered',
  'cancelled', 'returned', 'returnPct', 'revenueRub', 'adsRub', 'drrPct',
  'stock', 'stockFbo', 'stockFbs', 'daysOfStock', 'buyoutPct',
  'views', 'clicks', 'ctr', 'cartAdds', 'cpc', 'cpm',
  'salesPerDay', 'salesShare',
];
for (const k of ALL_KEYS) {
  ok(`map has ${k}`, !!OZON_TO_MY_STORE_COLUMN_MAP[k]);
}

console.log('\n=== unique target IDs ===');
{
  const ids = new Set<string>();
  let dup = false;
  for (const k of ALL_KEYS) {
    const id = OZON_TO_MY_STORE_COLUMN_MAP[k].id;
    if (ids.has(id)) {
      dup = true;
      console.log(`    dup id: ${id} (key ${k})`);
    }
    ids.add(id);
  }
  ok('all column IDs unique', !dup);
}

console.log('\n=== extractOzonValue ===');
{
  const r = row();
  ok('priceRub = 1000', extractOzonValue(r, 'priceRub') === 1000);
  ok('marginRub = price - cost = 600', extractOzonValue(r, 'marginRub') === 600);
  ok('stock = fbo + fbs = 15', extractOzonValue(r, 'stock') === 15);
  ok('article = ART1', extractOzonValue(r, 'article') === 'ART1');
  ok('returnPct = 1/(20+1)*100 ≈ 4.76', Math.abs(Number(extractOzonValue(r, 'returnPct')) - 4.761904761904762) < 1e-6);
  ok('ctr = 100/1000*100 = 10', extractOzonValue(r, 'ctr') === 10);
  ok('cpc = 1000/100 = 10', extractOzonValue(r, 'cpc') === 10);
}
{
  const noViews = row({ views: 0, clicks: 0 });
  ok('CTR с 0 views → 0', extractOzonValue(noViews, 'ctr') === 0);
  ok('CPC с 0 clicks → 0', extractOzonValue(noViews, 'cpc') === 0);
}

// ============================================================================
// Merge logic (replicated from mergeOzonRowsIntoConfig)

type MyStoreRow = {
  id: string;
  article: string;
  name: string;
  values: Record<string, number | string>;
  bindings: Record<string, unknown>;
};

function merge(
  existingRows: MyStoreRow[],
  ozonRows: OzonAnalyticsRow[],
  columns: TableColumnKey[],
  matchBy: 'article' | 'sku',
  mode: 'merge' | 'replace',
): MyStoreRow[] {
  const baseRows = mode === 'replace' ? [] : existingRows.slice();
  const byKey = new Map<string, MyStoreRow>();
  const keyOf = (article: string | null | undefined, sku: string | null | undefined) =>
    (matchBy === 'sku' ? sku ?? '' : article ?? '').toLowerCase().trim();
  for (const r of baseRows) {
    const k = keyOf(r.article, r.values['ozonSku'] as string | undefined);
    if (k) byKey.set(k, r);
  }
  for (const ozon of ozonRows) {
    const k = keyOf(ozon.article, ozon.sku);
    if (!k) continue;
    const existing = byKey.get(k);
    if (existing) {
      const nextValues = { ...existing.values };
      for (const colKey of columns) {
        const def = OZON_TO_MY_STORE_COLUMN_MAP[colKey];
        const value = extractOzonValue(ozon, colKey);
        if (value !== null) nextValues[def.id] = value;
      }
      byKey.set(k, { ...existing, values: nextValues });
    } else {
      const nextValues: Record<string, number | string> = {};
      for (const colKey of columns) {
        const def = OZON_TO_MY_STORE_COLUMN_MAP[colKey];
        const value = extractOzonValue(ozon, colKey);
        if (value !== null) nextValues[def.id] = value;
      }
      byKey.set(k, {
        id: `r_${k}`,
        article: ozon.article ?? '',
        name: ozon.name ?? '',
        values: nextValues,
        bindings: {},
      });
    }
  }
  return Array.from(byKey.values());
}

console.log('\n=== merge by article ===');
{
  const existing: MyStoreRow[] = [
    { id: 'r1', article: 'ART1', name: 'Old name', values: { cost: 200 }, bindings: {} },
  ];
  const ozonRows = [row({ article: 'ART1' }), row({ article: 'ART2', sku: '2002' })];
  const result = merge(existing, ozonRows, ['priceRub', 'delivered'], 'article', 'merge');
  ok('merge returns 2 rows (1 updated, 1 new)', result.length === 2);
  const art1 = result.find((r) => r.article === 'ART1');
  const art2 = result.find((r) => r.article === 'ART2');
  ok('ART1 сохранил старое cost', art1?.values.cost === 200);
  ok('ART1 получил price из ozon', art1?.values.ozonPriceRub === 1000);
  ok('ART2 — новая строка с price', art2?.values.ozonPriceRub === 1000);
}

console.log('\n=== merge by sku ===');
{
  const existing: MyStoreRow[] = [
    { id: 'r1', article: '', name: '', values: { ozonSku: '1001', cost: 100 }, bindings: {} },
  ];
  const result = merge(existing, [row({ sku: '1001' })], ['priceRub'], 'sku', 'merge');
  ok('matched by sku → 1 row', result.length === 1);
  ok('sku-matched row сохранил cost', result[0].values.cost === 100);
}

console.log('\n=== replace mode ===');
{
  const existing: MyStoreRow[] = [
    { id: 'r-old', article: 'OLD', name: 'Should be wiped', values: {}, bindings: {} },
  ];
  const result = merge(existing, [row({ article: 'NEW' })], ['priceRub'], 'article', 'replace');
  ok('replace стёр старую строку', !result.find((r) => r.article === 'OLD'));
  ok('replace оставил новую строку', !!result.find((r) => r.article === 'NEW'));
}

console.log('\n=== DEFAULT_IMPORT_COLUMNS ===');
ok('default = 5 колонок', DEFAULT_IMPORT_COLUMNS.length === 5);
ok('default содержит priceRub', DEFAULT_IMPORT_COLUMNS.includes('priceRub'));
ok('default содержит revenueRub', DEFAULT_IMPORT_COLUMNS.includes('revenueRub'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
