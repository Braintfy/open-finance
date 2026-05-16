// PURPOSE: GET /api/marketplaces/accounts/[id]/jobs — история job'ов.

import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listSyncJobs } from '@/lib/marketplaces/queries';

export const runtime = 'nodejs';

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const jobs = await listSyncJobs({
      tenantId: session.tenantId,
      accountId: id,
      limit: 20,
    });
    return NextResponse.json({
      ok: true,
      jobs: jobs.map((j) => ({
        id: j.id,
        kind: j.kind,
        status: j.status,
        startedAt: j.startedAt?.toISOString() ?? null,
        finishedAt: j.finishedAt?.toISOString() ?? null,
        itemsProcessed: j.itemsProcessed,
        itemsTotal: j.itemsTotal,
        stages: j.stages,
        errors: j.errors,
        createdAt: j.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    console.error('[marketplaces] GET /accounts/[id]/jobs failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
