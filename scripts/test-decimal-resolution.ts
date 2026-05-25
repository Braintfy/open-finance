// PURPOSE: Тесты для resolveShowKopecks + formatColumnValue (v0.23.3) — переключатель
// «Дробная часть» в блоке custom.data на уровне block / column / row.
//
// Запуск: pnpm tsx scripts/test-decimal-resolution.ts

import {
  resolveShowKopecks,
  resolveBlockShowKopecks,
  formatColumnValue,
} from '../src/lib/blocks/catalog/custom-data';
import { parseNumberLoose } from '../src/lib/blocks/custom-data-formulas';

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

// ============================================================================

console.log('\n=== resolveShowKopecks — base cases ===');
ok('blockDefault=true, no overrides → true',
  resolveShowKopecks(undefined, undefined, true) === true);
ok('blockDefault=false, no overrides → false',
  resolveShowKopecks(undefined, undefined, false) === false);

console.log('\n=== Column override beats blockDefault ===');
ok('col=true beats blockDefault=false',
  resolveShowKopecks(undefined, { showKopecks: true }, false) === true);
ok('col=false beats blockDefault=true',
  resolveShowKopecks(undefined, { showKopecks: false }, true) === false);

console.log('\n=== Row override beats column ===');
ok('row=false beats col=true (block=true)',
  resolveShowKopecks({ showKopecks: false }, { showKopecks: true }, true) === false);

console.log('\n=== resolveBlockShowKopecks ===');
ok('explicit true → true', resolveBlockShowKopecks(true, false) === true);
ok('explicit false → false', resolveBlockShowKopecks(false, true) === false);
ok('null → true (block Excel default)', resolveBlockShowKopecks(null, false) === true);
ok('undefined → true (block Excel default)', resolveBlockShowKopecks(undefined, false) === true);

console.log('\n=== blockDefault=true → 0.01 visible in number column ===');
ok('0.01 dosage cell', formatColumnValue(0.01, 'number', true) === '0,01');
ok('0.01 hidden when col override false',
  formatColumnValue(0.01, 'number', false) === '0');

console.log('\n=== parseNumberLoose — en decimal dot ===');
ok('16.666… parses correctly',
  parseNumberLoose('16.666666666666668') !== null &&
    Math.abs(parseNumberLoose('16.666666666666668')! - 16.666666666666668) < 1e-10);

console.log('\n=== formatColumnValue — text column with formula float ===');
{
  const raw = 16.666666666666668;
  ok('text + showKopecks=true → max 2 digits (ru)',
    formatColumnValue(raw, 'text', true) === '16,67');
  ok('text + showKopecks=false → integer',
    formatColumnValue(raw, 'text', false) === '17');
  ok('text literal stays as-is',
    formatColumnValue('синий CL', 'text', false) === 'синий CL');
}

console.log('\n=== formatColumnValue — rubles column (values in rubles, not kopecks) ===');
{
  ok('0.01 ₽ shows', formatColumnValue(0.01, 'rubles', true).includes('0,01'));
  ok('1.5 ₽ shows', formatColumnValue(1.5, 'rubles', true).includes('1,50'));
}
{
  ok('number 0.6 show → 0,6', formatColumnValue(0.6, 'number', true) === '0,6');
  ok('number 0.6 hide → 1', formatColumnValue(0.6, 'number', false) === '1');
  ok('number 16.666 show → 16,67',
    formatColumnValue(16.666666666666668, 'number', true) === '16,67');
  ok('number 16.666 hide → 17',
    formatColumnValue(16.666666666666668, 'number', false) === '17');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
