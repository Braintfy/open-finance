// PURPOSE: Тесты для evaluator'а custom-data-formulas — литерал/A1/range/
// named alias/cross-block @blockId/cycle/error/money detection.
// Запуск: pnpm tsx scripts/test-custom-data-formulas.ts

import {
  evaluateCustomCell,
  evaluateAllCells,
  cellAddress,
  preprocessNamedRefs,
  type FormulaEvalContext,
  type FormulaRow,
  type FormulaColumn,
  type FormulaCell,
} from '../src/lib/blocks/custom-data-formulas';

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

function mkCtx(
  rows: FormulaRow[],
  columns: FormulaColumn[],
  extra?: Partial<FormulaEvalContext>,
): FormulaEvalContext {
  return { rows, columns, ...extra };
}

function mkCell(v: number | string | null, extras?: Partial<FormulaCell>): FormulaCell {
  return { v, ...extras };
}

// ============================================================================

console.log('\n# Литералы');

{
  const ctx = mkCtx(
    [{ id: 'r1', label: 'Row 1', cells: { c: mkCell(1000) } }],
    [{ id: 'c', label: 'Сумма', format: 'rubles' }],
  );
  const r = evaluateCustomCell(ctx.rows[0].cells.c, { rowIdx: 0, colIdx: 0 }, ctx);
  expect(r.value === 1000, 'number literal → 1000');
  expect(r.kind === 'literal', 'kind = literal');
  expect(r.money === true, 'rubles column → money: true');
}

{
  const ctx = mkCtx(
    [{ id: 'r1', label: 'Row 1', cells: { c: mkCell(null) } }],
    [{ id: 'c', label: 'Сумма', format: 'number' }],
  );
  const r = evaluateCustomCell(ctx.rows[0].cells.c, { rowIdx: 0, colIdx: 0 }, ctx);
  expect(r.value === null, 'null literal → null');
  expect(r.kind === 'empty', 'kind = empty');
  expect(r.money === false, 'number column → money: false');
}

{
  const ctx = mkCtx(
    [{ id: 'r1', label: 'Row 1', cells: { c: mkCell('Hello') } }],
    [{ id: 'c', label: 'Заметка', format: 'text' }],
  );
  const r = evaluateCustomCell(ctx.rows[0].cells.c, { rowIdx: 0, colIdx: 0 }, ctx);
  expect(r.value === 'Hello', 'string literal → "Hello"');
  expect(r.kind === 'literal', 'kind = literal');
}

console.log('\n# A1 cross-cell formula');

{
  const ctx = mkCtx(
    [
      { id: 'r1', label: 'Row 1', cells: { a: mkCell(10), b: mkCell(20) } },
      { id: 'r2', label: 'Row 2', cells: { a: mkCell('=A1+B1') } },
    ],
    [
      { id: 'a', label: 'A', format: 'number' },
      { id: 'b', label: 'B', format: 'number' },
    ],
  );
  const r = evaluateCustomCell(ctx.rows[1].cells.a, { rowIdx: 1, colIdx: 0 }, ctx);
  expect(r.value === 30, '=A1+B1 → 30');
  expect(r.kind === 'formula', 'kind = formula');
  expect(r.error === undefined, 'no error');
}

{
  // =A1*B1 + умножение через fast-formula-parser
  const ctx = mkCtx(
    [{ id: 'r1', label: 'Row 1', cells: { a: mkCell(5), b: mkCell(7), c: mkCell('=A1*B1') } }],
    [
      { id: 'a', label: 'A', format: 'number' },
      { id: 'b', label: 'B', format: 'number' },
      { id: 'c', label: 'Product', format: 'number' },
    ],
  );
  const r = evaluateCustomCell(ctx.rows[0].cells.c, { rowIdx: 0, colIdx: 2 }, ctx);
  expect(r.value === 35, '=A1*B1 → 35');
}

console.log('\n# Named alias [Row].col');

{
  const ctx = mkCtx(
    [
      { id: 'r1', label: 'Метиленовый синий', cells: { qty: mkCell(1000), dose: mkCell(10) } },
      { id: 'r2', label: 'Калькуляция', cells: { qty: mkCell('=[Метиленовый синий].qty * 0.5') } },
    ],
    [
      { id: 'qty', label: 'Количество', format: 'number' },
      { id: 'dose', label: 'Дозировка', format: 'number' },
    ],
  );
  const r = evaluateCustomCell(ctx.rows[1].cells.qty, { rowIdx: 1, colIdx: 0 }, ctx);
  expect(r.value === 500, '[Метиленовый синий].qty*0.5 → 500');
}

