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

// ============================================================================
// v0.23.2 regression: cell-pick после set/clear не должен сбивать каретку.
// Раньше после клика по ячейке (insert) браузерное controlled-input
// поведение могло сбросить cursor → следующий символ улетал в неправильную
// позицию (например, печатаем '*60' после '=B1' и получаем '*60=B1' вместо
// '=B1*60'). Pure-логика insertIntoDraft, как видно, работает корректно
// при правильно переданном caretPos — что и должен обеспечить
// useLayoutEffect + чтение из DOM (см. custom-data.tsx, v0.23.2).

console.log('\n=== insertIntoDraft (последовательные вставки — симуляция UX) ===');
{
  // Сценарий из бага: '=' → клик B1 → ожидаем '=B1', caret=3.
  // Потом пользователь печатает '*60' → должно стать '=B1*60', caret=6.
  let state: { draft: string; caretPos: number | null } = { draft: '=', caretPos: 1 };
  const r1 = insertIntoDraft(state, 'B1', { forceFormula: true });
  ok('= + B1 → =B1', r1.draft === '=B1');
  ok('caret после insert = 3', r1.caretPos === 3);

  state = { draft: r1.draft, caretPos: r1.caretPos };
  // Симулируем «пользователь печатает '*60' начиная с caret=3» —
  // это эквивалентно insert каждого символа подряд при условии,
  // что caretPos обновляется корректно.
  let cumulative = state;
  for (const ch of '*60') {
    cumulative = insertIntoDraft(cumulative, ch, {});
  }
  ok('=B1 + *60 (последовательно) → =B1*60', cumulative.draft === '=B1*60');
  ok('финальная caret = 6', cumulative.caretPos === 6);
}

{
  // Если caret «прыгнул в 0» (баг до v0.23.2), результат печатания
  // даёт *60=B1 вместо =B1*60 — это и видел пользователь.
  let cumulative: { draft: string; caretPos: number | null } = {
    draft: '=B1',
    caretPos: 0, // ← баг: cursor скинут в начало
  };
  for (const ch of '*60') {
    cumulative = insertIntoDraft(cumulative, ch, {});
  }
  ok(
    'baseline: caret=0 → *60=B1 (демонстрация старого бага)',
    cumulative.draft === '*60=B1',
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
