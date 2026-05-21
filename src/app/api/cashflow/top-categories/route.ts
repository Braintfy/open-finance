// PURPOSE: GET /api/cashflow/top-categories — топ категорий за период.
// Возвращает {rows, totalSum} — нужно для StackedBar/% от общего.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getTopCategories, getCashflowSummary } from '@/lib/cashflow/queries';
import { resolvePeriod, type PeriodPreset } from '@/components/blocks/period-picker';

const Query = z.object({
  type: z.enum(['income', 'expense']).default('expense'),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  /** Может быть указан как preset+custom или from/to ISO. */
  preset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .optional(),
  customFrom: z.string().nullable().optional(),
  customTo: z.string().nullable().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  source: z.string().max(50).optional(),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = Query.safeParse({
    type: url.searchParams.get('type') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    preset: url.searchParams.get('preset') ?? undefined,
    customFrom: url.searchParams.get('customFrom') ?? undefined,
    customTo: url.searchParams.get('customTo') ?? undefined,
    from: url.searchParams.get('from') ?? undefined,
    to: url.searchParams.get('to') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Bad query', details: parsed.error.format() },
      { status: 400 },
    );
  }
  const q = parsed.data;

  let from: Date | undefined;
  let to: Date | undefined;
  if (q.from && q.to) {
    from = new Date(q.from);
    to = new Date(q.to);
  } else if (q.preset) {
    const period = resolvePeriod(q.preset as PeriodPreset, q.customFrom ?? undefined, q.customTo ?? undefined);
    from = period.from;
    to = period.to;
  }

  const [rows, summary] = await Promise.all([
    getTopCategories(session.tenantId, q.type, q.limit, { from, to, source: q.source }),
    getCashflowSummary(session.tenantId, from, to, { source: q.source }),
  ]);

  const totalSum = q.type === 'income' ? summary.incomeTotal : summary.expenseTotal;

  return NextResponse.json({ ok: true, rows, totalSum });
}
