// PURPOSE: Smoke-тест чистого `computeRowValues` блока «Мой магазин».
// Покрывает фикс v0.39.0: формульная колонка с «осиротевшим» сырым числом в
// row.values использует column-formula (не затеняется), а `=`-override —
// работает и пробрасывает зависимости. Запуск: pnpm tsx scripts/test-my-store-compute.ts

import {
  computeRowValues,
  isCellFormulaValue,
  type MyStoreComputeColumn,
} from '../src/lib/unit-economics/my-store-compute';

let passed = 0;
let failed = 0;
function ok(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}`, extra !== undefined ? `→ ${JSON.stringify(extra)}` : '');
  }
}
function approx(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}

// Сценарий пользователя: цена кг (money) → цена 1гр (=tsenakg/1000) → цена 1мг (=tsena1gr/1000).
const columns: MyStoreComputeColumn[] = [
  { id: 'article', type: 'identity' },
  { id: 'tsenakg', type: 'money' },
  { id: 'tsena1gr', type: 'formula' },
  { id: 'tsena1mg', type: 'formula' },
  { id: 'cost', type: 'number' },
];
const formulasMap: Record<string, string | undefined> = {
  tsena1gr: '=tsenakg/1000',
  tsena1mg: '=tsena1gr/1000',
};

console.log('=== isCellFormulaValue ===');
ok('=-строка → true', isCellFormulaValue('=tsena1gr/1000') === true);
ok('число → false', isCellFormulaValue(7500) === false);
ok('обычный текст → false', isCellFormulaValue('abc') === false);
ok('пусто → false', isCellFormulaValue('') === false);

console.log('=== БАГ-ФИКС: осиротевшее число в формульной колонке игнорируется ===');
{
  // У формульной колонки tsena1mg в row.values осталось СТАРОЕ число 7500
  // (например, колонка была money, потом стала formula). Оно НЕ должно затенять формулу.
  const row = { values: { tsenakg: 7500000, tsena1mg: 7500 }, bindings: {} };
  const r = computeRowValues(row, columns, 0, 6, formulasMap, undefined);
  ok('tsena1gr = 7500 (tsenakg/1000)', approx(Number(r.tsena1gr), 7500), r.tsena1gr);
  ok('tsena1mg = 7.5 (формула, НЕ осиротевшие 7500)', approx(Number(r.tsena1mg), 7.5), r.tsena1mg);
  ok('осиротевшее значение реально игнорится (не 7500)', Number(r.tsena1mg) !== 7500, r.tsena1mg);
}

console.log('=== БАГ-ФИКС: маленькие числа считаются верно (0,05) ===');
{
  // tsenakg = 45000 → tsena1gr = 45 → tsena1mg = 0.045.
  const row = { values: { tsenakg: 45000 }, bindings: {} };
  const r = computeRowValues(row, columns, 0, 6, formulasMap, undefined);
  ok('tsena1gr = 45', approx(Number(r.tsena1gr), 45), r.tsena1gr);
  ok('tsena1mg = 0.045', approx(Number(r.tsena1mg), 0.045), r.tsena1mg);
}

console.log('=== per-cell =-override формульной колонки работает ===');
{
  const row = { values: { tsenakg: 7500000, tsena1mg: '=tsena1gr/500' }, bindings: {} };
  const r = computeRowValues(row, columns, 0, 6, formulasMap, undefined);
  ok('override: tsena1mg = 15 (7500/500)', approx(Number(r.tsena1mg), 15), r.tsena1mg);
}

console.log('=== per-cell override пробрасывает зависимости ===');
{
  // Override на tsena1gr → tsena1mg пересчитывается от него.
  const row = { values: { tsenakg: 7500000, tsena1gr: '=tsenakg/2000' }, bindings: {} };
  const r = computeRowValues(row, columns, 0, 6, formulasMap, undefined);
  ok('tsena1gr override = 3750 (7500000/2000)', approx(Number(r.tsena1gr), 3750), r.tsena1gr);
  ok('tsena1mg = 3.75 (от override tsena1gr)', approx(Number(r.tsena1mg), 3.75), r.tsena1mg);
}

console.log('=== литерал-override как =N (как пишет writeSession) ===');
{
  const row = { values: { tsenakg: 7500000, tsena1mg: '=42' }, bindings: {} };
  const r = computeRowValues(row, columns, 0, 6, formulasMap, undefined);
  ok('=42 → tsena1mg = 42', approx(Number(r.tsena1mg), 42), r.tsena1mg);
}

console.log('=== per-cell формула на НЕ-формульной колонке ===');
{
  const row = { values: { tsenakg: 7500000, cost: '=tsenakg/100000' }, bindings: {} };
  const r = computeRowValues(row, columns, 0, 6, formulasMap, undefined);
  ok('cost = 75 (=tsenakg/100000)', approx(Number(r.cost), 75), r.cost);
}

console.log('=== обычное значение НЕ-формульной колонки сохраняется ===');
{
  const row = { values: { tsenakg: 7500000, cost: 333 }, bindings: {} };
  const r = computeRowValues(row, columns, 0, 6, formulasMap, undefined);
  ok('cost = 333 (literal)', approx(Number(r.cost), 333), r.cost);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
