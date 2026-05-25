// PURPOSE: Тесты для Excel-like fill-handle в блоке custom.data (v0.23.4).
//
// Покрытие:
//   - shiftFormulaRefs: A1-сдвиг, #REF! при выходе, пропуск @-токенов / [Row].col / "строк".
//   - fillCellFromSource: формула / binding / литерал.
//   - computeFillTargets: vertical/horizontal, up/down/left/right.
//   - isInFillRange: source/hover включительно.
//
// Запуск: pnpm tsx scripts/test-fill-handle.ts

import {
  shiftFormulaRefs,
  fillCellFromSource,
  computeFillTargets,
  isInFillRange,
} from '../src/lib/blocks/custom-data-fill';

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
function eq(label: string, actual: unknown, expected: unknown) {
  ok(`${label} → ${JSON.stringify(actual)}`, JSON.stringify(actual) === JSON.stringify(expected));
}

// ============================================================================
console.log('\n=== shiftFormulaRefs — базовый сдвиг A1 ===');
eq('=A1 + 1, dRow=+1', shiftFormulaRefs('=A1+1', 1, 0, 10, 10), '=A2+1');
eq('=A1 + B1, dRow=+2', shiftFormulaRefs('=A1+B1', 2, 0, 10, 10), '=A3+B3');
eq('=A5 - 5, dRow=-3', shiftFormulaRefs('=A5-5', -3, 0, 10, 10), '=A2-5');
eq('=A1 + B2, dCol=+1', shiftFormulaRefs('=A1+B2', 0, 1, 10, 10), '=B1+C2');

console.log('\n=== shiftFormulaRefs — out-of-bounds → #REF! ===');
eq('out of rows', shiftFormulaRefs('=A1+1', -1, 0, 10, 10), '=#REF!+1');
eq('out of cols', shiftFormulaRefs('=A1+1', 0, -1, 10, 10), '=#REF!+1');
eq('partial out (B1 stays, A1 → ref)', shiftFormulaRefs('=A1+B5', 0, -1, 10, 10), '=#REF!+A5');

console.log('\n=== shiftFormulaRefs — SUM/range references ===');
eq('=SUM(A1:A5), dRow=+1', shiftFormulaRefs('=SUM(A1:A5)', 1, 0, 100, 10), '=SUM(A2:A6)');
eq('SUM keyword не сдвигается', shiftFormulaRefs('=SUM(B2:B4)/2', 0, 1, 100, 10), '=SUM(C2:C4)/2');

console.log('\n=== shiftFormulaRefs — пропуск @-токенов и [Row].col ===');
eq('@-ref не трогаем', shiftFormulaRefs('=@blockA1+A1', 1, 0, 10, 10), '=@blockA1+A2');
eq('@block.field не трогаем', shiftFormulaRefs('=@b1.val1+A1', 1, 0, 10, 10), '=@b1.val1+A2');
eq('[Row].col абсолютны', shiftFormulaRefs('=[Total].amount+A1', 1, 0, 10, 10), '=[Total].amount+A2');

console.log('\n=== shiftFormulaRefs — non-formula passthrough ===');
eq('literal число', shiftFormulaRefs('42', 1, 0, 10, 10), '42');
eq('text', shiftFormulaRefs('hello', 1, 0, 10, 10), 'hello');

// ============================================================================
console.log('\n=== fillCellFromSource — формула со сдвигом ===');
{
  const filled = fillCellFromSource({ v: '=A1*B1' }, 1, 0, 10, 10);
  eq('formula shift', filled.v, '=A2*B2');
}

console.log('\n=== fillCellFromSource — binding копируется absolute ===');
{
  const src = { v: 100, ref: 'block:other.value', isMoney: true };
  const filled = fillCellFromSource(src, 5, 0, 10, 10);
  eq('binding ref preserved', filled.ref, 'block:other.value');
  eq('binding isMoney preserved', filled.isMoney, true);
}

