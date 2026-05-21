// PURPOSE: Unit tests для virtual-sources resolver — `@__virtual:cashflow.kpi.*` bindings.
// Запуск: pnpm tsx scripts/test-virtual-sources.ts

import {
  parseVirtualCashflowBlockId,
  extractVirtualCashflowMetrics,
  VIRTUAL_CASHFLOW_BLOCK_IDS,
} from '../src/lib/blocks/virtual-sources';

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

console.log('\n=== VIRTUAL_CASHFLOW_BLOCK_IDS ===');
{
  ok('income id', VIRTUAL_CASHFLOW_BLOCK_IDS.income === '__virtual:cashflow.kpi.income');
  ok('expense id', VIRTUAL_CASHFLOW_BLOCK_IDS.expense === '__virtual:cashflow.kpi.expense');
  ok('balance id', VIRTUAL_CASHFLOW_BLOCK_IDS.balance === '__virtual:cashflow.kpi.balance');
}

console.log('\n=== parseVirtualCashflowBlockId ===');
{
  ok(
    'parses income id',
    parseVirtualCashflowBlockId('__virtual:cashflow.kpi.income')?.metric === 'income',
  );
  ok(
    'parses expense id',
    parseVirtualCashflowBlockId('__virtual:cashflow.kpi.expense')?.metric === 'expense',
  );
  ok(
    'parses balance id',
    parseVirtualCashflowBlockId('__virtual:cashflow.kpi.balance')?.metric === 'balance',
  );

  ok('rejects unknown metric', parseVirtualCashflowBlockId('__virtual:cashflow.kpi.foo') === null);
  ok('rejects non-virtual id', parseVirtualCashflowBlockId('block-123') === null);
  ok(
    'rejects field suffix (only block id)',
    parseVirtualCashflowBlockId('__virtual:cashflow.kpi.income.current') === null,
  );
}

console.log('\n=== extractVirtualCashflowMetrics ===');
{
  ok(
    'simple income ref',
    JSON.stringify(extractVirtualCashflowMetrics('=@__virtual:cashflow.kpi.income.current')) ===
      JSON.stringify(['income']),
  );

  ok(
    'multiple metrics in one formula',
    JSON.stringify(
      extractVirtualCashflowMetrics(
        '=@__virtual:cashflow.kpi.income.current - @__virtual:cashflow.kpi.expense.current',
      ).sort(),
    ) === JSON.stringify(['expense', 'income']),
  );

  ok(
    'balance + count refs',
    JSON.stringify(
      extractVirtualCashflowMetrics(
        '=@__virtual:cashflow.kpi.balance + @__virtual:cashflow.kpi.income.count',
      ).sort(),
    ) === JSON.stringify(['balance', 'income']),
  );

  ok(
    'deduplicates same metric',
    JSON.stringify(
      extractVirtualCashflowMetrics(
        '=@__virtual:cashflow.kpi.income.current + @__virtual:cashflow.kpi.income.previous',
      ),
    ) === JSON.stringify(['income']),
  );

  ok(
    'no virtual refs',
    JSON.stringify(extractVirtualCashflowMetrics('=1+2')) === JSON.stringify([]),
  );

  ok(
    'no virtual refs (regular block ref)',
    JSON.stringify(extractVirtualCashflowMetrics('=@some-block.value')) === JSON.stringify([]),
  );

  ok('empty string', JSON.stringify(extractVirtualCashflowMetrics('')) === JSON.stringify([]));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
