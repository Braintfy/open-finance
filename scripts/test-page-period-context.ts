// PURPOSE: Tests для page-period context логики (без React).
// Тестируем persistence (storage roundtrip), валидацию presets.
// Запуск: pnpm tsx scripts/test-page-period-context.ts

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

// Replicate helpers из page-period-context (логика, не React)
type PagePeriodValue = {
  preset: 'today' | 'yesterday' | '7d' | '14d' | '30d' | 'mtd' | 'custom';
  customFrom: string | null;
  customTo: string | null;
};

const VALID_PRESETS = ['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'];

function parseStored(raw: string | null): PagePeriodValue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PagePeriodValue>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!VALID_PRESETS.includes(parsed.preset as string)) return null;
    if (parsed.preset === 'custom' && (!parsed.customFrom || !parsed.customTo)) return null;
    return {
      preset: parsed.preset as PagePeriodValue['preset'],
      customFrom: parsed.customFrom ?? null,
      customTo: parsed.customTo ?? null,
    };
  } catch {
    return null;
  }
}

console.log('\n=== storage parsing ===');
{
  ok('null storage → null', parseStored(null) === null);
  ok('empty string → null', parseStored('') === null);
  ok('invalid JSON → null', parseStored('not json') === null);
  ok('invalid preset → null', parseStored('{"preset":"bogus"}') === null);
  ok(
    'custom without dates → null',
    parseStored('{"preset":"custom","customFrom":null,"customTo":null}') === null,
  );

  const valid = parseStored('{"preset":"mtd","customFrom":null,"customTo":null}');
  ok('valid mtd', valid?.preset === 'mtd');

  const customValid = parseStored(
    '{"preset":"custom","customFrom":"2026-01-01","customTo":"2026-01-31"}',
  );
  ok('valid custom', customValid?.preset === 'custom' && customValid.customFrom === '2026-01-01');
}

console.log('\n=== useEffectivePeriod resolution ===');
{
  // Replicate logic from useEffectivePeriod
  function resolveEffective(
    pageValue: PagePeriodValue,
    override: PagePeriodValue | null,
  ): { value: PagePeriodValue; source: 'global' | 'override' } {
    if (override) return { value: override, source: 'override' };
    return { value: pageValue, source: 'global' };
  }

  const page: PagePeriodValue = { preset: 'mtd', customFrom: null, customTo: null };
  const override: PagePeriodValue = { preset: '7d', customFrom: null, customTo: null };

  const noOverride = resolveEffective(page, null);
  ok('no override → global', noOverride.source === 'global');
  ok('no override → page value', noOverride.value.preset === 'mtd');

  const withOverride = resolveEffective(page, override);
  ok('override → override source', withOverride.source === 'override');
  ok('override → override value', withOverride.value.preset === '7d');
}

console.log('\n=== drilldown URL building ===');
{
  function drillDownUrl(
    pageHref: string,
    blockType: string,
    filter: { type?: string; categoryName?: string; counterparty?: string },
  ): string {
    const params = new URLSearchParams();
    params.set('drill_block_type', blockType);
    if (filter.type) params.set('drill_type', filter.type);
    if (filter.categoryName) params.set('drill_category', filter.categoryName);
    if (filter.counterparty) params.set('drill_counterparty', filter.counterparty);
    return `${pageHref}?${params.toString()}`;
  }

  const url1 = drillDownUrl('/cashflow', 'cashflow.transactions', { type: 'income' });
  ok('basic drill URL', url1 === '/cashflow?drill_block_type=cashflow.transactions&drill_type=income');

  const url2 = drillDownUrl('/cashflow', 'cashflow.transactions', {
    type: 'expense',
    categoryName: 'Реклама',
  });
  ok('drill URL with category', url2.includes('drill_category=%D0%A0%D0%B5%D0%BA%D0%BB%D0%B0%D0%BC%D0%B0'));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
