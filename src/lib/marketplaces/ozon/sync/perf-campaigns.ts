// PURPOSE: Стейдж синхронизации списка рекламных кампаний из
// Ozon Performance API → ozon_perf_campaigns.
// Pre-requisite: у аккаунта должен быть perfClient (Performance API
// креды). Если нет — стейдж пропускается с status='skipped'.

import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { ozonPerfCampaigns } from '@/lib/db/schema/marketplaces';
import { listCampaigns } from '../performance/endpoints';
import { runStageWithTiming, type StageContext, type StageResult } from './types';

function parseMoney(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

export async function syncPerfCampaignsStage(ctx: StageContext): Promise<StageResult> {
  return runStageWithTiming(async () => {
    if (!ctx.perfClient) {
      return {
        itemsProcessed: 0,
        ok: false,
        error: 'Performance API не подключён для этого аккаунта',
      };
    }
    const campaigns = await listCampaigns(ctx.perfClient);

    let processed = 0;
    for (const c of campaigns) {
      const campaignId = String(c.id ?? '').trim();
      if (!campaignId) continue;

      await db
        .insert(ozonPerfCampaigns)
        .values({
          tenantId: ctx.tenantId,
          accountId: ctx.accountId,
          campaignId,
          title: typeof c.title === 'string' ? c.title : null,
          state: typeof c.state === 'string' ? c.state : null,
          advObjectType: typeof c.advObjectType === 'string' ? c.advObjectType : null,
          paymentType: typeof c.paymentType === 'string' ? c.paymentType : null,
          dailyBudgetKopecks: parseMoney(c.dailyBudget),
          budgetKopecks: parseMoney(c.budget),
          startDate: typeof c.fromDate === 'string' ? c.fromDate.slice(0, 10) : null,
          endDate: typeof c.toDate === 'string' ? c.toDate.slice(0, 10) : null,
          raw: c as Record<string, unknown>,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [ozonPerfCampaigns.accountId, ozonPerfCampaigns.campaignId],
          set: {
            title: typeof c.title === 'string' ? c.title : sql`ozon_perf_campaigns.title`,
            state: typeof c.state === 'string' ? c.state : sql`ozon_perf_campaigns.state`,
            advObjectType:
              typeof c.advObjectType === 'string'
                ? c.advObjectType
                : sql`ozon_perf_campaigns.adv_object_type`,
            paymentType:
              typeof c.paymentType === 'string'
                ? c.paymentType
                : sql`ozon_perf_campaigns.payment_type`,
            dailyBudgetKopecks:
              parseMoney(c.dailyBudget) ?? sql`ozon_perf_campaigns.daily_budget_kopecks`,
            budgetKopecks:
              parseMoney(c.budget) ?? sql`ozon_perf_campaigns.budget_kopecks`,
            raw: c as Record<string, unknown>,
            syncedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      processed += 1;
      ctx.onProgress?.(processed, campaigns.length);
    }

    return { itemsProcessed: processed, itemsTotal: campaigns.length };
  });
}
