// PURPOSE: Smoke-тесты для parseAiInsightsReport() — робастного парсера ответа
// ИИ блока «Ozon · AI инсайты». Покрывают реальные причины ошибки «не удалось
// разобрать ответ» на ПЕРВОМ запуске: преамбула/эпилог со скобками вокруг JSON,
// markdown-обёртка, усечённый ответ модели. Старый indexOf('{')…lastIndexOf('}')
// падал на всём этом; новый — балансирует скобки и спасает частичный ответ.
// Запуск: pnpm tsx scripts/test-ozon-ai-insights-parse.ts

import { parseAiInsightsReport } from '../src/lib/blocks/catalog/unit-ozon-ai-insights-types';

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

// Эталонный валидный отчёт: 2 инсайта, у второго — sku/tags/recommendation.
const VALID = {
  summary: 'Выручка просела на 21%, но реклама эффективна.',
  insights: [
    {
      category: 'revenue',
      type: 'warning',
      kind: 'observation',
      priority: 1,
      title: 'Выручка снизилась',
      description: 'Выручка 4 903 273 ₽ против 6 213 675 ₽ ранее.',
      metric: 'Выручка 4 903 273 ₽',
      tags: ['просадка'],
    },
    {
      category: 'products',
      type: 'danger',
      kind: 'action',
      priority: 1,
      title: 'Дефицит ходового SKU',
      description: 'Топовый товар без остатка.',
      sku: 'rm-bor-60-30',
      tags: ['остатки', 'дефицит'],
      recommendation: {
        action: 'Пополнить склад',
        basis: 'Нулевой остаток при высоком спросе',
        expectedEffect: 'Возврат продаж',
      },
    },
  ],
};
const VALID_JSON = JSON.stringify(VALID);

// 1. Чистый валидный JSON.
{
  const r = parseAiInsightsReport(VALID_JSON);
  expect(!!r && r.summary === VALID.summary, 'чистый JSON → summary');
  expect(!!r && r.insights.length === 2, 'чистый JSON → 2 инсайта', `got ${r?.insights.length}`);
  expect(!!r && r.insights[1].sku === 'rm-bor-60-30', 'чистый JSON → sku сохранён');
  expect(
    !!r && r.insights[1].recommendation?.action === 'Пополнить склад',
    'чистый JSON → recommendation',
  );
}

// 2. Markdown-обёртка ```json … ```.
{
  const r = parseAiInsightsReport('```json\n' + VALID_JSON + '\n```');
  expect(!!r && r.insights.length === 2, 'markdown-fence → распарсен');
}

// 3. ГЛАВНЫЙ КЕЙС: преамбула со скобкой перед JSON (модель добавила вступление).
//    Старый indexOf('{') цеплялся за `{магазина}` и ломал парс.
{
  const dirty = 'Конечно! Вот анализ для {магазина}:\n\n' + VALID_JSON;
  const r = parseAiInsightsReport(dirty);
  expect(!!r && r.insights.length === 2, 'преамбула со скобкой → распарсен', `got ${r?.insights.length}`);
  expect(!!r && r.summary === VALID.summary, 'преамбула со скобкой → summary верный');
}

// 4. Эпилог с фигурными скобками после JSON (старый lastIndexOf('}') ломался).
{
  const dirty = VALID_JSON + '\n\nНадеюсь, формат {ключ: значение} подходит.}';
  const r = parseAiInsightsReport(dirty);
  expect(!!r && r.insights.length === 2, 'эпилог со скобками → распарсен', `got ${r?.insights.length}`);
}

// 5. Усечённый ответ: оборван посреди последнего инсайта.
//    Должны спастись summary + все ПОЛНЫЕ инсайты, без жёсткой ошибки.
{
  const truncated = VALID_JSON.slice(0, VALID_JSON.length - 90);
  const r = parseAiInsightsReport(truncated);
  expect(!!r, 'усечённый JSON → не null (спасение)');
  expect(!!r && r.summary === VALID.summary, 'усечённый JSON → summary восстановлен');
  expect(!!r && r.insights.length >= 1, 'усечённый JSON → хотя бы 1 полный инсайт', `got ${r?.insights.length}`);
}

// 6. Полный мусор без JSON → null.
{
  const r = parseAiInsightsReport('Извините, не могу проанализировать данные.');
  expect(r === null, 'мусор без JSON → null');
}

// 7. Пустая строка → null.
{
  expect(parseAiInsightsReport('') === null, 'пустая строка → null');
}

// 8. Только summary, insights пустой → валидный отчёт с 0 инсайтов.
{
  const r = parseAiInsightsReport(JSON.stringify({ summary: 'Только резюме', insights: [] }));
  expect(!!r && r.summary === 'Только резюме' && r.insights.length === 0, 'summary-only → ок');
}

// 9. Инвалидные type/category/kind → фолбэк на info/general, без падения.
{
  const r = parseAiInsightsReport(
    JSON.stringify({
      summary: 's',
      insights: [{ category: 'нечто', type: 'мега', kind: 'bogus', title: 'X' }],
    }),
  );
  expect(
    !!r && r.insights[0]?.type === 'info' && r.insights[0]?.category === 'general',
    'инвалидные type/category → фолбэк',
  );
  expect(!!r && r.insights[0]?.kind === undefined, 'инвалидный kind → undefined');
}

// 10. Инсайт без title пропускается (recommendation не принимается за инсайт).
{
  const r = parseAiInsightsReport(
    JSON.stringify({
      summary: 's',
      insights: [
        { title: 'Есть', description: 'd' },
        { description: 'без заголовка' },
      ],
    }),
  );
  expect(!!r && r.insights.length === 1, 'инсайт без title пропущен', `got ${r?.insights.length}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
