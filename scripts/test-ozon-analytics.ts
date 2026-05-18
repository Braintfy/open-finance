// PURPOSE: Smoke-тесты для Ozon-аналитики — pure functions (filters, sort,
// resolvePeriod). Не покрывает SQL-агрегацию (это интеграционный тест).
// Запуск: pnpm tsx scripts/test-ozon-analytics.ts

import {
  applyAnalyticsFilter,
  ANALYTICS_FILTERS,
  countFilterMatches,
} from '../src/components/unit-economics/ozon-analytics-filters';
import {
  OzonAnalyticsBlockConfigSchema,
  resolvePeriod,
  DEFAULT_VISIBLE_COLUMNS,
  type OzonAnalyticsRow,
} from '../src/lib/blocks/catalog/unit-ozon-analytics-types';

let passed = 0;
let failed = 0;

function expect(cond: boolean, name: string, hint?: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${name}${hint ? ' — ' + hint : ''}`);
  }
}

function row(over: Partial<OzonAnalyticsRow>): OzonAnalyticsRow {
  return {
    productId: over.productId ?? 'p_' + Math.random().toString(36).slice(2, 8),
    article: over.article ?? 'SKU',
    sku: over.sku ?? null,
    name: over.name ?? 'Товар',
    stockMarketplace: over.stockMarketplace ?? 0,
    stockOwn: over.stockOwn ?? 0,
    priceRub: over.priceRub ?? 0,
    costRub: over.costRub ?? 0,
    delivered: over.delivered ?? 0,
    cancelled: over.cancelled ?? 0,
    returned: over.returned ?? 0,
    qtyDelivered: over.qtyDelivered ?? 0,
    revenueRub: over.revenueRub ?? 0,
    adsRub: over.adsRub ?? 0,
    drrPct: over.drrPct ?? null,
    buyoutPct: over.buyoutPct ?? null,
    daysOfStock: over.daysOfStock ?? null,
  };
}

console.log('\n# applyAnalyticsFilter');

const rows: OzonAnalyticsRow[] = [
  row({ article: 'A', revenueRub: 1000, adsRub: 50, drrPct: 5, stockMarketplace: 100, stockOwn: 0, delivered: 20, daysOfStock: 50 }),
  row({ article: 'B', revenueRub: 2000, adsRub: 600, drrPct: 30, stockMarketplace: 5, stockOwn: 0, delivered: 5, daysOfStock: 5 }),
  row({ article: 'C', revenueRub: 0, adsRub: 0, drrPct: null, stockMarketplace: 0, stockOwn: 0, delivered: 0, daysOfStock: null }),
  row({ article: 'D', revenueRub: 500, adsRub: 1000, drrPct: 200, stockMarketplace: 30, stockOwn: 0, delivered: 3, daysOfStock: 15 }),
  row({ article: 'E', revenueRub: 800, adsRub: 0, drrPct: null, stockMarketplace: 100, stockOwn: 0, delivered: 10, daysOfStock: 100 }),
];

// 1. 'all' filter
expect(applyAnalyticsFilter(rows, 'all').length === 5, 'all → 5');

// 2. 'with-ads' — rows with adsRub > 0
{
  const r = applyAnalyticsFilter(rows, 'with-ads');
  expect(r.length === 3, 'with-ads → 3 (A,B,D)');
  expect(r.every((x) => x.adsRub > 0), 'все with-ads имеют ads');
}

// 3. 'high-drr' — drr > 20%
{
  const r = applyAnalyticsFilter(rows, 'high-drr');
  expect(r.length === 2, 'high-drr → 2 (B,D)');
  expect(r.every((x) => (x.drrPct ?? 0) > 20), 'все high-drr имеют drr>20');
}

// 4. 'no-ads' — без рекламы но с продажами
{
  const r = applyAnalyticsFilter(rows, 'no-ads');
  expect(r.length === 1, 'no-ads → 1 (E)');
  expect(r[0].article === 'E', 'no-ads = E');
}

// 5. 'low-stock' — < 14 дней
{
  const r = applyAnalyticsFilter(rows, 'low-stock');
  // B (5d) — да. D (15d) — нет. A (50d) — нет. C (no stock) — нет (stock=0).
  expect(r.length === 1, 'low-stock → 1 (B)');
  expect(r[0].article === 'B', 'low-stock = B');
}

// 6. 'no-stock' — stock=0
{
  const r = applyAnalyticsFilter(rows, 'no-stock');
  expect(r.length === 1, 'no-stock → 1 (C)');
}

// 7. 'no-orders' — delivered=0
{
  const r = applyAnalyticsFilter(rows, 'no-orders');
  expect(r.length === 1, 'no-orders → 1 (C)');
}

// 8. 'unprofitable' — drr > 100
{
  const r = applyAnalyticsFilter(rows, 'unprofitable');
  expect(r.length === 1, 'unprofitable → 1 (D)');
  expect(r[0].article === 'D', 'unprofitable = D');
}

// 9. countFilterMatches sanity
expect(countFilterMatches(rows, 'with-ads') === 3, 'count helper sanity');
expect(countFilterMatches([], 'all') === 0, 'empty rows → 0');

// 10. ANALYTICS_FILTERS неизменяемая константа — все id уникальны
{
  const ids = new Set(ANALYTICS_FILTERS.map((f) => f.id));
  expect(ids.size === ANALYTICS_FILTERS.length, 'все filter ids уникальны');
}

console.log('\n# OzonAnalyticsBlockConfigSchema');

// 11. parse default
{
  const cfg = OzonAnalyticsBlockConfigSchema.parse({});
  expect(cfg.periodPreset === '30d', 'default periodPreset = 30d');
  expect(cfg.defaultFilter === 'all', 'default filter = all');
  expect(cfg.accountId === null, 'default accountId = null');
  expect(cfg.visibleColumns.length === DEFAULT_VISIBLE_COLUMNS.length, 'default visibleColumns matches');
}

// 12. backward compat — unknown keys в config не ломают парсинг (через passthrough или ignore)
{
  const cfg = OzonAnalyticsBlockConfigSchema.parse({ legacyField: 'x', periodPreset: '7d' });
  expect(cfg.periodPreset === '7d', 'periodPreset из payload');
}

console.log('\n# resolvePeriod');

// 13. preset '7d' даёт 7 дней
{
  const p = resolvePeriod('7d', null, null);
  const diffDays = (p.to.getTime() - p.from.getTime()) / (24 * 3600 * 1000);
  expect(Math.abs(diffDays - 8) < 0.05 || Math.abs(diffDays - 7) < 0.05, `7d gives ~7-8 days (got ${diffDays})`);
}

// 14. preset 'today' → 1 день
{
  const p = resolvePeriod('today', null, null);
  const diffDays = (p.to.getTime() - p.from.getTime()) / (24 * 3600 * 1000);
  expect(Math.abs(diffDays - 1) < 0.05, `today gives 1 day (got ${diffDays})`);
}

// 15. preset 'mtd' начинается с 1-го числа месяца
{
  const p = resolvePeriod('mtd', null, null);
  expect(p.from.getDate() === 1, 'mtd starts at day 1');
}

// 16. preset 'custom' с заданными датами
{
  const from = new Date('2025-01-15').toISOString();
  const to = new Date('2025-02-05').toISOString();
  const p = resolvePeriod('custom', from, to);
  expect(p.from.toISOString() === from, 'custom from preserved');
  expect(p.to.toISOString() === to, 'custom to preserved');
}

// 17. preset 'custom' без дат — фолбэк на 30d
{
  const p = resolvePeriod('custom', null, null);
  const diffDays = (p.to.getTime() - p.from.getTime()) / (24 * 3600 * 1000);
  expect(diffDays >= 30 && diffDays <= 31.5, `custom без дат → ~30d (got ${diffDays})`);
}

// 18. preset 'yesterday' от вчера до сегодня
{
  const p = resolvePeriod('yesterday', null, null);
  const today = new Date();
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  expect(p.to.getTime() === todayMidnight.getTime(), 'yesterday.to = сегодня (миднайт)');
  const yesterdayMidnight = new Date(todayMidnight.getTime() - 24 * 3600 * 1000);
  expect(p.from.getTime() === yesterdayMidnight.getTime(), 'yesterday.from = вчера');
}

console.log(`\n## ${passed} PASS · ${failed} FAIL\n`);
if (failed > 0) process.exit(1);
