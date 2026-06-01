// PURPOSE: CRUD для ИИ-отчётов блока unit.ozon-ai-insights.
// История скоупится на блок (tenant + user + block_id), лимит 10.
// При достижении лимита saveReport требует overwriteOldest=true (UI спрашивает
// подтверждение перезаписи самого старого отчёта).
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  ozonAiInsightReports,
  type OzonAiInsightReport,
} from '@/lib/db/schema/ozon-ai-insights';
import {
  OZON_AI_INSIGHTS_MAX_REPORTS,
  type Insight,
} from '@/lib/blocks/catalog/unit-ozon-ai-insights-types';

export type SaveReportResult =
  | { ok: true; report: OzonAiInsightReport }
  | { ok: false; needsOverwrite: true; oldest: { id: string; createdAt: Date } };

/** Все отчёты блока, новые сверху. */
export async function listReports(args: {
  tenantId: string;
  userId: string;
  blockId: string;
}): Promise<OzonAiInsightReport[]> {
  return db
    .select()
    .from(ozonAiInsightReports)
    .where(
      and(
        eq(ozonAiInsightReports.tenantId, args.tenantId),
        eq(ozonAiInsightReports.userId, args.userId),
        eq(ozonAiInsightReports.blockId, args.blockId),
      ),
    )
    .orderBy(desc(ozonAiInsightReports.createdAt));
}

/**
 * Сохранить новый отчёт. Если уже 10 отчётов на блок:
 *  - overwriteOldest=true → удалить самый старый и вставить новый;
 *  - иначе → вернуть { needsOverwrite } без вставки (UI спросит подтверждение).
 */
export async function saveReport(args: {
  tenantId: string;
  userId: string;
  blockId: string;
  accountId: string | null;
  periodKey: string | null;
  model: string | null;
  summary: string;
  insights: Insight[];
  overwriteOldest?: boolean;
}): Promise<SaveReportResult> {
  const existing = await db
    .select({
      id: ozonAiInsightReports.id,
      createdAt: ozonAiInsightReports.createdAt,
    })
    .from(ozonAiInsightReports)
    .where(
      and(
        eq(ozonAiInsightReports.tenantId, args.tenantId),
        eq(ozonAiInsightReports.userId, args.userId),
        eq(ozonAiInsightReports.blockId, args.blockId),
      ),
    )
    .orderBy(asc(ozonAiInsightReports.createdAt));

  if (existing.length >= OZON_AI_INSIGHTS_MAX_REPORTS) {
    const oldest = existing[0];
    if (!args.overwriteOldest) {
      return { ok: false, needsOverwrite: true, oldest };
    }
    // Удаляем самый старый (а также любой «излишек» сверх лимита-1, на случай
    // ручных вставок), чтобы после вставки осталось ровно ≤ лимита.
    const toDelete = existing.slice(0, existing.length - (OZON_AI_INSIGHTS_MAX_REPORTS - 1));
    await Promise.all(
      toDelete.map((r) =>
        db
          .delete(ozonAiInsightReports)
          .where(
            and(
              eq(ozonAiInsightReports.id, r.id),
              eq(ozonAiInsightReports.tenantId, args.tenantId),
              eq(ozonAiInsightReports.userId, args.userId),
            ),
          ),
      ),
    );
  }

  const [report] = await db
    .insert(ozonAiInsightReports)
    .values({
      tenantId: args.tenantId,
      userId: args.userId,
      blockId: args.blockId,
      accountId: args.accountId,
      periodKey: args.periodKey,
      model: args.model,
      summary: args.summary,
      insights: args.insights,
    })
    .returning();
  return { ok: true, report };
}

/** Удалить один отчёт (scoped tenant + user). */
export async function deleteReport(args: {
  tenantId: string;
  userId: string;
  reportId: string;
}): Promise<boolean> {
  const result = await db
    .delete(ozonAiInsightReports)
    .where(
      and(
        eq(ozonAiInsightReports.id, args.reportId),
        eq(ozonAiInsightReports.tenantId, args.tenantId),
        eq(ozonAiInsightReports.userId, args.userId),
      ),
    )
    .returning({ id: ozonAiInsightReports.id });
  return result.length > 0;
}
