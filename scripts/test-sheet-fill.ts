// PURPOSE: Тесты для sheet-fill helpers (Excel-like fill-handle для блока sheet, v0.23.5).
//
// Покрытие:
//   - fillSheetCellFromSource: формула / литерал / пусто / out-of-bounds.
//   - shiftFormulaRefs (re-export): базовый sanity для совместимости.
//   - reindexHighlightsOnMove: DnD-reorder колонок/строк → ключи sparse Record.
//   - reindexHighlightsOnRemove: удаление колонок/строк → ключи sparse Record.
//
// Подробные кейсы `shiftFormulaRefs` / `computeFillTargets` / `isInFillRange`
// уже покрыты в `scripts/test-fill-handle.ts` (35 тестов для custom.data).
// Здесь — только sheet-specific логика.
//
// Запуск: pnpm tsx scripts/test-sheet-fill.ts

import {
  fillSheetCellFromSource,
  shiftFormulaRefs,
  reindexHighlightsOnMove,
  reindexHighlightsOnRemove,
} from '../src/lib/blocks/sheet-fill';

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
console.log('\n=== fillSheetCellFromSource — формула с A1-сдвигом ===');
eq('=A1+B1, dRow=+1', fillSheetCellFromSource('=A1+B1', 1, 0, 10, 10), '=A2+B2');
eq('=A1*2, dRow=+5', fillSheetCellFromSource('=A1*2', 5, 0, 10, 10), '=A6*2');
eq('=SUM(A1:A5), dCol=+1', fillSheetCellFromSource('=SUM(A1:A5)', 0, 1, 10, 10), '=SUM(B1:B5)');
eq('=A1+@blockId, dRow=+1', fillSheetCellFromSource('=A1+@blockId', 1, 0, 10, 10), '=A2+@blockId');

// ============================================================================
console.log('\n=== fillSheetCellFromSource — литералы / пустые ===');
eq('Hello world', fillSheetCellFromSource('Hello world', 3, 2, 10, 10), 'Hello world');
eq('100', fillSheetCellFromSource('100', 5, 0, 10, 10), '100');
eq('пустая строка', fillSheetCellFromSource('', 1, 1, 10, 10), '');
eq('undefined → пустая', fillSheetCellFromSource(undefined, 1, 1, 10, 10), '');

// ============================================================================
console.log('\n=== fillSheetCellFromSource — out-of-bounds ===');
eq('=A1, dRow=-1 → #REF!', fillSheetCellFromSource('=A1', -1, 0, 10, 10), '=#REF!');
eq('=A10, dRow=+1 в 10×10', fillSheetCellFromSource('=A10', 1, 0, 10, 10), '=#REF!');
eq('=Z1, dCol=+1 в 26 cols', fillSheetCellFromSource('=Z1', 0, 1, 10, 26), '=#REF!');

// ============================================================================
console.log('\n=== shiftFormulaRefs (re-export sanity) ===');
eq('=A1+1, dRow=+1', shiftFormulaRefs('=A1+1', 1, 0, 10, 10), '=A2+1');
eq('range =A1:B5, dRow=+2', shiftFormulaRefs('=A1:B5', 2, 0, 10, 10), '=A3:B7');

// ============================================================================
console.log('\n=== reindexHighlightsOnMove — DnD-reorder ===');
eq(
  'reorder col 0 → 2 (total=3)',
  reindexHighlightsOnMove({ '0': 'yellow', '2': 'blue' }, 0, 2, 3),
  { '1': 'blue', '2': 'yellow' },
);
eq(
  'reorder col 2 → 0 (total=3)',
  reindexHighlightsOnMove({ '0': 'yellow', '2': 'blue' }, 2, 0, 3),
  { '0': 'blue', '1': 'yellow' },
);
eq(
  'no-op (from==to)',
  reindexHighlightsOnMove({ '1': 'red' }, 1, 1, 3),
  { '1': 'red' },
);
eq(
  'reorder без highlights → undefined',
  reindexHighlightsOnMove(undefined, 0, 1, 3),
  undefined,
);
eq(
  'reorder в пустом map → undefined',
  reindexHighlightsOnMove({}, 0, 1, 3),
  undefined,
);
eq(
  'reorder сохраняет цвет неподсвеченных индексов',
  reindexHighlightsOnMove({ '0': 'yellow', '1': 'blue', '2': 'red' }, 0, 2, 3),
  { '0': 'blue', '1': 'red', '2': 'yellow' },
);

// ============================================================================
console.log('\n=== reindexHighlightsOnRemove — удаление колонок/строк ===');
eq(
  'удалить col 2 из {0:yellow, 2:blue, 4:red}, total=5',
  reindexHighlightsOnRemove({ '0': 'yellow', '2': 'blue', '4': 'red' }, [2], 5),
  { '0': 'yellow', '3': 'red' },
);
eq(
  'удалить col 0 из {0:yellow, 2:blue}, total=3',
  reindexHighlightsOnRemove({ '0': 'yellow', '2': 'blue' }, [0], 3),
  { '1': 'blue' },
);
eq(
  'удалить два индекса 1, 3 из {0:y, 1:b, 3:r}, total=5',
  reindexHighlightsOnRemove({ '0': 'y', '1': 'b', '3': 'r' }, [1, 3], 5),
  { '0': 'y' },
);
eq(
  'удалить все подсвеченные → undefined',
  reindexHighlightsOnRemove({ '0': 'yellow' }, [0], 1),
  undefined,
);
eq(
  'удалить из пустого → пустое',
  reindexHighlightsOnRemove(undefined, [0], 3),
  undefined,
);
eq(
  'empty removed list → noop',
  reindexHighlightsOnRemove({ '0': 'yellow' }, [], 3),
  { '0': 'yellow' },
);

// ============================================================================
console.log(`\n=== Итого: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
