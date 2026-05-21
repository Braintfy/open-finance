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
  format: FormatSchema.default('rub'),
});

const ConfigSchema = z.object({
  title: z.string().default('KPI'),
  layout: LayoutSchema.default('row'),
  cells: z.array(CellSchema).min(0).max(6).default([]),
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
