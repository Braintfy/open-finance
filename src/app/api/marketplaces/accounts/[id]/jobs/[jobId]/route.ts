// PURPOSE: GET /api/marketplaces/accounts/[id]/jobs/[jobId] — статус
// конкретного job-а (для polling прогресса).

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { getSyncJob } from '@/lib/marketplaces/queries';

export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ id: string; jobId: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  try {
    const { jobId } = await ctx.params;
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const job = await getSyncJob({ tenantId: session.tenantId, jobId });
    if (!job) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      job: {
        id: job.id,
        kind: job.kind,
        status: job.status,
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
        itemsProcessed: job.itemsProcessed,
        itemsTotal: job.itemsTotal,
        stages: job.stages,
        errors: job.errors,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      },
    });
  } catch (e) {
    console.error('[marketplaces] GET /accounts/[id]/jobs/[jobId] failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
