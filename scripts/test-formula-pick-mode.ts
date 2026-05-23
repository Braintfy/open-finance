// PURPOSE: Тесты для cell-pick режима в custom.data (v0.22.0).
// Покрытие:
//   - cellAddress(rowIdx, colIdx) — генерирует правильные A1-адреса
//   - insertIntoFormula логика — вставка cellAddress в draft с учётом каретки
//   - проверка что draft всегда начинается с '=' после insertIntoFormula
// Запуск: pnpm tsx scripts/test-formula-pick-mode.ts

import { cellAddress, colLabel } from '../src/lib/blocks/custom-data-formulas';

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
// insertIntoFormula — replicated logic из RenderCustomData

function insertIntoFormula(
  prev: { formulaDraft: string; caretPos: number | null },
  text: string,
): { formulaDraft: string; caretPos: number; mode: 'formula' } {
  let draft = prev.formulaDraft;
  let pos = prev.caretPos ?? draft.length;
  if (!draft.startsWith('=')) {
    draft = '=' + draft;
    pos += 1;
  }
  pos = Math.max(1, Math.min(pos, draft.length));
  const before = draft.slice(0, pos);
  const after = draft.slice(pos);
  const nextDraft = before + text + after;
  return { formulaDraft: nextDraft, caretPos: pos + text.length, mode: 'formula' };
}

console.log('\n=== insertIntoFormula logic ===');
{
  // Пустой draft с '='
  const r = insertIntoFormula({ formulaDraft: '=', caretPos: 1 }, 'A1');
  ok('empty draft → =A1', r.formulaDraft === '=A1');
  ok('caret в конце', r.caretPos === 3);
  ok('mode = formula', r.mode === 'formula');
}
{
  // Insert в середине
  const r = insertIntoFormula({ formulaDraft: '=A1+B1', caretPos: 4 }, 'C1*');
  ok('insert в середине = =A1+C1*B1', r.formulaDraft === '=A1+C1*B1');
  ok('caret после вставки', r.caretPos === 7);
}
{
  // Draft без = → автодобавление
  const r = insertIntoFormula({ formulaDraft: '5+', caretPos: 2 }, 'A1');
  ok('добавлен = в начало', r.formulaDraft === '=5+A1');
  ok('caret сдвинут на +1', r.caretPos === 5);
}
{
  // caretPos = null → end-of-string
  const r = insertIntoFormula({ formulaDraft: '=SUM(', caretPos: null }, 'A1');
  ok('null caret → end', r.formulaDraft === '=SUM(A1');
  ok('caret = length', r.caretPos === 7);
}
{
  // caret = 0 → clamp до 1 (после '=')
  const r = insertIntoFormula({ formulaDraft: '=A1', caretPos: 0 }, 'X');
  ok('caret 0 → clamp до 1', r.formulaDraft === '=XA1' && r.caretPos === 2);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
