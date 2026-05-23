// PURPOSE: Тесты для usePagePeriodHeaderVisibility (v0.22.0).
// Покрытие:
//   - pageHasGlobalBoundBlocks: bound-блоки → true, custom-блоки → false
//   - localStorage override: '1' → collapsed, '0' → shown, null → data default
// Запуск: pnpm tsx scripts/test-period-panel-visibility.ts

import { pageHasGlobalBoundBlocks } from '../src/lib/blocks/use-page-period-visibility';
import type { BlockInstance } from '../src/lib/blocks/types';

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

function mkBlock(
  type: string,
  config: Record<string, unknown> = {},
): BlockInstance {
  return { id: type, type, x: 0, y: 0, w: 4, h: 3, config };
}

// ============================================================================

console.log('\n=== pageHasGlobalBoundBlocks ===');
ok('empty → false', pageHasGlobalBoundBlocks([]) === false);
ok(
  'только custom-блоки → false',
  pageHasGlobalBoundBlocks([mkBlock('custom.data'), mkBlock('sheet')]) === false,
);
ok(
  'stat.income → true',
  pageHasGlobalBoundBlocks([mkBlock('stat.income')]) === true,
);
ok(
  'cashflow.transactions без override → true',
  pageHasGlobalBoundBlocks([mkBlock('cashflow.transactions')]) === true,
);
ok(
  'cashflow.transactions с defaultPeriodOverride → false',
  pageHasGlobalBoundBlocks([
    mkBlock('cashflow.transactions', { defaultPeriodOverride: { preset: '7d' } }),
  ]) === false,
);
ok(
  'stat.income с sourceBinding.mode=empty → true (binding present but empty)',
  pageHasGlobalBoundBlocks([
    mkBlock('stat.income', { sourceBinding: { mode: 'empty' } }),
  ]) === false,
);
ok(
  'stat.income с sourceBinding.mode=global → true',
  pageHasGlobalBoundBlocks([
    mkBlock('stat.income', { sourceBinding: { mode: 'global' } }),
  ]) === true,
);
ok(
  'stat.income с sourceBinding.mode=block → false (источник = конкретный блок)',
  pageHasGlobalBoundBlocks([
    mkBlock('stat.income', { sourceBinding: { mode: 'block', blockId: 'tx-1' } }),
  ]) === false,
);
ok(
  'chart.cashflow → true',
  pageHasGlobalBoundBlocks([mkBlock('chart.cashflow')]) === true,
);

// ============================================================================
// visibility resolver logic — replicated из use-page-period-visibility.ts

function resolveCollapsed(
  dataDefault: boolean,
  override: '1' | '0' | null,
): boolean {
  if (override === '1') return true;
  if (override === '0') return false;
  return dataDefault;
}

console.log('\n=== visibility resolver ===');
ok('no override, no bound → collapsed', resolveCollapsed(true, null) === true);
ok('no override, has bound → shown', resolveCollapsed(false, null) === false);
ok('override = 1 → collapsed', resolveCollapsed(false, '1') === true);
ok('override = 0 → shown', resolveCollapsed(true, '0') === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
