// PURPOSE: Smoke-тесты для pure-function buildSyncDiff().
// Запуск: pnpm tsx scripts/test-ozon-sync-diff.ts (или с required_permissions=all в sandbox)

import {
  buildSyncDiff,
  type OzonBlockSyncSettings,
  type SyncOzonProduct,
  type SyncRowSnapshot,
} from '../src/components/unit-economics/ozon-sync-diff';

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

function defaultSync(over: Partial<OzonBlockSyncSettings> = {}): OzonBlockSyncSettings {
  return {
    accountId: null,
    conflictPolicy: 'fill-empty',
    matchBy: 'article',
    treatZeroAsEmpty: true,
    columnMap: {
      article: true,
      name: true,
      price: true,
      cost: false,
      stock: true,
      volumeL: true,
      commissionPct: false,
      salesPerMonth: false,
      buyoutPct: false,
    },
    ...over,
  };
}

function row(article: string, inputs: Record<string, number> = {}, name = ''): SyncRowSnapshot {
  return {
    id: `r_${article}`,
    productId: null,
    article,
    name,
    inputs,
    bindings: {},
  };
}

function product(opts: Partial<SyncOzonProduct> & { article: string }): SyncOzonProduct {
  return {
    id: opts.id ?? `p_${opts.article}`,
    article: opts.article,
    sku: opts.sku ?? null,
    name: opts.name ?? `Товар ${opts.article}`,
    priceKopecks: opts.priceKopecks ?? 100000, // 1000 ₽
    costKopecks: opts.costKopecks ?? 0,
    stockMarketplace: opts.stockMarketplace ?? 0,
    stockOwn: opts.stockOwn ?? 0,
    volumeL: opts.volumeL ?? 100, // 1 л (x100)
    metadata: opts.metadata ?? null,
    salesPerMonth: opts.salesPerMonth,
    buyoutPct: opts.buyoutPct,
  };
}

console.log('\n# buildSyncDiff — match & policy');

// 1. fill-empty: пустые заполняются, заполненные пропускаются
{
  const sync = defaultSync({ conflictPolicy: 'fill-empty' });
  // A1 — ВСЕ enabled поля уже заполнены (никаких изменений быть не должно)
  // A2 — всё пусто (все enabled поля заполнятся)
  // A3 — не существует в currentRows (создастся новая строка)
  const rows = [
    row('A1', { price: 1500, stock: 10, volumeL: 0.5 }, 'Старое имя A1'),
    row('A2', {}, ''),
  ];
  const products = [
    product({ article: 'A1', priceKopecks: 200000, stockMarketplace: 50, volumeL: 200 }),
    product({ article: 'A2', priceKopecks: 99900, stockMarketplace: 7 }),
    product({ article: 'A3', priceKopecks: 50000, stockMarketplace: 1 }),
  ];
  const diff = buildSyncDiff({ currentRows: rows, ozonProducts: products, sync, mode: 'fbo' });

  expect(diff.totals.newRows === 1, 'newRows=1 (A3 не было в текущих)');
  expect(diff.totals.updatedRows === 1, `updatedRows=1 (только A2; A1 целиком заполнен), got ${diff.totals.updatedRows}`);
  const a1Updates = diff.changes.filter((c) => c.rowKey === 'A1' && c.action === 'update');
  expect(a1Updates.length === 0, 'A1: ни одна ячейка не перетёрта (все были заполнены)');
  const a1Skips = diff.changes.filter((c) => c.rowKey === 'A1' && c.action === 'skip');
  expect(a1Skips.length > 0, 'A1: цены/стоки в changes как skip с reason');

  const a2 = diff.changes.filter((c) => c.rowKey === 'A2');
  expect(a2.some((c) => c.field === 'price' && c.after === 999), 'A2: price=999 проставлен');
  expect(a2.some((c) => c.field === 'stock' && c.after === 7), 'A2: stock=7 проставлен');

  const a3New = diff.changes.filter((c) => c.action === 'create');
  expect(a3New.length >= 3, 'A3: create — несколько ячеек (article, name, price, stock, volumeL)');
}

// 2. overwrite: все ячейки перезатираются
{
  const sync = defaultSync({ conflictPolicy: 'overwrite' });
  const rows = [row('B1', { price: 100, stock: 5 }, 'Старое B1')];
  const products = [product({ article: 'B1', priceKopecks: 999900, stockMarketplace: 33 })];
  const diff = buildSyncDiff({ currentRows: rows, ozonProducts: products, sync, mode: 'fbo' });
  const updates = diff.changes.filter((c) => c.action === 'update');
  expect(updates.some((c) => c.field === 'price' && c.after === 9999), 'B1: price=9999 перетёрся');
  expect(updates.some((c) => c.field === 'stock' && c.after === 33), 'B1: stock=33 перетёрся');
}

