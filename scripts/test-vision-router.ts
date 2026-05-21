// PURPOSE: Tests для vision router — выбор провайдера по env / override.
// Запуск: pnpm tsx scripts/test-vision-router.ts

import {
  getVisionProvider,
  listVisionProviders,
  parseExtractedJson,
} from '../src/lib/ai/vision';

let passed = 0;
let failed = 0;

function ok(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}`);
    failed += 1;
  }
}

console.log('\n=== getVisionProvider ===');
{
  // Сохраняем env
  const savedAnthropic = process.env.ANTHROPIC_API_KEY;
  const savedOpenAI = process.env.OPENAI_API_KEY;
  const savedVision = process.env.VISION_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.VISION_PROVIDER;
  delete process.env.YANDEX_FOLDER_ID;

  // Без env: mock
  ok('fallback to mock when no env', getVisionProvider().id === 'mock');

  // Override
  ok('override mock', getVisionProvider({ override: 'mock' }).id === 'mock');
  ok('override claude', getVisionProvider({ override: 'claude' }).id === 'claude');
  ok('invalid override → mock', getVisionProvider({ override: 'xxx' }).id === 'mock');

  // Env VISION_PROVIDER
  process.env.VISION_PROVIDER = 'openai';
  ok('env VISION_PROVIDER', getVisionProvider().id === 'openai');
  delete process.env.VISION_PROVIDER;

  // Auto-fallback по env-ключам
  process.env.ANTHROPIC_API_KEY = 'sk-test';
  ok('auto: claude when ANTHROPIC_API_KEY set', getVisionProvider().id === 'claude');
  delete process.env.ANTHROPIC_API_KEY;

  process.env.OPENAI_API_KEY = 'sk-test';
  ok('auto: openai when OPENAI_API_KEY set', getVisionProvider().id === 'openai');
  delete process.env.OPENAI_API_KEY;

  // restore
  if (savedAnthropic) process.env.ANTHROPIC_API_KEY = savedAnthropic;
  if (savedOpenAI) process.env.OPENAI_API_KEY = savedOpenAI;
  if (savedVision) process.env.VISION_PROVIDER = savedVision;
}

console.log('\n=== listVisionProviders ===');
{
  const list = listVisionProviders();
  ok('list length 5', list.length === 5);
  ok('mock always available', list.find((p) => p.id === 'mock')?.available === true);
  ok('list has all ids', ['claude', 'openai', 'yandex', 'tesseract', 'mock'].every(
    (id) => list.some((p) => p.id === id),
  ));
}

console.log('\n=== parseExtractedJson ===');
{
  const valid = parseExtractedJson(JSON.stringify({
    vendor: 'ИП Тест',
    vendorInn: '7707083893',
    date: '2026-05-21',
    amount: 100050,
    currency: 'RUB',
    type: 'receipt',
    items: [{ name: 'Товар', qty: 1, price: 100000, total: 100000 }],
  }));
  ok('parse vendor', valid.vendor === 'ИП Тест');
  ok('parse amount', valid.amount === 100050);
  ok('parse items', valid.items?.length === 1);

  const markdown = parseExtractedJson('```json\n{"vendor":"X"}\n```');
  ok('strip markdown', markdown.vendor === 'X');

  const messy = parseExtractedJson('Here is the data:\n{"vendor":"Y"}\nDone.');
  ok('extract from messy', messy.vendor === 'Y');

  const broken = parseExtractedJson('not a json');
  ok('broken → rawText fallback', broken.rawText === 'not a json');
}

async function testMockProvider() {
  console.log('\n=== mock provider recognize ===');
  const provider = getVisionProvider({ override: 'mock' });
  const result = await provider.recognize(
    {
      kind: 'buffer',
      buffer: Buffer.from('test'),
      mimeType: 'image/png',
      filename: 'test_chek.png',
    },
    'auto',
    { tenantId: 't1', userId: 'u1' },
  );
  ok('mock returns provider id', result.provider === 'mock');
  ok('mock has duration', typeof result.durationMs === 'number');
  ok('mock detects receipt from filename', result.type === 'receipt');
  ok('mock has vendor', !!result.vendor);
}

testMockProvider().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
});