console.log('\n=== fillCellFromSource — литерал копируется как есть ===');
{
  const filled = fillCellFromSource({ v: 42 }, 3, 0, 10, 10);
  eq('literal 42', filled.v, 42);
}

console.log('\n=== fillCellFromSource — пустая ячейка ===');
{
  const filled = fillCellFromSource(undefined, 0, 0, 10, 10);
  eq('undefined → empty cell', filled, { v: null });
}

// ============================================================================
console.log('\n=== computeFillTargets — vertical down ===');
{
  const { targets, direction } = computeFillTargets(
    { rowIdx: 0, colIdx: 1 },
    { rowIdx: 3, colIdx: 1 },
  );
  eq('direction', direction, 'vertical');
  eq('targets', targets, [
    { rowIdx: 1, colIdx: 1 },
    { rowIdx: 2, colIdx: 1 },
    { rowIdx: 3, colIdx: 1 },
  ]);
}

console.log('\n=== computeFillTargets — vertical up ===');
{
  const { targets, direction } = computeFillTargets(
    { rowIdx: 4, colIdx: 0 },
    { rowIdx: 1, colIdx: 0 },
  );
  eq('direction', direction, 'vertical');
  eq('targets reversed', targets, [
    { rowIdx: 3, colIdx: 0 },
    { rowIdx: 2, colIdx: 0 },
    { rowIdx: 1, colIdx: 0 },
  ]);
}

console.log('\n=== computeFillTargets — horizontal right ===');
{
  const { targets, direction } = computeFillTargets(
    { rowIdx: 2, colIdx: 0 },
    { rowIdx: 2, colIdx: 3 },
  );
  eq('direction', direction, 'horizontal');
  eq('targets', targets, [
    { rowIdx: 2, colIdx: 1 },
    { rowIdx: 2, colIdx: 2 },
    { rowIdx: 2, colIdx: 3 },
  ]);
}

console.log('\n=== computeFillTargets — diagonal → больший delta wins ===');
{
  // dR=3, dC=1 → vertical
  const { direction } = computeFillTargets({ rowIdx: 0, colIdx: 0 }, { rowIdx: 3, colIdx: 1 });
  eq('mostly vertical', direction, 'vertical');
}
{
  // dR=1, dC=4 → horizontal
  const { direction } = computeFillTargets({ rowIdx: 0, colIdx: 0 }, { rowIdx: 1, colIdx: 4 });
  eq('mostly horizontal', direction, 'horizontal');
}

console.log('\n=== computeFillTargets — same cell → no targets ===');
{
  const { targets } = computeFillTargets({ rowIdx: 0, colIdx: 0 }, { rowIdx: 0, colIdx: 0 });
  eq('empty targets', targets, []);
}

// ============================================================================
console.log('\n=== isInFillRange ===');
{
  const src = { rowIdx: 1, colIdx: 1 };
  const hov = { rowIdx: 3, colIdx: 1 };
  ok('source included', isInFillRange(src, hov, 1, 1));
  ok('hover included', isInFillRange(src, hov, 3, 1));
  ok('middle included', isInFillRange(src, hov, 2, 1));
  ok('outside not included', !isInFillRange(src, hov, 4, 1));
  ok('different col not included', !isInFillRange(src, hov, 2, 2));
}

// ============================================================================
console.log('\n=== Realistic scenario: формула в "Итог" протягивается вниз ===');
{
  // Колонки: 0=Кол-во, 1=Дозировка, 2=Итог (=A1*B1)
  // Row 0 (source): cells.Итог.v = '=A1*B1'
  // После fill вниз в row 1, row 2 формулы должны стать =A2*B2 и =A3*B3.
  const sourceFormula = '=A1*B1';
  const r1 = fillCellFromSource({ v: sourceFormula }, 1, 0, 10, 3);
  const r2 = fillCellFromSource({ v: sourceFormula }, 2, 0, 10, 3);
  eq('row+1 formula', r1.v, '=A2*B2');
  eq('row+2 formula', r2.v, '=A3*B3');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
