// PURPOSE: Smoke-тесты для pure-функций Ozon Performance API:
//   - parseTokenResponse / calcTokenTtl
//   - parseCsv / parseSkuStatsRow / parseRuNumber
//   - mergeHistoricalAndOnDemand / periodIncludesToday / todayInMoscow
// Запуск: pnpm tsx scripts/test-ozon-perf-client.ts

import {
  parseTokenResponse,
  calcTokenTtl,
} from '../src/lib/marketplaces/ozon/performance/client';
import {
  parseCsv,
  parseSkuStatsRow,
  parseRuNumber,
} from '../src/lib/marketplaces/ozon/performance/endpoints';
import {
  mergeHistoricalAndOnDemand,
  periodIncludesToday,
  todayInMoscow,
} from '../src/lib/marketplaces/ozon/performance/on-demand';

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

console.log('\n# OAuth token parser');

{
  const parsed = parseTokenResponse({
    access_token: 'abc.def',
    expires_in: 1800,
    token_type: 'Bearer',
  });
  expect(parsed.token === 'abc.def', 'token parsed');
  expect(parsed.expiresInSec === 1800, 'expiresInSec = 1800');
}

{
  let thrown = false;
  try {
    parseTokenResponse({ expires_in: 1800 });
  } catch {
    thrown = true;
  }
  expect(thrown, 'throws on missing access_token');
}

{
  let thrown = false;
  try {
    parseTokenResponse({ access_token: 'x', expires_in: -1 });
  } catch {
    thrown = true;
  }
  expect(thrown, 'throws on negative expires_in');
}

{
  // expires_in приходит как строка
  const parsed = parseTokenResponse({ access_token: 'x', expires_in: '900' });
  expect(parsed.expiresInSec === 900, 'string expires_in parsed');
}

console.log('\n# TTL calculation');

expect(calcTokenTtl(1800) === 1740, '1800 → 1740 (запас 60s)');
expect(calcTokenTtl(60) === 30, '60 → 30 (минимум 30s)');
expect(calcTokenTtl(120) === 60, '120 → 60');
expect(calcTokenTtl(30) === 30, '30 → 30 (минимум)');

console.log('\n# CSV parser');

{
  const text = '"sku";"date";"clicks"\n"123";"2025-01-15";"42"\n"456";"2025-01-16";"7"';
  const rows = parseCsv(text);
  expect(rows.length === 2, '2 rows parsed');
  expect(rows[0].sku === '123', 'row 0 sku');
  expect(rows[0].clicks === '42', 'row 0 clicks');
  expect(rows[1].date === '2025-01-16', 'row 1 date');
}

{
  // CSV с пробелами и пустыми значениями
  const text = '"sku";"clicks"\n"";"5"\n"99";""';
  const rows = parseCsv(text);
  expect(rows.length === 2, 'parses rows with empty values');
  expect(rows[0].sku === '', 'empty sku preserved');
  expect(rows[1].clicks === '', 'empty clicks preserved');
}

{
  // CSV с экранированными кавычками
  const text = '"name";"v"\n"Foo ""bar""";"1"';
  const rows = parseCsv(text);
  expect(rows[0].name === 'Foo "bar"', 'escaped quotes parsed');
}

{
  // Пустой текст
  const rows = parseCsv('');
  expect(rows.length === 0, 'empty CSV → empty array');
}

console.log('\n# RU number parser');

expect(parseRuNumber('1 234,56') === 1234.56, '"1 234,56" → 1234.56');
expect(parseRuNumber('0') === 0, '"0" → 0');
expect(parseRuNumber('') === 0, 'empty → 0');
expect(parseRuNumber(undefined) === 0, 'undefined → 0');
expect(parseRuNumber('abc') === 0, 'non-numeric → 0');
expect(parseRuNumber('123.45') === 123.45, 'dot decimal → 123.45');

console.log('\n# SKU stats row parser');

