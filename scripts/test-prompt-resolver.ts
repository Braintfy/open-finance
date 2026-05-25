// PURPOSE: Smoke-тест для resolvePromptStack — проверяет корректность сборки промпта по слоям.
// Запуск: pnpm tsx scripts/test-prompt-resolver.ts

import { resolvePromptStack } from '../src/lib/ai/prompt-resolver';
import type { TenantSettings } from '../src/lib/db/schema/tenants';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertContains(text: string, substring: string) {
  if (!text.includes(substring)) {
    throw new Error(`Expected prompt to contain: "${substring.slice(0, 80)}..."\nGot: "${text.slice(0, 200)}..."`);
  }
}

function assertNotContains(text: string, substring: string) {
  if (text.includes(substring)) {
    throw new Error(`Expected prompt NOT to contain: "${substring.slice(0, 80)}"`);
  }
}

const baseSettings: TenantSettings = {};

console.log('\n=== resolvePromptStack smoke tests ===\n');

// 1. Default global prompt
test('1. Default global system prompt included', () => {
  const result = resolvePromptStack({
    tenantSettings: baseSettings,
    scope: 'block',
  });
  assertContains(result.systemPrompt, 'Open Finance');
  assert(result.meta.layers.includes('global'), 'global layer missing');
});

// 2. Tenant override system prompt
test('2. Tenant override system prompt wins over default', () => {
  const settings: TenantSettings = { aiSystemPrompt: 'CUSTOM SYSTEM PROMPT FOR TEST' };
  const result = resolvePromptStack({
    tenantSettings: settings,
    scope: 'block',
  });
  assertContains(result.systemPrompt, 'CUSTOM SYSTEM PROMPT FOR TEST');
});

// 3. Block scope includes micro-agent layer
test('3. Block scope includes MICRO_AGENT_SYSTEM', () => {
  const result = resolvePromptStack({
    tenantSettings: baseSettings,
    scope: 'block',
  });
  assertContains(result.systemPrompt, 'AI-микроагент Open Finance');
  assert(result.meta.layers.includes('micro-agent'), 'micro-agent layer missing');
});

// 4. Section scope — no micro-agent layer, but section context
test('4. Section scope has no micro-agent layer', () => {
  const result = resolvePromptStack({
    tenantSettings: baseSettings,
    scope: 'section',
    pageKey: 'cashflow',
    sectionBlocks: [],
  });
  assertNotContains(result.systemPrompt, 'AI-микроагент Open Finance');
  assertContains(result.systemPrompt, 'Финансы');
  assert(!result.meta.layers.includes('micro-agent'), 'micro-agent should not be in section scope');
});

// 5. Section group prompt for cashflow
test('5. cashflow page → finance group prompt included', () => {
  const result = resolvePromptStack({
    tenantSettings: baseSettings,
    scope: 'section',
    pageKey: 'cashflow',
  });
  // 'денежный поток' (lowercase) appears in SECTION_GROUP_DEFAULTS.finance
  assertContains(result.systemPrompt, 'денежный поток');
  assert(result.meta.layers.includes('section'), 'section layer missing');
});

// 6. Block skill for known type
test('6. Known block type gets skill prompt', () => {
  const result = resolvePromptStack({
    tenantSettings: baseSettings,
    scope: 'block',
    blockType: 'unit.ozon-kpi',
    pageKey: 'marketplaces-ozon-dashboard',
  });
  assertContains(result.systemPrompt, 'ДРР');
  assert(result.meta.layers.includes('block-skill'), 'block-skill layer missing');
});

// 7. User supplement wins over legacy aiPrompt
test('7. aiPromptSupplement wins over legacy aiPrompt', () => {
  const result = resolvePromptStack({
    tenantSettings: baseSettings,
    scope: 'block',
    aiPromptSupplement: 'SUPPLEMENT TEXT',
    aiPromptLegacy: 'LEGACY TEXT',
  });
  assertContains(result.systemPrompt, 'SUPPLEMENT TEXT');
  assertNotContains(result.systemPrompt, 'LEGACY TEXT');
  assert(result.meta.layers.includes('supplement'), 'supplement layer missing');
  assert(!result.meta.layers.includes('legacy'), 'legacy should not appear when supplement is set');
});

// 8. Legacy fallback when supplement absent
test('8. Legacy aiPrompt used when supplement absent', () => {
  const result = resolvePromptStack({
    tenantSettings: baseSettings,
    scope: 'block',
    aiPromptSupplement: undefined,
    aiPromptLegacy: 'LEGACY FALLBACK',
  });
  assertContains(result.systemPrompt, 'LEGACY FALLBACK');
  assert(result.meta.layers.includes('legacy'), 'legacy layer missing');
});

// 9. Pointwise scope includes pointwise prompt
test('9. Pointwise scope includes dependency analysis prompt', () => {
  const result = resolvePromptStack({
    tenantSettings: baseSettings,
    scope: 'pointwise',
    pageKey: 'cashflow',
  });
  assertContains(result.systemPrompt, 'граф зависимостей');
  assert(result.meta.layers.includes('pointwise'), 'pointwise layer missing');
});

// 10. Tenant override for group prompt
test('10. Tenant section group override replaces default', () => {
  const settings: TenantSettings = {
    aiPrompts: {
      sections: {
        groups: { finance: 'TENANT FINANCE OVERRIDE' },
      },
    },
  };
  const result = resolvePromptStack({
    tenantSettings: settings,
    scope: 'section',
    pageKey: 'cashflow',
  });
  assertContains(result.systemPrompt, 'TENANT FINANCE OVERRIDE');
  assertNotContains(result.systemPrompt, 'Денежный поток');
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) process.exit(1);
