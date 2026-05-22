// PURPOSE: Unit tests для source binding (cashflow.transactions → consumer
// blocks). Покрывает:
//   1. SourceBinding shape (zod-валидация)
//   2. applySourceBindingMigration (idempotent auto-bind)
//   3. collectSourceBindingEdges (для mindmap)
//   4. resolveBoundContext-like merge: page-level fallback + bound filters
//
// Запуск: pnpm tsx scripts/test-source-binding.ts

import {
  applySourceBindingMigration,
  collectSourceBindingEdges,
  isBoundBlockType,
  readSourceBinding,
  readSourceBindingField,
  BOUND_BLOCK_TYPES,
  TX_BLOCK_TYPE,
} from '../src/lib/blocks/source-binding';
import type { BlockInstance, SourceBinding } from '../src/lib/blocks/types';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}`);
    failed += 1;
  }
}

function makeBlock(
  id: string,
  type: string,
  config: Record<string, unknown> = {},
): BlockInstance {
  return {
    id,
    type,
    x: 0,
    y: 0,
    w: 4,
    h: 2,
    config,
  } as BlockInstance;
}

// ---------------------------------------------------------------------------
console.log('\n=== BOUND_BLOCK_TYPES / TX_BLOCK_TYPE constants ===');
// ---------------------------------------------------------------------------
ok(
  'BOUND_BLOCK_TYPES contains stat.income/expense/balance',
  BOUND_BLOCK_TYPES.includes('stat.income') &&
    BOUND_BLOCK_TYPES.includes('stat.expense') &&
    BOUND_BLOCK_TYPES.includes('stat.balance'),
);
ok(
  'BOUND_BLOCK_TYPES contains chart.cashflow + top-categories + kpi.grid',
  BOUND_BLOCK_TYPES.includes('chart.cashflow') &&
    BOUND_BLOCK_TYPES.includes('cashflow.top-categories') &&
    BOUND_BLOCK_TYPES.includes('kpi.grid'),
);
ok(
  'BOUND_BLOCK_TYPES НЕ содержит cashflow.transactions (это источник)',
  !(BOUND_BLOCK_TYPES as readonly string[]).includes(TX_BLOCK_TYPE),
);
ok('TX_BLOCK_TYPE === "cashflow.transactions"', TX_BLOCK_TYPE === 'cashflow.transactions');
ok('isBoundBlockType("stat.income") === true', isBoundBlockType('stat.income'));
ok('isBoundBlockType("cashflow.transactions") === false', !isBoundBlockType('cashflow.transactions'));
ok('isBoundBlockType("random.block") === false', !isBoundBlockType('random.block'));

// ---------------------------------------------------------------------------
console.log('\n=== readSourceBinding / readSourceBindingField ===');
// ---------------------------------------------------------------------------
ok('undefined config → undefined', readSourceBinding(undefined) === undefined);
ok('пустой config → undefined', readSourceBinding({}) === undefined);
ok(
  'mode=empty → {mode:empty}',
  (() => {
    const r = readSourceBinding({ sourceBinding: { mode: 'empty' } });
    return r?.mode === 'empty';
  })(),
);
ok(
  'mode=global → {mode:global}',
  (() => {
    const r = readSourceBinding({ sourceBinding: { mode: 'global' } });
    return r?.mode === 'global';
  })(),
);
ok(
  'mode=block + blockId → {mode:block, blockId}',
  (() => {
    const r = readSourceBinding({
      sourceBinding: { mode: 'block', blockId: 'tx-1' },
    });
    return r?.mode === 'block' && r.blockId === 'tx-1';
  })(),
);
ok(
  'mode=block + blockId + pageKey → cross-page binding сохраняет pageKey',
  (() => {
    const r = readSourceBinding({
      sourceBinding: { mode: 'block', blockId: 'tx-1', pageKey: 'cashflow' },
    });
    return r?.mode === 'block' && 'pageKey' in r && r.pageKey === 'cashflow';
  })(),
);
ok(
  'mode=block без blockId → undefined (invalid)',
  readSourceBinding({ sourceBinding: { mode: 'block' } }) === undefined,
);
ok(
  'mode=invalid → undefined',
  readSourceBinding({ sourceBinding: { mode: 'wat' } }) === undefined,
);
ok(
  'readSourceBindingField для defaultSourceBinding',
  (() => {
    const r = readSourceBindingField(
      { defaultSourceBinding: { mode: 'global' } },
      'defaultSourceBinding',
    );
    return r?.mode === 'global';
  })(),
);
ok(
  'readSourceBindingField возвращает undefined если поля нет',
  readSourceBindingField({ foo: 'bar' }, 'sourceBindingOverride') === undefined,
);

// ---------------------------------------------------------------------------
console.log('\n=== applySourceBindingMigration ===');
// ---------------------------------------------------------------------------
{
  // Case 1: страница БЕЗ cashflow.transactions — все BOUND_BLOCK_TYPES получают
  // {mode: 'empty'}.
  const blocks = [makeBlock('a', 'stat.income'), makeBlock('b', 'chart.cashflow')];
  const migrated = applySourceBindingMigration(blocks);
  const aBinding = readSourceBinding(migrated[0].config);
  const bBinding = readSourceBinding(migrated[1].config);
  ok(
    'без tx-блока: stat.income.sourceBinding=empty',
    aBinding?.mode === 'empty',
  );
  ok(
    'без tx-блока: chart.cashflow.sourceBinding=empty',
    bBinding?.mode === 'empty',
  );
}
{
  // Case 2: с cashflow.transactions — все BOUND_BLOCK_TYPES получают
  // {mode: 'block', blockId: <tx>}.
  const blocks = [
    makeBlock('tx-1', TX_BLOCK_TYPE),
    makeBlock('a', 'stat.income'),
    makeBlock('b', 'kpi.grid'),
  ];
  const migrated = applySourceBindingMigration(blocks);
  const aBinding = readSourceBinding(migrated[1].config);
  const bBinding = readSourceBinding(migrated[2].config);
  const bDefault = readSourceBindingField(
    migrated[2].config ?? {},
    'defaultSourceBinding',
  );
  ok(
    'с tx-блоком: stat.income auto-bind {mode:block, blockId:tx-1}',
    aBinding?.mode === 'block' && aBinding.blockId === 'tx-1',
  );
  ok(
    'с tx-блоком: kpi.grid.sourceBinding auto-bind {mode:block, blockId:tx-1}',
    bBinding?.mode === 'block' && bBinding.blockId === 'tx-1',
  );
  ok(
    'с tx-блоком: kpi.grid.defaultSourceBinding auto-bind {mode:block, blockId:tx-1}',
    bDefault?.mode === 'block' && bDefault.blockId === 'tx-1',
  );
}
{
  // Case 3: idempotent — повторная миграция не меняет уже привязанные блоки.
  const original = [
    makeBlock('tx-1', TX_BLOCK_TYPE),
    makeBlock('a', 'stat.income', { sourceBinding: { mode: 'global' } }),
  ];
  const first = applySourceBindingMigration(original);
  const second = applySourceBindingMigration(first);
  const firstBinding = readSourceBinding(first[1].config);
  const secondBinding = readSourceBinding(second[1].config);
  ok(
    'idempotent: явный global binding не перетирается',
    firstBinding?.mode === 'global' && secondBinding?.mode === 'global',
  );
}
{
  // Case 4: cashflow.transactions сам никогда не получает sourceBinding.
  const blocks = [
    makeBlock('tx-1', TX_BLOCK_TYPE),
    makeBlock('tx-2', TX_BLOCK_TYPE),
  ];
  const migrated = applySourceBindingMigration(blocks);
  ok(
    'tx-блок не получает sourceBinding (он сам источник)',
    readSourceBinding(migrated[0].config) === undefined &&
      readSourceBinding(migrated[1].config) === undefined,
  );
}
{
  // Case 5: первый tx-блок выбирается как auto-bind target (по порядку).
  const blocks = [
    makeBlock('tx-A', TX_BLOCK_TYPE),
    makeBlock('tx-B', TX_BLOCK_TYPE),
    makeBlock('s', 'stat.expense'),
  ];
  const migrated = applySourceBindingMigration(blocks);
  const sBinding = readSourceBinding(migrated[2].config);
  ok(
    'auto-bind использует ПЕРВЫЙ tx-блок (tx-A, не tx-B)',
    sBinding?.mode === 'block' && sBinding.blockId === 'tx-A',
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== collectSourceBindingEdges ===');
// ---------------------------------------------------------------------------
{
  // Case 1: simple binding → 1 edge.
  const blocks = [
    makeBlock('tx-1', TX_BLOCK_TYPE),
    makeBlock('a', 'stat.income', { sourceBinding: { mode: 'block', blockId: 'tx-1' } }),
  ];
  const edges = collectSourceBindingEdges(blocks);
  ok('simple binding: 1 edge', edges.length === 1);
  ok(
    'edge: from=tx-1, to=a, без pageKey (same-page)',
    edges[0]?.fromId === 'tx-1' && edges[0]?.toId === 'a' && edges[0]?.pageKey === undefined,
  );
}
{
  // Case 2: empty/global binding → 0 edges.
  const blocks = [
    makeBlock('tx-1', TX_BLOCK_TYPE),
    makeBlock('a', 'stat.income', { sourceBinding: { mode: 'empty' } }),
    makeBlock('b', 'chart.cashflow', { sourceBinding: { mode: 'global' } }),
  ];
  const edges = collectSourceBindingEdges(blocks);
  ok('empty/global binding: 0 edges (нет data-source связи)', edges.length === 0);
}
{
  // Case 3: kpi.grid с defaultSourceBinding + per-cell override → 2 edges.
  const blocks = [
    makeBlock('tx-1', TX_BLOCK_TYPE),
    makeBlock('tx-2', TX_BLOCK_TYPE),
    makeBlock('grid', 'kpi.grid', {
      defaultSourceBinding: { mode: 'block', blockId: 'tx-1' },
      cells: [
        { id: 'c1', sourceBindingOverride: { mode: 'block', blockId: 'tx-2' } },
        { id: 'c2' }, // наследует default
      ],
    }),
  ];
  const edges = collectSourceBindingEdges(blocks);
  ok(
    'kpi.grid: 2 unique edges (default tx-1 + cell override tx-2)',
    edges.length === 2,
  );
  ok(
    'kpi.grid: edge tx-1 → grid (block-level default)',
    edges.some((e) => e.fromId === 'tx-1' && e.toId === 'grid'),
  );
  ok(
    'kpi.grid: edge tx-2 → grid (per-cell override)',
    edges.some((e) => e.fromId === 'tx-2' && e.toId === 'grid'),
  );
}
{
  // Case 4: cross-page binding → pageKey проставляется.
  const blocks = [
    makeBlock('a', 'stat.income', {
      sourceBinding: { mode: 'block', blockId: 'tx-far', pageKey: 'cashflow' },
    }),
  ];
  const edges = collectSourceBindingEdges(blocks, 'dashboard');
  ok(
    'cross-page binding (dashboard → cashflow): pageKey=cashflow в edge',
    edges.length === 1 && edges[0]?.pageKey === 'cashflow',
  );
}
{
  // Case 5: same-page binding → pageKey НЕ проставляется (даже если в binding есть).
  const blocks = [
    makeBlock('tx', TX_BLOCK_TYPE),
    makeBlock('a', 'stat.income', {
      sourceBinding: { mode: 'block', blockId: 'tx', pageKey: 'dashboard' },
    }),
  ];
  const edges = collectSourceBindingEdges(blocks, 'dashboard');
  ok(
    'same-page binding: pageKey=undefined в edge (хотя в binding указан)',
    edges.length === 1 && edges[0]?.pageKey === undefined,
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== resolveBoundContext-like merge: page fallback + bound filters ===');
// ---------------------------------------------------------------------------
type BoundFilters = {
  period:
    | { preset: string; customFrom: string | null; customTo: string | null }
    | null;
  type: 'income' | 'expense' | null;
  source: string | null | undefined;
  counterparty: string | null;
  categoryName: string | null;
};
type PagePeriod = { preset: string; customFrom: string | null; customTo: string | null };

function resolveBound(
  binding: SourceBinding,
  filters: BoundFilters | null,
  pagePeriod: PagePeriod,
  pageSource: string | null,
): { skip: boolean; period: PagePeriod; source: string | null } {
  if (binding.mode === 'empty') return { skip: true, period: pagePeriod, source: pageSource };
  if (binding.mode === 'global') return { skip: false, period: pagePeriod, source: pageSource };
  if (!filters) return { skip: true, period: pagePeriod, source: pageSource };
  return {
    skip: false,
    period: filters.period ?? pagePeriod,
    source: filters.source === undefined ? pageSource : filters.source,
  };
}

const PAGE_PERIOD: PagePeriod = { preset: 'mtd', customFrom: null, customTo: null };
const PAGE_SOURCE: string | null = null;

{
  const r = resolveBound({ mode: 'empty' }, null, PAGE_PERIOD, PAGE_SOURCE);
  ok('empty mode → skipFetch=true', r.skip === true);
}
{
  const r = resolveBound({ mode: 'global' }, null, PAGE_PERIOD, PAGE_SOURCE);
  ok('global mode → skip=false, period=pagePeriod', r.skip === false && r.period.preset === 'mtd');
}
{
  // block mode + bound filters: используем period+source из bound.
  const r = resolveBound(
    { mode: 'block', blockId: 'tx-1' },
    {
      period: { preset: '7d', customFrom: null, customTo: null },
      type: 'income',
      source: 'tinkoff',
      counterparty: null,
      categoryName: null,
    },
    PAGE_PERIOD,
    PAGE_SOURCE,
  );
  ok('block mode: period=7d (из bound)', r.period.preset === '7d');
  ok('block mode: source=tinkoff (из bound)', r.source === 'tinkoff');
}
{
  // block mode + bound period=null → fallback к pagePeriod.
  const r = resolveBound(
    { mode: 'block', blockId: 'tx-1' },
    {
      period: null,
      type: null,
      source: undefined,
      counterparty: null,
      categoryName: null,
    },
    PAGE_PERIOD,
    PAGE_SOURCE,
  );
  ok(
    'block mode + bound period=null → fallback к pagePeriod (mtd)',
    r.period.preset === 'mtd',
  );
  ok(
    'block mode + bound source=undefined → fallback к pageSource',
    r.source === PAGE_SOURCE,
  );
}
{
  // block mode без filters (missing source) → skip.
  const r = resolveBound({ mode: 'block', blockId: 'tx-deleted' }, null, PAGE_PERIOD, PAGE_SOURCE);
  ok('block mode + filters=null (missing) → skipFetch=true', r.skip === true);
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
