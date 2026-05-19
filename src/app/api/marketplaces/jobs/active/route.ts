// PURPOSE: GET /api/marketplaces/jobs/active — список активных sync-jobs
// текущего tenant. Используется компонентом <GlobalSyncIndicator/> для
// показа прогресса синхронизации на всех страницах приложения.

import { NextResponse } from 'next/server';
import { and, eq, inArray, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { auth } from '@/lib/auth';
import {
  marketplaceAccounts,
  ozonSyncJobs,
  type SyncStageState,
} from '@/lib/db/schema/marketplaces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const rows = await db
      .select({
        jobId: ozonSyncJobs.id,
        accountId: ozonSyncJobs.accountId,
        accountName: marketplaceAccounts.name,
        kind: ozonSyncJobs.kind,
        status: ozonSyncJobs.status,
        startedAt: ozonSyncJobs.startedAt,
        itemsProcessed: ozonSyncJobs.itemsProcessed,
        itemsTotal: ozonSyncJobs.itemsTotal,
        stages: ozonSyncJobs.stages,
        createdAt: ozonSyncJobs.createdAt,
        updatedAt: ozonSyncJobs.updatedAt,
      })
      .from(ozonSyncJobs)
      .innerJoin(
        marketplaceAccounts,
        eq(ozonSyncJobs.accountId, marketplaceAccounts.id),
      )
      .where(
        and(
          eq(ozonSyncJobs.tenantId, session.tenantId),
          inArray(ozonSyncJobs.status, ['pending', 'running']),
        ),
      )
      .orderBy(desc(ozonSyncJobs.createdAt))
      .limit(10);

    const jobs = rows.map((j) => {
      const stages = (j.stages ?? {}) as Record<string, SyncStageState>;
      let currentStage: string | null = null;
      let currentStageProcessed = 0;
      let currentStageTotal = 0;
      for (const [name, s] of Object.entries(stages)) {
        if (s.status === 'running') {
          currentStage = name;
          currentStageProcessed = s.itemsProcessed ?? 0;
          currentStageTotal = s.itemsTotal ?? 0;
          break;
        }
      }
      return {
        jobId: j.jobId,
        accountId: j.accountId,
        accountName: j.accountName || 'Магазин',
        kind: j.kind,
        status: j.status,
        startedAt: j.startedAt?.toISOString() ?? null,
        itemsProcessed: j.itemsProcessed,
        itemsTotal: j.itemsTotal,
        currentStage,
        currentStageProcessed,
        currentStageTotal,
        stages,
      };
    });

    return NextResponse.json({ ok: true, jobs });
  } catch (e) {
    console.error('[marketplaces] GET /jobs/active failed:', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 },
    );
  }
}
