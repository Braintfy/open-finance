// PURPOSE: Тесты для resolveShowKopecks (v0.23.3) — переключатель «Дробная часть»
// в блоке custom.data на уровне block / column / row.
//
// Покрытие:
//   - Приоритет row → col → blockDefault.
//   - `null` / `undefined` на уровне row/col = inherit (пропускаем уровень).
//   - blockDefault — уже резолвнутое значение (block.showKopecks ?? global).
//
// Запуск: pnpm tsx scripts/test-decimal-resolution.ts

import { resolveShowKopecks } from '../src/lib/blocks/catalog/custom-data';

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
ok('col=null inherits blockDefault=true → true',
  resolveShowKopecks(undefined, { showKopecks: null }, true) === true);
ok('col=undefined inherits blockDefault=false → false',
  resolveShowKopecks(undefined, {}, false) === false);

console.log('\n=== Row override beats column ===');
ok('row=true beats col=false (block=false)',
  resolveShowKopecks({ showKopecks: true }, { showKopecks: false }, false) === true);
ok('row=false beats col=true (block=true)',
  resolveShowKopecks({ showKopecks: false }, { showKopecks: true }, true) === false);
ok('row=null falls back to col=true',
  resolveShowKopecks({ showKopecks: null }, { showKopecks: true }, false) === true);
ok('row=undefined falls back to col=false',
  resolveShowKopecks({}, { showKopecks: false }, true) === false);

console.log('\n=== Both row and col null → blockDefault ===');
ok('row=null, col=null, block=true → true',
  resolveShowKopecks({ showKopecks: null }, { showKopecks: null }, true) === true);
ok('row=null, col=null, block=false → false',
  resolveShowKopecks({ showKopecks: null }, { showKopecks: null }, false) === false);

console.log('\n=== Edge: row=true with col=undefined ===');
ok('row=true wins over implicit col, block=false → true',
  resolveShowKopecks({ showKopecks: true }, {}, false) === true);
ok('row=false wins over implicit col, block=true → false',
  resolveShowKopecks({ showKopecks: false }, {}, true) === false);

// ============================================================================
// Прикладной кейс: тот же blockDefault (например, global=false), но per-column
// мы хотим «показывать копейки» для рублёвой колонки. И per-row хотим скрыть
// дробную часть в строке «Итого».
console.log('\n=== Use case: показать копейки только в одной колонке ===');
{
  const blockDefault = false; // глобально копейки скрыты
  const col = { showKopecks: true }; // в этой колонке — показывать
  ok('blockDefault=false, col=true → true',
    resolveShowKopecks(undefined, col, blockDefault) === true);
  // другие колонки не затронуты
  ok('blockDefault=false, otherCol=undefined → false',
    resolveShowKopecks(undefined, {}, blockDefault) === false);
}

console.log('\n=== Use case: «итого»-строка без дробных, остальные с дробными ===');
{
  const blockDefault = true; // показываем копейки
  const rowTotal = { showKopecks: false }; // в строке «итого» — скрыть
  const rowNormal = {};
  const col = {};
  ok('rowTotal перекрывает blockDefault → false',
    resolveShowKopecks(rowTotal, col, blockDefault) === false);
  ok('rowNormal наследует blockDefault → true',
    resolveShowKopecks(rowNormal, col, blockDefault) === true);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
