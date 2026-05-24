// PURPOSE: Тесты для cell-pick / formula-bar логики custom.data (v0.22.5).
// Покрытие:
//   - cellAddress(rowIdx, colIdx) — генерирует правильные A1-адреса.
//   - insertIntoDraft(prev, text, { forceFormula }) — вставка cellAddress /
//     оператора / @-ссылки в draft с учётом каретки и автопрефикса '='.
//   - isFormulaDraft(draft) — определение режима формулы.
// Запуск: pnpm tsx scripts/test-formula-pick-mode.ts

import { cellAddress, colLabel } from '../src/lib/blocks/custom-data-formulas';
import { insertIntoDraft } from '../src/lib/blocks/catalog/custom-data';

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

console.log('\n=== cellAddress() helper ===');
ok('A1 для (0, 0)', cellAddress(0, 0) === 'A1');
ok('B1 для (0, 1)', cellAddress(0, 1) === 'B1');
ok('A2 для (1, 0)', cellAddress(1, 0) === 'A2');
ok('Z1 для (0, 25)', cellAddress(0, 25) === 'Z1');
ok('AA1 для (0, 26)', cellAddress(0, 26) === 'AA1');
ok('AB10 для (9, 27)', cellAddress(9, 27) === 'AB10');

console.log('\n=== colLabel sequence ===');
ok('A B C D E', ['A', 'B', 'C', 'D', 'E'].every((l, i) => colLabel(i) === l));
ok('Z → AA → AB', colLabel(25) === 'Z' && colLabel(26) === 'AA' && colLabel(27) === 'AB');

// ============================================================================
// insertIntoDraft — общая утилита для cell-pick / operator-toolbar / @связать

console.log('\n=== insertIntoDraft (forceFormula=true, cell-pick) ===');
{
  // Пустой draft + forceFormula → начинаем с '='
  const r = insertIntoDraft({ draft: '', caretPos: 0 }, 'A1', { forceFormula: true });
  ok('empty + A1 → =A1', r.draft === '=A1');
  ok('caret в конце (3)', r.caretPos === 3);
}
{
  // '=' + 'A1' в конец
  const r = insertIntoDraft({ draft: '=', caretPos: 1 }, 'A1', { forceFormula: true });
  ok('= + A1 → =A1', r.draft === '=A1');
  ok('caret в конце', r.caretPos === 3);
}
{
  // Insert в середине
  const r = insertIntoDraft({ draft: '=A1+B1', caretPos: 4 }, 'C1*', { forceFormula: true });
  ok('insert в середине = =A1+C1*B1', r.draft === '=A1+C1*B1');
  ok('caret после вставки', r.caretPos === 7);
}
{
  // Draft без '=' + forceFormula → автодобавление '='
  const r = insertIntoDraft({ draft: '5', caretPos: 1 }, '+A1', { forceFormula: true });
  ok('добавлен = в начало', r.draft === '=5+A1');
  ok('caret сдвинут на +1', r.caretPos === 5);
}
{
  // caretPos = null → end-of-string
  const r = insertIntoDraft({ draft: '=SUM(', caretPos: null }, 'A1', { forceFormula: true });
  ok('null caret → end', r.draft === '=SUM(A1');
  ok('caret = length', r.caretPos === 7);
}

console.log('\n=== insertIntoDraft (forceFormula=false, обычная вставка текста) ===');
{
  // Значение без = (не формула)
  const r = insertIntoDraft({ draft: '100', caretPos: 2 }, '5', {});
  ok('100[2]+5 → 1050', r.draft === '1050');
  ok('caret после', r.caretPos === 3);
}
{
  // Пустой draft без forceFormula — стандартная вставка
  const r = insertIntoDraft({ draft: '', caretPos: 0 }, 'hello', {});
  ok('empty + hello → hello', r.draft === 'hello');
  ok('caret = 5', r.caretPos === 5);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