{
  const parsed = parseSkuStatsRow({
    sku: '12345',
    date: '2025-01-15',
    views: '1 234',
    clicks: '56',
    cartAdds: '12',
    orders: '8',
    ordersMoney: '15 990,50',
    moneySpent: '500,00',
  });
  expect(parsed.sku === '12345', 'sku extracted');
  expect(parsed.date === '2025-01-15', 'date extracted');
  expect(parsed.views === 1234, 'views = 1234');
  expect(parsed.expenseRub === 500, 'expense = 500');
  expect(parsed.ordersRub === 15990.5, 'ordersRub = 15990.50');
}

{
  // Русские названия колонок
  const parsed = parseSkuStatsRow({
    SKU: '999',
    Дата: '2025-02-01',
    Показы: '100',
    Клики: '5',
    'В корзину': '2',
    Заказы: '1',
    Выручка: '299',
    Расход: '50',
  });
  expect(parsed.sku === '999', 'rus SKU');
  expect(parsed.views === 100, 'rus views');
  expect(parsed.ordersRub === 299, 'rus revenue');
}

console.log('\n# On-demand: today in MSC');

{
  // 2025-01-15T23:00:00Z = 2025-01-16T02:00:00 МСК
  const moscow = todayInMoscow(new Date('2025-01-15T23:00:00Z'));
  expect(moscow === '2025-01-16', 'UTC late evening → next day MSC');
}

{
  // 2025-01-15T10:00:00Z = 2025-01-15T13:00:00 МСК
  const moscow = todayInMoscow(new Date('2025-01-15T10:00:00Z'));
  expect(moscow === '2025-01-15', 'UTC midday → same day MSC');
}

console.log('\n# Period includes today');

{
  const now = new Date('2025-01-15T12:00:00Z'); // = 15.01 MSC
  const period1 = {
    from: new Date('2025-01-10T00:00:00Z'),
    to: new Date('2025-01-15T23:59:59Z'),
  };
  expect(periodIncludesToday(period1, now), 'today inside period');

  const period2 = {
    from: new Date('2025-01-01T00:00:00Z'),
    to: new Date('2025-01-10T00:00:00Z'),
  };
  expect(!periodIncludesToday(period2, now), 'historical period does not include today');
}

console.log('\n# mergeHistoricalAndOnDemand');

{
  const historical = [
    {
      sku: 'A',
      views: 100,
      clicks: 10,
      cartAdds: 5,
      orders: 2,
      ordersKopecks: 100_000,
      expenseKopecks: 50_000,
    },
  ];
  const today = [
    {
      sku: 'A',
      views: 50,
      clicks: 5,
      cartAdds: 2,
      orders: 1,
      ordersKopecks: 50_000,
      expenseKopecks: 25_000,
    },
    {
      sku: 'B',
      views: 30,
      clicks: 3,
      cartAdds: 1,
      orders: 0,
      ordersKopecks: 0,
      expenseKopecks: 10_000,
    },
  ];
  const merged = mergeHistoricalAndOnDemand(historical, today);
  expect(merged.length === 2, 'merged 2 sku');
  const a = merged.find((m) => m.sku === 'A');
  const b = merged.find((m) => m.sku === 'B');
  expect(a?.views === 150, 'A views summed (100 + 50)');
  expect(a?.expenseKopecks === 75_000, 'A expense summed');
  expect(b?.views === 30, 'B from today only');
}

{
  // Только historical, нет today
  const merged = mergeHistoricalAndOnDemand(
    [{ sku: 'X', views: 1, clicks: 0, cartAdds: 0, orders: 0, ordersKopecks: 0, expenseKopecks: 0 }],
    [],
  );
  expect(merged.length === 1 && merged[0].views === 1, 'historical-only passthrough');
}

{
  // SKU с пустыми ключами игнорируются
  const merged = mergeHistoricalAndOnDemand(
    [{ sku: '', views: 5, clicks: 0, cartAdds: 0, orders: 0, ordersKopecks: 0, expenseKopecks: 0 }],
    [{ sku: '', views: 10, clicks: 0, cartAdds: 0, orders: 0, ordersKopecks: 0, expenseKopecks: 0 }],
  );
  expect(merged.length === 0, 'empty SKU skipped');
}

console.log(`\n## ${passed} PASS · ${failed} FAIL\n`);
if (failed > 0) process.exit(1);
