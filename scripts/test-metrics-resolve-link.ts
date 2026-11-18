// PURPOSE: Smoke-тесты src/lib/metrics/resolve-link.ts — item_key и резолв сшивки.
// Запуск: pnpm -s tsx scripts/test-metrics-resolve-link.ts

import {
  buildLinkIndex,
  makeItemKey,
  parseItemKey,
  resolveLink,
  type LinkRow,
} from '../src/lib/metrics/resolve-link';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean, hint?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}${hint ? ' — ' + hint : ''}`);
    failed += 1;
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ok(label, same, same ? undefined : `получено ${JSON.stringify(actual)}, ожидалось ${JSON.stringify(expected)}`);
}

function link(p: Partial<LinkRow> & Pick<LinkRow, 'itemId'>): LinkRow {
  return {
    channel: 'ozon',
    scopeKey: 'acc1',
    externalId: 'X',
    externalSku: null,
    qtyPerUnit: 1,
    ...p,
  };
}

console.log('\n=== makeItemKey / parseItemKey ===');
{
  eq('offerId → он сам (с trim)', makeItemKey({ offerId: '  ART-1 ', sku: 5 }), 'ART-1');
  eq('нет offerId → sku:', makeItemKey({ offerId: '  ', sku: 12345 }), 'sku:12345');
  eq('sku строкой', makeItemKey({ sku: '77' }), 'sku:77');
  eq('только stockItemId → item:', makeItemKey({ offerId: null, sku: null, stockItemId: 'u-1' }), 'item:u-1');
  eq('пусто → пустая строка', makeItemKey({}), '');
  eq('коллизия sku: → offer:', makeItemKey({ offerId: 'sku:12' }), 'offer:sku:12');
  eq('коллизия item: → offer:', makeItemKey({ offerId: 'item:abc' }), 'offer:item:abc');
  eq('parse offer:sku:12', parseItemKey('offer:sku:12'), { kind: 'offer', value: 'sku:12' });
  eq('parse обычного', parseItemKey('ART-1'), { kind: 'offer', value: 'ART-1' });
  eq('parse sku', parseItemKey('sku:99'), { kind: 'sku', value: '99' });
  eq('parse item', parseItemKey('item:u-1'), { kind: 'item', value: 'u-1' });
  eq('parse пусто', parseItemKey(''), { kind: 'none', value: '' });
  for (const offer of ['ART-1', 'sku:1', 'item:z', 'offer:q', 'offer:sku:3']) {
    const key = makeItemKey({ offerId: offer });
    eq(`round-trip offer ${offer}`, parseItemKey(key), { kind: 'offer', value: offer });
  }
  eq('round-trip sku', parseItemKey(makeItemKey({ sku: 555 })), { kind: 'sku', value: '555' });
  eq('round-trip item', parseItemKey(makeItemKey({ stockItemId: 'id9' })), { kind: 'item', value: 'id9' });
}

console.log('\n=== resolveLink: порядок ступеней ===');
{
  const idx = buildLinkIndex([
    link({ itemId: 'A', externalId: 'X', scopeKey: 'acc1' }),
    link({ itemId: 'B', externalId: 'X', scopeKey: '-' }),
    link({ itemId: 'C', externalId: 'Y', scopeKey: '-' }),
    link({ itemId: 'D', externalId: 'Z1', externalSku: '100', scopeKey: 'acc1' }),
    link({ itemId: 'E', externalId: 'Z2', externalSku: '200', scopeKey: '-' }),
    link({ itemId: 'F', externalId: 'Z3', externalSku: '100', scopeKey: '-' }),
  ]);
  const q = { channel: 'ozon', scopeKey: 'acc1' };
  eq('1: account_id', resolveLink(idx, { ...q, itemKey: 'X' }), { itemId: 'A', qtyPerUnit: 1, via: 'account_id' });
  eq('аккаунт приоритетнее общего', resolveLink(idx, { ...q, itemKey: 'X' })?.itemId, 'A');
  eq('2: shared_id', resolveLink(idx, { ...q, itemKey: 'Y' }), { itemId: 'C', qtyPerUnit: 1, via: 'shared_id' });
  eq('другой аккаунт → общий', resolveLink(idx, { channel: 'ozon', scopeKey: 'acc2', itemKey: 'X' })?.via, 'shared_id');
  eq('3: account_sku (из q.externalSku)', resolveLink(idx, { ...q, itemKey: 'NOPE', externalSku: '100' }), {
    itemId: 'D',
    qtyPerUnit: 1,
    via: 'account_sku',
  });
  eq('4: shared_sku', resolveLink(idx, { ...q, itemKey: 'NOPE', externalSku: '200' }), {
    itemId: 'E',
    qtyPerUnit: 1,
    via: 'shared_sku',
  });
  eq('sku из ключа sku:200', resolveLink(idx, { ...q, itemKey: 'sku:200' })?.itemId, 'E');
  eq('sku из ключа: аккаунт приоритетнее', resolveLink(idx, { ...q, itemKey: 'sku:100' })?.itemId, 'D');
  eq('id приоритетнее sku', resolveLink(idx, { ...q, itemKey: 'Y', externalSku: '100' })?.itemId, 'C');
  eq('другой канал не находит', resolveLink(idx, { channel: 'wb', scopeKey: 'acc1', itemKey: 'X' }), null);
  eq('нет совпадений → null', resolveLink(idx, { ...q, itemKey: 'unknown' }), null);
  eq('offer:sku:12 ищется как offerId «sku:12»', resolveLink(
    buildLinkIndex([link({ itemId: 'Q', externalId: 'sku:12' })]),
    { ...q, itemKey: makeItemKey({ offerId: 'sku:12' }) },
  )?.itemId, 'Q');
}

console.log('\n=== resolveLink: особые ключи и мусор ===');
{
  const idx = buildLinkIndex([]);
  eq('item:<id> без индекса', resolveLink(idx, { channel: 'wb', scopeKey: '-', itemKey: 'item:abc' }), {
    itemId: 'abc',
    qtyPerUnit: 1,
    via: 'item_key',
  });
  eq("itemKey '' → null", resolveLink(idx, { channel: 'ozon', scopeKey: 'a', itemKey: '' }), null);
}
{
  const idx = buildLinkIndex([
    link({ itemId: 'A', externalId: 'P1', qtyPerUnit: 0 }),
    link({ itemId: 'B', externalId: 'P2', qtyPerUnit: 2.5 }),
    link({ itemId: 'C', externalId: 'P3', qtyPerUnit: NaN }),
    link({ itemId: 'D', externalId: 'P4', qtyPerUnit: 3 }),
    link({ itemId: 'E', externalId: 'P5', qtyPerUnit: -2 }),
  ]);
  const q = { channel: 'ozon', scopeKey: 'acc1' };
  const qty = (id: string) => resolveLink(idx, { ...q, itemKey: id })?.qtyPerUnit;
  eq('qty 0 → 1', qty('P1'), 1);
  eq('qty 2.5 → 1', qty('P2'), 1);
  eq('qty NaN → 1', qty('P3'), 1);
  eq('qty 3 сохраняется', qty('P4'), 3);
  eq('qty −2 → 1', qty('P5'), 1);
}
{
  const idx = buildLinkIndex([
    link({ itemId: 'first', externalId: 'a1', externalSku: '900' }),
    link({ itemId: 'second', externalId: 'a2', externalSku: '900' }),
  ]);
  eq('несколько строк на один sku → первая', resolveLink(idx, {
    channel: 'ozon',
    scopeKey: 'acc1',
    itemKey: 'sku:900',
  })?.itemId, 'first');
}

console.log(`\nИтого: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