// 3. skip: пропускаем строки которые имеют любое значение
{
  const sync = defaultSync({ conflictPolicy: 'skip' });
  const rows = [
    row('C1', { price: 1 }, 'есть цена'),
    row('C2', {}, ''),
  ];
  const products = [
    product({ article: 'C1', priceKopecks: 999900 }),
    product({ article: 'C2', priceKopecks: 999900 }),
  ];
  const diff = buildSyncDiff({ currentRows: rows, ozonProducts: products, sync, mode: 'fbo' });
  expect(diff.totals.skippedRows === 1, 'skippedRows=1 (C1 пропущен)');
  expect(diff.changes.some((c) => c.rowKey === 'C1' && c.action === 'skip'), 'C1 в changes как skip');
  expect(diff.changes.some((c) => c.rowKey === 'C2' && c.action === 'update'), 'C2 обновлён');
}

// 4. treatZeroAsEmpty=true: 0 считается пустым в fill-empty
{
  const sync = defaultSync({ conflictPolicy: 'fill-empty', treatZeroAsEmpty: true });
  const rows = [row('D1', { price: 0, stock: 0 }, '')];
  const products = [product({ article: 'D1', priceKopecks: 555500, stockMarketplace: 88 })];
  const diff = buildSyncDiff({ currentRows: rows, ozonProducts: products, sync, mode: 'fbo' });
  expect(
    diff.changes.some((c) => c.field === 'price' && c.action === 'update' && c.after === 5555),
    '0 трактуется как пустой → price обновлён',
  );
}

// 5. treatZeroAsEmpty=false: 0 НЕ считается пустым
{
  const sync = defaultSync({ conflictPolicy: 'fill-empty', treatZeroAsEmpty: false });
  const rows = [row('E1', { price: 0, stock: 0 }, '')];
  const products = [product({ article: 'E1', priceKopecks: 555500, stockMarketplace: 88 })];
  const diff = buildSyncDiff({ currentRows: rows, ozonProducts: products, sync, mode: 'fbo' });
  expect(
    !diff.changes.some((c) => c.field === 'price' && c.action === 'update'),
    'price=0 не считается пустым → skip',
  );
}

// 6. mode fbo/fbs влияет на commissionPct
{
  const sync = defaultSync({
    conflictPolicy: 'overwrite',
    columnMap: {
      article: false,
      name: false,
      price: false,
      cost: false,
      stock: false,
      volumeL: false,
      commissionPct: true,
      salesPerMonth: false,
      buyoutPct: false,
    },
  });
  const rows = [row('F1', { commissionPct: 10 }, '')];
  const products = [
    product({
      article: 'F1',
      metadata: { commissions: { fboPct: 18, fbsPct: 22 } },
    }),
  ];
  const fbo = buildSyncDiff({ currentRows: rows, ozonProducts: products, sync, mode: 'fbo' });
  expect(
    fbo.changes.some((c) => c.field === 'commissionPct' && c.after === 18),
    'mode=fbo → commissionPct=18',
  );
  const fbs = buildSyncDiff({ currentRows: rows, ozonProducts: products, sync, mode: 'fbs' });
  expect(
    fbs.changes.some((c) => c.field === 'commissionPct' && c.after === 22),
    'mode=fbs → commissionPct=22',
  );
}

// 7. Пустой ozonProducts → unchangedRows
{
  const sync = defaultSync();
  const rows = [row('G1', { price: 100 }, ''), row('G2', {}, '')];
  const diff = buildSyncDiff({ currentRows: rows, ozonProducts: [], sync, mode: 'fbo' });
  expect(diff.totals.newRows === 0, 'newRows=0');
  expect(diff.totals.updatedRows === 0, 'updatedRows=0');
  expect(diff.totals.unchangedRows === 2, 'unchangedRows=2');
  expect(diff.resultRows.length === 2, 'resultRows сохраняет порядок и количество');
}

// 8. Пустой currentRows → всё create
{
  const sync = defaultSync();
  const products = [
    product({ article: 'H1' }),
    product({ article: 'H2' }),
  ];
  const diff = buildSyncDiff({ currentRows: [], ozonProducts: products, sync, mode: 'fbo' });
  expect(diff.totals.newRows === 2, 'newRows=2');
  expect(diff.resultRows.length === 2, 'resultRows=2');
}

// 9. matchBy=sku (productId) когда нет sku в product → fallback по article
{
  // currentRow без productId; product без sku — обе стороны без sku → no match
  const sync = defaultSync({ matchBy: 'sku' });
  const rows = [row('I1', { price: 100 }, '')];
  const products = [product({ article: 'I1', sku: null })];
  const diff = buildSyncDiff({ currentRows: rows, ozonProducts: products, sync, mode: 'fbo' });
  expect(diff.totals.newRows === 1, 'matchBy=sku и нет sku — не матчим → новая строка');
}

// 10. Case-insensitive article matching
{
  const sync = defaultSync({ conflictPolicy: 'overwrite' });
  const rows = [row('  abc123  ', { price: 10 }, '')];
  const products = [product({ article: 'ABC123', priceKopecks: 999900 })];
  const diff = buildSyncDiff({ currentRows: rows, ozonProducts: products, sync, mode: 'fbo' });
  expect(diff.totals.newRows === 0, 'matchBy=article игнорирует регистр/пробелы');
  expect(diff.totals.updatedRows === 1, 'updatedRows=1');
}

console.log(`\n## ${passed} PASS · ${failed} FAIL\n`);
if (failed > 0) process.exit(1);
