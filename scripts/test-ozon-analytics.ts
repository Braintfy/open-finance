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
import {
  detectHeaderIndex,
  parseCsv,
  isSkuStatsHeader,
  isCpoDailyHeader,
  parseSkuStatsRow,
  parseCpoDailyRow,
  normalizeDate,
} from '../src/lib/marketplaces/ozon/performance/endpoints';

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
    primaryImage: over.primaryImage ?? null,
    stockMarketplace: over.stockMarketplace ?? 0,
    stockOwn: over.stockOwn ?? 0,
    priceRub: over.priceRub ?? 0,
    costRub: over.costRub ?? 0,
    delivered: over.delivered ?? 0,
    deliveredFbo: over.deliveredFbo ?? 0,
    deliveredFbs: over.deliveredFbs ?? 0,
    cancelled: over.cancelled ?? 0,
    returned: over.returned ?? 0,
    qtyDelivered: over.qtyDelivered ?? 0,
    revenueRub: over.revenueRub ?? 0,
    adsRub: over.adsRub ?? 0,
    adsCpcRub: over.adsCpcRub ?? 0,
    adsCpoAllocRub: over.adsCpoAllocRub ?? 0,
    adsHasCpo: over.adsHasCpo ?? false,
    drrPct: over.drrPct ?? null,
    buyoutPct: over.buyoutPct ?? null,
    daysOfStock: over.daysOfStock ?? null,
    views: over.views ?? 0,
    clicks: over.clicks ?? 0,
    cartAdds: over.cartAdds ?? 0,
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
  expect(cfg.showProductImage === false, 'default showProductImage = false');
  expect(cfg.showDrrColor === true, 'default showDrrColor = true');
  expect(cfg.showStockColor === true, 'default showStockColor = true');
}

// 12. backward compat — unknown keys в config не ломают парсинг (через passthrough или ignore)
{
  const cfg = OzonAnalyticsBlockConfigSchema.parse({ legacyField: 'x', periodPreset: '7d' });
  expect(cfg.periodPreset === '7d', 'periodPreset из payload');
}

// 12b. явные настройки appearance прокидываются.
{
  const cfg = OzonAnalyticsBlockConfigSchema.parse({
    showProductImage: true,
    showDrrColor: false,
    showStockColor: false,
  });
  expect(cfg.showProductImage === true, 'showProductImage опция работает');
  expect(cfg.showDrrColor === false, 'showDrrColor опция работает');
  expect(cfg.showStockColor === false, 'showStockColor опция работает');
}

