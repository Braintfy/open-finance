// PURPOSE: Smoke-тесты для pure-helper'ов стейджа perf-campaigns:
//   - toDateOrNull: корректно нормализует пустые и не-строковые значения
//     `startDate`/`endDate` от Ozon Performance API в `null`, чтобы insert
//     в `date`-колонку PostgreSQL не падал.
// Запуск: pnpm tsx scripts/test-ozon-perf-campaigns.ts

import { toDateOrNull } from '../src/lib/marketplaces/ozon/sync/date-utils';

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

console.log('\n# toDateOrNull — нормализация дат от Ozon Performance API');

// Главный кейс: пустая строка для бессрочной кампании.
expect(toDateOrNull('') === null, 'empty string → null');
expect(toDateOrNull('   ') === null, 'whitespace-only string → null');
expect(toDateOrNull('   \t  ') === null, 'tab+whitespace → null');

// ISO date-only.
expect(
  toDateOrNull('2026-04-07') === '2026-04-07',
  'YYYY-MM-DD остаётся как есть',
);

// ISO datetime → отрезаем до date-only.
expect(
  toDateOrNull('2026-04-07T13:16:59Z') === '2026-04-07',
  'ISO datetime обрезается до даты',
  `got ${toDateOrNull('2026-04-07T13:16:59Z')}`,
);
expect(
  toDateOrNull('2026-04-07T13:16:59.806381Z') === '2026-04-07',
  'ISO datetime с микросекундами обрезается до даты',
);

// Whitespace вокруг валидной даты — trim перед slice.
expect(
  toDateOrNull('  2026-04-07  ') === '2026-04-07',
  'дата с whitespace вокруг → trim + slice',
);

// Не-строки.
expect(toDateOrNull(null) === null, 'null → null');
expect(toDateOrNull(undefined) === null, 'undefined → null');
expect(toDateOrNull(123) === null, 'number → null');
expect(toDateOrNull({}) === null, 'object → null');
expect(toDateOrNull([]) === null, 'array → null');

// Слишком короткая строка (нельзя надёжно интерпретировать как дату).
expect(toDateOrNull('2026') === null, '`2026` (4 символа) → null');
expect(toDateOrNull('2026-04') === null, '`2026-04` (7 символов) → null');

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
