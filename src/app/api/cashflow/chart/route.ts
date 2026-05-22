// PURPOSE: GET /api/cashflow/chart — данные для chart.cashflow с auto-granularity.
// {points: [{date, income, expense, balance}], granularity, compare?}
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getCashflowChart } from '@/lib/cashflow/queries';
import { resolvePeriod, type PeriodPreset } from '@/lib/blocks/period-resolver';

const Query = z.object({
  preset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('30d'),
  customFrom: z.string().nullable().optional(),
  customTo: z.string().nullable().optional(),
  granularity: z.enum(['auto', 'day', 'week', 'month']).default('auto'),
  compare: z.enum(['none', 'prev']).default('none'),
  source: z.string().max(50).optional(),
  /** Source binding: substring match по контрагенту. */
  counterparty: z.string().max(200).optional(),
  /** Source binding: exact match по имени категории (join с categories). */
  categoryName: z.string().max(200).optional(),
});

function pickGranularity(from: Date, to: Date): 'day' | 'week' | 'month' {
  const lengthDays = Math.round((to.getTime() - from.getTime()) / (24 * 3600 * 1000));
  if (lengthDays <= 31) return 'day';
  if (lengthDays <= 120) return 'week';
  return 'month';
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = Query.safeParse({
    preset: url.searchParams.get('preset') ?? undefined,
    customFrom: url.searchParams.get('customFrom') ?? undefined,
    customTo: url.searchParams.get('customTo') ?? undefined,
    granularity: url.searchParams.get('granularity') ?? undefined,
    compare: url.searchParams.get('compare') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
    counterparty: url.searchParams.get('counterparty') ?? undefined,
    categoryName: url.searchParams.get('categoryName') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: 'Bad query', details: parsed.error.format() },
      { status: 400 },
    );
  }
  const q = parsed.data;
  const period = resolvePeriod(
    q.preset as PeriodPreset,
    q.customFrom ?? undefined,
    q.customTo ?? undefined,
  );
  const granularity =
    q.granularity === 'auto' ? pickGranularity(period.from, period.to) : q.granularity;

  const points = await getCashflowChart({
    tenantId: session.tenantId,
    from: period.from,
    to: period.to,
    granularity,
    source: q.source,
    counterparty: q.counterparty,
    categoryName: q.categoryName,
  });

  let comparePoints: Awaited<ReturnType<typeof getCashflowChart>> | undefined;
  if (q.compare === 'prev') {
    const lengthMs = period.to.getTime() - period.from.getTime();
    const prevFrom = new Date(period.from.getTime() - lengthMs);
    const prevTo = period.from;
    comparePoints = await getCashflowChart({
      tenantId: session.tenantId,
      from: prevFrom,
      to: prevTo,
      granularity,
      source: q.source,
      counterparty: q.counterparty,
      categoryName: q.categoryName,
    });
  }

  return NextResponse.json({
    ok: true,
    granularity,
    points,
    compare: comparePoints,
  });
}
