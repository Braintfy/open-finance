// PURPOSE: GET /api/cashflow/kpi — KPI с trend + sparkline.
// Возвращает {current, previous, count, prevCount, deltaPct, byDay}.
// Используется stat.income / stat.expense / stat.balance / stat.custom / chart.cashflow.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { getCashflowKpi, type CashflowKpiMetric } from '@/lib/cashflow/queries';
import { resolvePeriod, type PeriodPreset } from '@/components/blocks/period-picker';

const Query = z.object({
  metric: z.enum(['income', 'expense', 'balance']).default('income'),
  preset: z
    .enum(['today', 'yesterday', '7d', '14d', '30d', 'mtd', 'custom'])
    .default('mtd'),
  customFrom: z.string().nullable().optional(),
  customTo: z.string().nullable().optional(),
  counterparty: z.string().max(200).optional(),
  source: z.string().max(50).optional(),
  categoryName: z.string().max(200).optional(),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const parsed = Query.safeParse({
    metric: url.searchParams.get('metric') ?? undefined,
    preset: url.searchParams.get('preset') ?? undefined,
    customFrom: url.searchParams.get('customFrom') ?? undefined,
    customTo: url.searchParams.get('customTo') ?? undefined,
    counterparty: url.searchParams.get('counterparty') ?? undefined,
    source: url.searchParams.get('source') ?? undefined,
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

  const result = await getCashflowKpi({
    tenantId: session.tenantId,
    metric: q.metric as CashflowKpiMetric,
    from: period.from,
    to: period.to,
    counterparty: q.counterparty,
    source: q.source,
    categoryName: q.categoryName,
  });

  return NextResponse.json({ ok: true, ...result });
}
