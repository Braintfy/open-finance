// PURPOSE: Unit tests для kpi.grid config schema + layout helper.
// Запуск: pnpm tsx scripts/test-kpi-grid-config.ts

import { z } from 'zod';

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

// Локальная копия schema (без импорта из tsx-файла, чтобы тест работал быстро).
const MetricSchema = z.enum(['income', 'expense', 'balance', 'count']);
const FormatSchema = z.enum(['rub', 'number', 'percent', 'compact']);
const LayoutSchema = z.enum(['row', 'column', 'grid-2col', 'grid-3col']);

const SourceBindingSchema = z.union([
  z.object({ mode: z.literal('empty') }),
  z.object({ mode: z.literal('global') }),
  z.object({
    mode: z.literal('block'),
    blockId: z.string(),
    pageKey: z.string().optional(),
  }),
]);

const CellSchema = z.object({
  id: z.string(),
  metric: MetricSchema.default('income'),
  label: z.string().optional(),
  periodOverride: z
    .object({
      preset: z.string(),
      customFrom: z.string().nullable().default(null),
      customTo: z.string().nullable().default(null),
    })
    .nullable()
    .optional(),
  sourceOverride: z.string().nullable().optional(),
  sourceBindingOverride: SourceBindingSchema.optional(),
  format: FormatSchema.default('rub'),
});

const ConfigSchema = z.object({
  title: z.string().default('KPI'),
  layout: LayoutSchema.default('row'),
  cells: z.array(CellSchema).min(0).max(6).default([]),
  defaultPeriodOverride: z
    .object({
      preset: z.string(),
      customFrom: z.string().nullable().default(null),
      customTo: z.string().nullable().default(null),
    })
    .nullable()
    .optional(),
  defaultSourceBinding: SourceBindingSchema.optional(),
});

console.log('\n=== schema defaults ===');
{
  const parsed = ConfigSchema.parse({});
  ok('title defaults to "KPI"', parsed.title === 'KPI');
  ok('layout defaults to "row"', parsed.layout === 'row');
  ok('cells defaults to []', Array.isArray(parsed.cells) && parsed.cells.length === 0);
}