// 12c. primaryImage на row проходит через builder.
{
  const r = row({ primaryImage: 'https://cdn.ozone.ru/some.jpg' });
  expect(r.primaryImage === 'https://cdn.ozone.ru/some.jpg', 'primaryImage сохраняется на row');
  const r2 = row({});
  expect(r2.primaryImage === null, 'primaryImage по умолчанию null');
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

console.log('\n# Ozon Performance CSV parser');

// 19. normalizeDate понимает оба формата.
{
  expect(normalizeDate('2026-05-19') === '2026-05-19', 'ISO без времени');
  expect(normalizeDate('2026-05-19T10:00:00Z') === '2026-05-19', 'ISO с временем');
  expect(normalizeDate('19.05.2026') === '2026-05-19', 'RU 19.05.2026');
  expect(normalizeDate('') === null, 'empty → null');
  expect(normalizeDate('junk') === null, 'junk → null');
  expect(normalizeDate(null) === null, 'null → null');
}

// 20. parseCsv детектит реальный header, пропуская метастроки кампании.
{
  // Реальный формат Ozon Performance CSV (Перфоманс 2.0, стра 1775):
  // строка 0 — campaign name + period (метадата)
  // строка 1 — пустая
  // строка 2 — настоящий header
  // строки 3+ — данные
  const ozonCsv = [
    '"Кампания 12345 (CPC)";"01.05.2026-31.05.2026"',
    '""',
    'sku;"Название товара";"Цена товара, ₽";Показы;Клики;"CTR (%)";"В корзину";"Расход, ₽, с НДС";"Дата"',
    '1275993197;"Спермидин 5мг 60 шт";"2900,00";"100";"5";"5.0";"3";"125,50";"19.05.2026"',
    '3417910233;"Экстракт зародышей";"1261,00";"50";"2";"4.0";"1";"42,10";"19.05.2026"',
  ].join('\n');

  const lines = ozonCsv.split('\n').filter((l) => l.length > 0);
  expect(detectHeaderIndex(lines) === 2, `detectHeaderIndex → 2 (got ${detectHeaderIndex(lines)})`);

  const rows = parseCsv(ozonCsv);
  expect(rows.length === 2, `parseCsv → 2 data rows (got ${rows.length})`);
  expect(isSkuStatsHeader(rows[0]) === true, 'isSkuStatsHeader = true');

  const parsed = parseSkuStatsRow(rows[0]);
  expect(parsed.sku === '1275993197', `sku = 1275993197 (got ${parsed.sku})`);
  expect(parsed.views === 100, `views = 100 (got ${parsed.views})`);
  expect(parsed.clicks === 5, `clicks = 5 (got ${parsed.clicks})`);
  expect(parsed.cartAdds === 3, `cartAdds = 3 (got ${parsed.cartAdds})`);
  expect(parsed.expenseRub === 125.5, `expenseRub = 125.50 (got ${parsed.expenseRub})`);
  expect(parsed.date === '2026-05-19', `date нормализована в ISO (got ${parsed.date})`);
}

// 21. Старый формат без метастрок — backward compat.
{
  const plainCsv = [
    'sku;Показы;Клики;"Расход, ₽, с НДС"',
    '99999;10;1;5,00',
  ].join('\n');
  const rows = parseCsv(plainCsv);
  expect(rows.length === 1, 'без метастрок → 1 row');
  const parsed = parseSkuStatsRow(rows[0]);
  expect(parsed.sku === '99999', 'plain CSV: sku парсится');
}

// 22. CSV без валидного header — fallback на line[0].
{
  const csv = 'garbage_a;garbage_b\nval1;val2';
  const rows = parseCsv(csv);
  expect(rows.length === 1, 'fallback на line[0] для unknown header');
  expect(isSkuStatsHeader(rows[0]) === false, 'garbage header не считается sku stats');
}

// 23. CPO CSV (без SKU, только агрегат по дням).
{
  const cpoCsv = [
    '"Кампания 99 (CPO)";"01.05.2026-31.05.2026"',
    'Дата;"Статус продвижения";"Расход, ₽";"Продажи из поиска, ₽";"Продажи из рекомендаций, ₽";"Заказы из поиска";"Заказы из рекомендаций"',
    '19.05.2026;Активна;"1500,00";"50000,00";"10000,00";20;3',
  ].join('\n');
  const rows = parseCsv(cpoCsv);
  expect(rows.length === 1, 'CPO CSV: 1 data row');
  expect(isCpoDailyHeader(rows[0]) === true, 'isCpoDailyHeader = true');
  expect(isSkuStatsHeader(rows[0]) === false, 'CPO header NOT sku stats');

  const parsed = parseCpoDailyRow(rows[0]);
  expect(parsed !== null, 'parseCpoDailyRow не null');
  if (parsed) {
    expect(parsed.date === '2026-05-19', `CPO date RU → ISO (got ${parsed.date})`);
    expect(parsed.expenseRub === 1500, `expense = 1500 (got ${parsed.expenseRub})`);
    expect(parsed.salesSearchRub === 50000, `salesSearch = 50000 (got ${parsed.salesSearchRub})`);
    expect(parsed.ordersSearch === 20, `ordersSearch = 20 (got ${parsed.ordersSearch})`);
  }
}

// 24. SKU не числовой → не записывается.
{
  const csv = [
    'sku;Показы',
    'rm-sesame-60-10;100',
  ].join('\n');
  const rows = parseCsv(csv);
  const parsed = parseSkuStatsRow(rows[0]);
  expect(parsed.sku === '', 'не-числовой SKU отбрасывается');
}

// 25. Пустой CSV → 0 rows.
{
  expect(parseCsv('').length === 0, 'пустой CSV → 0 rows');
  expect(parseCsv('\n\n').length === 0, 'только переносы → 0 rows');
}

console.log(`\n## ${passed} PASS · ${failed} FAIL\n`);
if (failed > 0) process.exit(1);
