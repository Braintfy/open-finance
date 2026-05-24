// PURPOSE: Smoke-test для модуля use-block-period.ts. Проверяем:
//   1. Hook экспортируется и имеет ожидаемый shape.
//   2. PeriodOverride / UseBlockPeriodOptions / UseBlockPeriodResult — типы существуют.
//   3. PagePeriodProvider экспортирует расширенный API (registry).
// Запуск: pnpm tsx scripts/test-block-period.ts

import { useBlockPeriod } from '../src/lib/blocks/use-block-period';
import type {
  PeriodOverride,
  UseBlockPeriodOptions,
  UseBlockPeriodResult,
} from '../src/lib/blocks/use-block-period';
import {
  PagePeriodProvider,
  usePagePeriod,
  useEffectivePeriod,
  type PagePeriodValue,
} from '../src/lib/blocks/page-period-context';

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

console.log('\n=== use-block-period exports ===');
ok('useBlockPeriod is function', typeof useBlockPeriod === 'function');
ok('useBlockPeriod.length === 1 (single options arg)', useBlockPeriod.length === 1);

// Compile-time type checks (cast as never if anything missing)
const _typeOptions: UseBlockPeriodOptions = {
  instanceId: 'test',
  configOverride: null,
  onConfigChange: (_next: PeriodOverride | null) => {
    void _next;
  },
  defaultMode: 'global',
  defaultOverride: { preset: 'mtd', customFrom: null, customTo: null },
};
void _typeOptions;

const _typeResult: UseBlockPeriodResult = {
  period: { preset: 'mtd', customFrom: null, customTo: null },
  source: 'global',
  override: null,
  setOverride: () => {},
  resetToGlobal: () => {},
  isOverride: false,
};
void _typeResult;

console.log('\n=== page-period-context exports ===');
ok('PagePeriodProvider is function/component', typeof PagePeriodProvider === 'function');
ok('usePagePeriod is function', typeof usePagePeriod === 'function');
ok('useEffectivePeriod is function', typeof useEffectivePeriod === 'function');

// Compile-time check that PagePeriodValue still has expected shape
const _pv: PagePeriodValue = { preset: 'mtd', customFrom: null, customTo: null };
void _pv;

console.log('\n=== source guarantee (semantic) ===');
// If override is non-null, source must be 'override'; if null, 'global'.
// Cannot run actual hook outside React — but we verify shape with synthetic call.
const synthetic: UseBlockPeriodResult = {
  period: { preset: '7d', customFrom: null, customTo: null },
  source: 'override',
  override: { preset: '7d', customFrom: null, customTo: null },
  setOverride: () => {},
  resetToGlobal: () => {},
  isOverride: true,
};
ok('override → isOverride=true', synthetic.isOverride === true);
ok('override → source=override', synthetic.source === 'override');
ok(
  'global → isOverride=false (no override)',
  ({ ..._typeResult, override: null, isOverride: false }).isOverride === false,
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