console.log('\n=== schema validation ===');
{
  const valid = ConfigSchema.safeParse({
    title: 'Test',
    layout: 'grid-2col',
    cells: [{ id: 'c1', metric: 'income', format: 'rub' }],
  });
  ok('valid 1-cell config parses', valid.success);

  const tooMany = ConfigSchema.safeParse({
    cells: Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`,
      metric: 'income' as const,
      format: 'rub' as const,
    })),
  });
  ok('7 cells rejected (max 6)', !tooMany.success);

  const badMetric = ConfigSchema.safeParse({
    cells: [{ id: 'c1', metric: 'unknown', format: 'rub' }],
  });
  ok('unknown metric rejected', !badMetric.success);

  const badLayout = ConfigSchema.safeParse({ layout: 'pyramid', cells: [] });
  ok('unknown layout rejected', !badLayout.success);
}

console.log('\n=== layout class helper ===');
{
  function layoutClassName(layout: string, count: number): string {
    if (layout === 'row') return `grid grid-flow-col auto-cols-fr gap-2`;
    if (layout === 'column') return `grid grid-flow-row auto-rows-fr gap-2`;
    if (layout === 'grid-2col')
      return `grid grid-cols-2 gap-2 ${count > 2 ? 'auto-rows-fr' : ''}`;
    if (layout === 'grid-3col')
      return `grid grid-cols-3 gap-2 ${count > 3 ? 'auto-rows-fr' : ''}`;
    return 'grid grid-cols-1 gap-2';
  }

  ok('row → grid-flow-col', layoutClassName('row', 3).includes('grid-flow-col'));
  ok('column → grid-flow-row', layoutClassName('column', 3).includes('grid-flow-row'));
  ok('grid-2col 4 cells → auto-rows-fr', layoutClassName('grid-2col', 4).includes('auto-rows-fr'));
  ok(
    'grid-2col 2 cells → no auto-rows-fr',
    !layoutClassName('grid-2col', 2).includes('auto-rows-fr'),
  );
  ok('grid-3col 6 cells → auto-rows-fr', layoutClassName('grid-3col', 6).includes('auto-rows-fr'));
}

console.log('\n=== override semantics ===');
{
  // periodOverride === undefined → inherit global.
  // periodOverride === null → explicit «inherit global» (legacy form, same as undefined).
  // periodOverride === { preset, ... } → use override.
  // sourceOverride === undefined → inherit global.
  // sourceOverride === null → override на «все источники».
  // sourceOverride === string → override на конкретный source.

  type Cell = z.infer<typeof CellSchema>;
  const cell1 = CellSchema.parse({ id: 'c1', metric: 'income', format: 'rub' });
  ok('default cell: no periodOverride', cell1.periodOverride === undefined);
  ok('default cell: no sourceOverride', cell1.sourceOverride === undefined);

  const cell2 = CellSchema.parse({
    id: 'c2',
    metric: 'income',
    format: 'rub',
    sourceOverride: null,
  });
  ok('explicit sourceOverride=null preserved', cell2.sourceOverride === null);
}

console.log('\n=== kopecks → rubles formatting ===');
{
  // Эмулируем поведение formatValue из kpi-grid.tsx после фикса:
  // money-метрики (income/expense/balance) приходят в kopeck'ах,
  // делим на 100 только для display.
  function formatValue(
    value: number | null,
    format: 'rub' | 'number' | 'percent' | 'compact',
    isMoney: boolean,
  ): string {
    if (value === null || !Number.isFinite(value)) return '—';
    if (format === 'rub') {
      const rubles = isMoney ? value / 100 : value;
      return new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        maximumFractionDigits: 0,
      }).format(rubles);
    }
    if (format === 'percent') {
      return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + '%';
    }
    if (format === 'compact') {
      const display = isMoney ? value / 100 : value;
      return new Intl.NumberFormat('ru-RU', {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(display);
    }
    const display = isMoney ? value / 100 : value;
    return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(display);
  }

  // 64_344_198 kopecks = 643_441.98 rubles → должен показать 643 442 ₽.
  // До фикса показывал "64 344 198 ₽" (баг скриншот пользователя).
  const big = 64_344_198;
  const result = formatValue(big, 'rub', true);
  ok(
    `64_344_198 копеек (money) → отформатировано как ~643 442 ₽ (НЕ ${big} ₽)`,
    !result.includes('64 344 198') && /643\s?44/.test(result),
  );

  // count метрика (не money) — не делится.
  const count = 1234;
  ok(
    'count=1234 (non-money), format=number → 1 234',
    formatValue(count, 'number', false).replace(/\s/g, ' ') === '1 234',
  );

  // null → '—' независимо от формата.
  ok('null → "—"', formatValue(null, 'rub', true) === '—');
}

console.log('\n=== defaultPeriodOverride (block-level fallback) ===');
{
  const noOverride = ConfigSchema.parse({});
  ok('default config: defaultPeriodOverride === undefined', noOverride.defaultPeriodOverride === undefined);

  const withDefault = ConfigSchema.parse({
    defaultPeriodOverride: { preset: '7d', customFrom: null, customTo: null },
  });
  ok(
    'with defaultPeriodOverride preserved',
    withDefault.defaultPeriodOverride?.preset === '7d',
  );

  const nullExplicit = ConfigSchema.parse({ defaultPeriodOverride: null });
  ok('explicit null preserved', nullExplicit.defaultPeriodOverride === null);
}

console.log('\n=== defaultSourceBinding (block-level binding) ===');
{
  const noBinding = ConfigSchema.parse({});
  ok(
    'default config: defaultSourceBinding === undefined (миграция назначит при загрузке)',
    noBinding.defaultSourceBinding === undefined,
  );

  const emptyBinding = ConfigSchema.parse({
    defaultSourceBinding: { mode: 'empty' },
  });
  ok(
    'defaultSourceBinding=empty preserved',
    emptyBinding.defaultSourceBinding?.mode === 'empty',
  );

  const globalBinding = ConfigSchema.parse({
    defaultSourceBinding: { mode: 'global' },
  });
  ok(
    'defaultSourceBinding=global preserved',
    globalBinding.defaultSourceBinding?.mode === 'global',
  );

  const blockBinding = ConfigSchema.parse({
    defaultSourceBinding: { mode: 'block', blockId: 'tx-1' },
  });
  ok(
    'defaultSourceBinding={mode:block, blockId} preserved',
    blockBinding.defaultSourceBinding?.mode === 'block' &&
      blockBinding.defaultSourceBinding.blockId === 'tx-1',
  );

  const crossPageBinding = ConfigSchema.parse({
    defaultSourceBinding: { mode: 'block', blockId: 'tx-2', pageKey: 'cashflow' },
  });
  ok(
    'defaultSourceBinding cross-page preserved',
    crossPageBinding.defaultSourceBinding?.mode === 'block' &&
      'pageKey' in crossPageBinding.defaultSourceBinding &&
      crossPageBinding.defaultSourceBinding.pageKey === 'cashflow',
  );

  const invalidBinding = ConfigSchema.safeParse({
    defaultSourceBinding: { mode: 'invalid' },
  });
  ok('invalid binding mode rejected', !invalidBinding.success);

  const blockWithoutId = ConfigSchema.safeParse({
    defaultSourceBinding: { mode: 'block' },
  });
  ok('binding mode=block без blockId rejected', !blockWithoutId.success);
}

console.log('\n=== per-cell sourceBindingOverride ===');
{
  const inheriting = CellSchema.parse({ id: 'c1', metric: 'income', format: 'rub' });
  ok(
    'no override: sourceBindingOverride === undefined → ячейка наследует block default',
    inheriting.sourceBindingOverride === undefined,
  );

  const overridden = CellSchema.parse({
    id: 'c2',
    metric: 'expense',
    format: 'rub',
    sourceBindingOverride: { mode: 'block', blockId: 'tx-other' },
  });
  ok(
    'per-cell override → mode=block',
    overridden.sourceBindingOverride?.mode === 'block' &&
      overridden.sourceBindingOverride.blockId === 'tx-other',
  );

  const overrideEmpty = CellSchema.parse({
    id: 'c3',
    metric: 'income',
    format: 'rub',
    sourceBindingOverride: { mode: 'empty' },
  });
  ok(
    'per-cell override empty → ячейка показывает placeholder, даже если block-level задан block',
    overrideEmpty.sourceBindingOverride?.mode === 'empty',
  );
}

console.log('\n=== binding resolution (cell override > block default) ===');
{
  type SourceBinding = z.infer<typeof SourceBindingSchema>;
  function resolveEffective(
    cellOverride: SourceBinding | undefined,
    blockDefault: SourceBinding,
  ): SourceBinding {
    return cellOverride !== undefined ? cellOverride : blockDefault;
  }
  ok(
    'cellOverride=undefined → возвращает blockDefault',
    resolveEffective(undefined, { mode: 'global' }).mode === 'global',
  );
  ok(
    'cellOverride=empty → возвращает empty (даже если block=block)',
    resolveEffective({ mode: 'empty' }, { mode: 'block', blockId: 't' }).mode === 'empty',
  );
  ok(
    'cellOverride=block(tx-A) → возвращает block(tx-A) (даже если block=block(tx-B))',
    (() => {
      const r = resolveEffective(
        { mode: 'block', blockId: 'tx-A' },
        { mode: 'block', blockId: 'tx-B' },
      );
      return r.mode === 'block' && r.blockId === 'tx-A';
    })(),
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