{
  // Bracket-bracket form для column с пробелами в label
  const ctx = mkCtx(
    [{ id: 'r1', label: 'Метиленовый синий', cells: { c1: mkCell(800) } }],
    [{ id: 'c1', label: 'Цена шт', format: 'rubles' }],
  );
  const pp = preprocessNamedRefs('=[Метиленовый синий].[Цена шт] + 200', ctx);
  expect(pp.transformed === '=A1 + 200', `bracket-bracket → "=A1 + 200" (got: ${pp.transformed})`);
}

{
  // Case-insensitive label matching
  const ctx = mkCtx(
    [{ id: 'r1', label: 'Метиленовый Синий', cells: { qty: mkCell(100) } }],
    [{ id: 'qty', label: 'Количество', format: 'number' }],
  );
  const r = evaluateCustomCell(
    mkCell('=[метиленовый синий].qty + 50'),
    { rowIdx: 1, colIdx: 0 },
    ctx,
  );
  expect(r.value === 150, 'case-insensitive label → 150');
}

console.log('\n# Range (SUM)');

{
  const ctx = mkCtx(
    [
      { id: 'r1', label: 'R1', cells: { a: mkCell(10) } },
      { id: 'r2', label: 'R2', cells: { a: mkCell(20) } },
      { id: 'r3', label: 'R3', cells: { a: mkCell(30) } },
      { id: 'r4', label: 'Total', cells: { a: mkCell('=SUM(A1:A3)') } },
    ],
    [{ id: 'a', label: 'A', format: 'number' }],
  );
  const r = evaluateCustomCell(ctx.rows[3].cells.a, { rowIdx: 3, colIdx: 0 }, ctx);
  expect(r.value === 60, '=SUM(A1:A3) → 60');
}

console.log('\n# Cross-block @blockId.field');

{
  const ctx = mkCtx(
    [{ id: 'r1', label: 'Row', cells: { a: mkCell('=@external.value + 100') } }],
    [{ id: 'a', label: 'A', format: 'number' }],
    {
      liveValues: { 'external.value': 500 },
      moneyRefs: {},
    },
  );
  const r = evaluateCustomCell(ctx.rows[0].cells.a, { rowIdx: 0, colIdx: 0 }, ctx);
  expect(r.value === 600, '=@external.value+100 → 600');
  expect(r.money === false, 'money=false (no moneyRef)');
}

{
  const ctx = mkCtx(
    [{ id: 'r1', label: 'Row', cells: { a: mkCell('=@kpi-block + 0') } }],
    [{ id: 'a', label: 'A', format: 'number' }],
    {
      liveValues: { 'kpi-block': 12345 },
      moneyRefs: { 'kpi-block': true },
    },
  );
  const r = evaluateCustomCell(ctx.rows[0].cells.a, { rowIdx: 0, colIdx: 0 }, ctx);
  expect(r.value === 12345, '@kpi-block → 12345');
  expect(r.money === true, 'money=true (moneyRef: kpi-block)');
}

console.log('\n# Cycle detection');

{
  const ctx = mkCtx(
    [
      { id: 'r1', label: 'A', cells: { a: mkCell('=B1') } },
      { id: 'r2', label: 'B', cells: {} },
    ],
    [{ id: 'a', label: 'A', format: 'number' }],
  );
  ctx.rows[1].cells.a = mkCell('=A1');
  const cache = evaluateAllCells(ctx);
  const a1 = cache.get(cellAddress(0, 0))!;
  const b1 = cache.get(cellAddress(1, 0))!;
  // Реализация: цикл резолвится как 0 (формулы взаимно ссылаются)
  expect(a1.value === 0, `cycle A1→B1→A1 → A1=0 (got ${JSON.stringify(a1.value)})`);
  expect(b1.value === 0, `cycle A1→B1→A1 → B1=0 (got ${JSON.stringify(b1.value)})`);
}

console.log('\n# Error: invalid syntax');

{
  const ctx = mkCtx(
    [{ id: 'r1', label: 'R', cells: { a: mkCell('=THIS_IS_NOT_A_FUNCTION(((') } }],
    [{ id: 'a', label: 'A', format: 'number' }],
  );
  const r = evaluateCustomCell(ctx.rows[0].cells.a, { rowIdx: 0, colIdx: 0 }, ctx);
  expect(r.error === '#ERR' || r.value === '#ERR', `invalid syntax → #ERR (got: ${JSON.stringify(r)})`);
}

