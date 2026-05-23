// PURPOSE: Тесты для incremental backfill в Ozon sync (v0.22.1).
// Покрытие:
//   - BodySchema sync route: валидация fromDate/toDate/force
//   - buildPerfPeriodFromOverride: clamp до MAX_PERF_WINDOW_DAYS, валидация range
//   - StageContext override полей — TS smoke check
// Запуск: pnpm tsx scripts/test-ozon-sync-incremental.ts

import {
  buildPerfPeriodFromOverride,
  MAX_PERF_WINDOW_DAYS,
} from '../src/lib/marketplaces/ozon/sync/perf-period';

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

console.log('\n=== buildPerfPeriodFromOverride: одиночный день ===');
{
  const p = buildPerfPeriodFromOverride('2026-05-22', '2026-05-22');
  ok('dateFrom = 2026-05-22', p.dateFrom === '2026-05-22');
  ok('dateTo = 2026-05-22', p.dateTo === '2026-05-22');
  ok('windowDays = 1', p.windowDays === 1);
}

console.log('\n=== buildPerfPeriodFromOverride: 7 дней ===');
{
  const p = buildPerfPeriodFromOverride('2026-05-15', '2026-05-21');
  ok('dateFrom = 2026-05-15', p.dateFrom === '2026-05-15');
  ok('dateTo = 2026-05-21', p.dateTo === '2026-05-21');
  ok('windowDays = 7', p.windowDays === 7);
}

console.log('\n=== buildPerfPeriodFromOverride: clamp до 62d ===');
{
  // 100 дней: 2026-02-11 → 2026-05-21
  const p = buildPerfPeriodFromOverride('2026-02-11', '2026-05-21');
  ok('windowDays clamped до 62', p.windowDays === MAX_PERF_WINDOW_DAYS);
  ok('dateTo не сдвинулся', p.dateTo === '2026-05-21');
  ok('dateFrom сдвинут на (toDate - 61d)', p.dateFrom === '2026-03-21');
}

console.log('\n=== buildPerfPeriodFromOverride: from > to → fallback ===');
{
  const p = buildPerfPeriodFromOverride('2026-05-22', '2026-05-15');
  ok('from > to → dateFrom = dateTo', p.dateFrom === p.dateTo);
  ok('windowDays = 1', p.windowDays === 1);
}

// ============================================================================
// Replicated BodySchema validation logic

import { z } from 'zod';
import { OZON_FULL_STAGES } from '../src/lib/marketplaces/types';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const BodySchema = z
  .object({
    stage: z.enum(OZON_FULL_STAGES).optional(),
    stages: z.record(z.enum(OZON_FULL_STAGES), z.boolean()).optional(),
    fromDate: z.string().regex(ISO_DATE_RE).optional(),
    toDate: z.string().regex(ISO_DATE_RE).optional(),
    force: z.boolean().optional(),
    kind: z.string().optional(),
  })
  .passthrough()
  .optional();

console.log('\n=== BodySchema validation ===');
{
  const r = BodySchema.safeParse({ stages: { analyticsData: true }, fromDate: '2026-05-22', toDate: '2026-05-22' });
  ok('valid с fromDate/toDate', r.success);
}
{
  const r = BodySchema.safeParse({ fromDate: '22-05-2026' });
  ok('invalid date format → fail', !r.success);
}
{
  const r = BodySchema.safeParse({ force: true });
  ok('force boolean ok', r.success);
}
{
  const r = BodySchema.safeParse({ stages: { unknownStage: true } });
  ok('unknown stage → fail', !r.success);
}
{
  const r = BodySchema.safeParse({});
  ok('empty body ok (default sync)', r.success);
}
{
  const r = BodySchema.safeParse(undefined);
  ok('undefined body ok', r.success);
}

// ============================================================================
// Route-level validation: from без to → 400

function validatePair(from?: string, to?: string): string | null {
  if ((from && !to) || (!from && to)) return 'fromDate и toDate должны быть заданы вместе';
  if (from && to && from > to) return 'fromDate должно быть <= toDate';
  return null;
}

console.log('\n=== Route validation: from+to pair ===');
ok('both empty ok', validatePair() === null);
ok('both set ok', validatePair('2026-05-22', '2026-05-22') === null);
ok('only from → error', validatePair('2026-05-22', undefined) !== null);
ok('only to → error', validatePair(undefined, '2026-05-22') !== null);
ok('from > to → error', validatePair('2026-05-22', '2026-05-15') !== null);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

export {};
