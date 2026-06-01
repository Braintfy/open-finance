// PURPOSE: CRUD для ИИ-отчётов «AI Анализ раздела». История скоупится на
// раздел (tenant + user + pageKey), лимит 10. При достижении лимита saveReport
// требует overwriteOldest=true (UI спрашивает подтверждение перезаписи).
import { and, asc, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { sectionAiReports, type SectionAiReport } from '@/lib/db/schema/section-ai-reports';
import {
  SECTION_AI_MAX_REPORTS,
  type SectionInsight,
  type SectionReportMeta,
} from '@/lib/ai/section-insights';

export type SaveSectionReportResult =
  | { ok: true; report: SectionAiReport }
  | { ok: false; needsOverwrite: true; oldest: { id: string; createdAt: Date } };

/** Все отчёты раздела, новые сверху. */
export async function listSectionReports(args: {
  tenantId: string;
  userId: string;
  pageKey: string;
}): Promise<SectionAiReport[]> {
  return db
    .select()
    .from(sectionAiReports)
    .where(
      and(
        eq(sectionAiReports.tenantId, args.tenantId),
        eq(sectionAiReports.userId, args.userId),
        eq(sectionAiReports.pageKey, args.pageKey),
      ),
    )
    .orderBy(desc(sectionAiReports.createdAt));
}

/** Выбрать конкретные отчёты раздела по id (для подмешивания в контекст). */
export async function getSectionReportsByIds(args: {
  tenantId: string;
  userId: string;
  pageKey: string;
  ids: string[];
}): Promise<SectionAiReport[]> {
  if (args.ids.length === 0) return [];
  const rows = await listSectionReports({
    tenantId: args.tenantId,
    userId: args.userId,
    pageKey: args.pageKey,
  });
  const idSet = new Set(args.ids);
  return rows.filter((r) => idSet.has(r.id));
}

/**
 * Сохранить новый отчёт. Если уже 10 на раздел:
 *  - overwriteOldest=true → удалить самый старый и вставить новый;
 *  - иначе → вернуть { needsOverwrite } без вставки.
 */
export async function saveSectionReport(args: {
  tenantId: string;
  userId: string;
  pageKey: string;
  pageLabel: string | null;
  model: string | null;
  summary: string;
  insights: SectionInsight[];
  meta: SectionReportMeta | null;
  overwriteOldest?: boolean;
}): Promise<SaveSectionReportResult> {
  const existing = await db
    .select({ id: sectionAiReports.id, createdAt: sectionAiReports.createdAt })
    .from(sectionAiReports)
    .where(
      and(
        eq(sectionAiReports.tenantId, args.tenantId),
        eq(sectionAiReports.userId, args.userId),
        eq(sectionAiReports.pageKey, args.pageKey),
      ),
    )
    .orderBy(asc(sectionAiReports.createdAt));

  if (existing.length >= SECTION_AI_MAX_REPORTS) {
    const oldest = existing[0];
    if (!args.overwriteOldest) {
      return { ok: false, needsOverwrite: true, oldest };
    }
    const toDelete = existing.slice(0, existing.length - (SECTION_AI_MAX_REPORTS - 1));
    await Promise.all(
      toDelete.map((r) =>
        db
          .delete(sectionAiReports)
          .where(
            and(
              eq(sectionAiReports.id, r.id),
              eq(sectionAiReports.tenantId, args.tenantId),
              eq(sectionAiReports.userId, args.userId),
            ),
          ),
      ),
    );
  }

  const [report] = await db
    .insert(sectionAiReports)
    .values({
      tenantId: args.tenantId,
      userId: args.userId,
      pageKey: args.pageKey,
      pageLabel: args.pageLabel,
      model: args.model,
      summary: args.summary,
      insights: args.insights,
      meta: args.meta,
    })
    .returning();
  return { ok: true, report };
}

/** Удалить один отчёт (scoped tenant + user). */
export async function deleteSectionReport(args: {
  tenantId: string;
  userId: string;
  reportId: string;
}): Promise<boolean> {
  const result = await db
    .delete(sectionAiReports)
    .where(
      and(
        eq(sectionAiReports.id, args.reportId),
        eq(sectionAiReports.tenantId, args.tenantId),
        eq(sectionAiReports.userId, args.userId),
      ),
    )
    .returning({ id: sectionAiReports.id });
  return result.length > 0;
}