console.log('\n# Money detection');

{
  // Формула из rubles-колонки → money: true
  const ctx = mkCtx(
    [
      { id: 'r1', label: 'R1', cells: { price: mkCell(1000) } },
      { id: 'r2', label: 'R2', cells: { price: mkCell('=A1*2') } },
    ],
    [{ id: 'price', label: 'Цена', format: 'rubles' }],
  );
  const r = evaluateCustomCell(ctx.rows[1].cells.price, { rowIdx: 1, colIdx: 0 }, ctx);
  expect(r.value === 2000, '=A1*2 (rubles col) → 2000');
  expect(r.money === true, 'rubles column → money: true');
}

{
  // Формула из number-колонки, ссылающаяся на rubles-колонку → money: true
  const ctx = mkCtx(
    [
      { id: 'r1', label: 'R1', cells: { qty: mkCell(10), price: mkCell(500) } },
      { id: 'r2', label: 'Total', cells: { qty: mkCell('=A1*B1') } },
    ],
    [
      { id: 'qty', label: 'Кол-во', format: 'number' },
      { id: 'price', label: 'Цена', format: 'rubles' },
    ],
  );
  const r = evaluateCustomCell(ctx.rows[1].cells.qty, { rowIdx: 1, colIdx: 0 }, ctx);
  expect(r.value === 5000, '=A1*B1 → 5000');
  expect(r.money === true, 'formula references rubles-col → money: true (через scan A1)');
}

console.log('\n# Binding (ref) priority');

{
  const ctx = mkCtx(
    [
      {
        id: 'r1',
        label: 'R',
        cells: { a: mkCell(999, { ref: 'external.val', isMoney: true }) },
      },
    ],
    [{ id: 'a', label: 'A', format: 'number' }],
    {
      liveValues: { 'external.val': 42 },
    },
  );
  const r = evaluateCustomCell(ctx.rows[0].cells.a, { rowIdx: 0, colIdx: 0 }, ctx);
  expect(r.value === 42, 'binding live value priority → 42 (not cached 999)');
  expect(r.kind === 'binding', 'kind = binding');
  expect(r.money === true, 'isMoney flag respected');
}

{
  // Binding without live value → fallback to cached v
  const ctx = mkCtx(
    [
      {
        id: 'r1',
        label: 'R',
        cells: { a: mkCell(777, { ref: 'missing.field', isMoney: false }) },
      },
    ],
    [{ id: 'a', label: 'A', format: 'rubles' }],
    {
      liveValues: {},
    },
  );
  const r = evaluateCustomCell(ctx.rows[0].cells.a, { rowIdx: 0, colIdx: 0 }, ctx);
  expect(r.value === 777, 'binding fallback to cached v → 777');
  expect(r.money === false, 'isMoney: false respected over column.format');
}

console.log('\n# evaluateAllCells (batch)');

{
  const ctx = mkCtx(
    [
      { id: 'r1', label: 'R1', cells: { a: mkCell(1), b: mkCell(2) } },
      { id: 'r2', label: 'R2', cells: { a: mkCell(3), b: mkCell('=A2+B1') } }, // B2 = 3+2 = 5
      { id: 'r3', label: 'Total', cells: { a: mkCell('=SUM(A1:A2)'), b: mkCell('=SUM(B1:B2)') } }, // A3=4, B3=7
    ],
    [
      { id: 'a', label: 'A', format: 'number' },
      { id: 'b', label: 'B', format: 'number' },
    ],
  );
  const cache = evaluateAllCells(ctx);
  expect(cache.get('A1')?.value === 1, 'A1 = 1');
  expect(cache.get('B2')?.value === 5, 'B2 = =A2+B1 = 5');
  expect(cache.get('A3')?.value === 4, 'A3 = SUM(A1:A2) = 4');
  expect(cache.get('B3')?.value === 7, 'B3 = SUM(B1:B2) = 7');
}

// ============================================================================

const total = passed + failed;
console.log(`\n${failed === 0 ? 'OK' : 'FAIL'} — ${passed}/${total} passed${failed > 0 ? `, ${failed} failed` : ''}`);
process.exit(failed === 0 ? 0 : 1);
