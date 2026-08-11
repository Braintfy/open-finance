// PURPOSE: CRUD для ИИ-отчётов «AI Анализ блока». История скоупится на блок
// (tenant + user + pageKey + blockId), лимит 10. При достижении лимита
// saveBlockReport требует overwriteOldest=true (UI спрашивает подтверждение).
//
// Воркспейсы (Этап 3): отчёты изолированы по кабинетам. workspace-скоуп
// резолвится вызывающим роутом через getPageWorkspaceScope(pageKey) и
// передаётся параметром `workspace`; без него — прежнее поведение (все отчёты
// пары tenant+user). Следствие резолва ПО СТРАНИЦЕ: у общих ключей
// (isSharedPageKey — 'nav'/'board-*') скоуп = default-кабинет, то есть отчёты
// досок ОБЩИЕ для всех кабинетов; изолированы отчёты только непубличных
// страниц. block_ai_reports.workspace_id остаётся NULLABLE: legacy-отчёты
// (созданные до Этапа 3) видны ТОЛЬКО в default-кабинете (includeLegacy).
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { blockAiReports, type BlockAiReport } from '@/lib/db/schema/block-ai-reports';
import { workspaceScopeCondition } from '@/lib/workspaces/queries';
import type { PageWorkspaceScope } from '@/lib/workspaces/scope';
import {
  SECTION_AI_MAX_REPORTS,
  type SectionInsight,
  type SectionReportMeta,
} from '@/lib/ai/section-insights';

export const BLOCK_AI_MAX_REPORTS = SECTION_AI_MAX_REPORTS;

export type SaveBlockReportResult =
  | { ok: true; report: BlockAiReport }
  | { ok: false; needsOverwrite: true; oldest: { id: string; createdAt: Date } };

/** Все отчёты блока, новые сверху. */
export async function listBlockReports(args: {
  tenantId: string;
  userId: string;
  pageKey: string;
  blockId: string;
  workspace?: PageWorkspaceScope;
}): Promise<BlockAiReport[]> {
  return db
    .select()
    .from(blockAiReports)
    .where(
      and(
        eq(blockAiReports.tenantId, args.tenantId),
        eq(blockAiReports.userId, args.userId),
        eq(blockAiReports.pageKey, args.pageKey),
        eq(blockAiReports.blockId, args.blockId),
        workspaceScopeCondition(blockAiReports.workspaceId, args.workspace),
      ),
    )
    .orderBy(desc(blockAiReports.createdAt));
}

/** Последний отчёт по каждому blockId страницы (map blockId → отчёт). */
export async function getLatestBlockReportsForPage(args: {
  tenantId: string;
  userId: string;
  pageKey: string;
  blockIds?: string[];
  workspace?: PageWorkspaceScope;
}): Promise<Record<string, BlockAiReport>> {
  const conds = [
    eq(blockAiReports.tenantId, args.tenantId),
    eq(blockAiReports.userId, args.userId),
    eq(blockAiReports.pageKey, args.pageKey),
    workspaceScopeCondition(blockAiReports.workspaceId, args.workspace),
  ];
  if (args.blockIds && args.blockIds.length > 0) {
    conds.push(inArray(blockAiReports.blockId, args.blockIds));
  }
  const rows = await db
    .select()
    .from(blockAiReports)
    .where(and(...conds))
    .orderBy(desc(blockAiReports.createdAt));

  const map: Record<string, BlockAiReport> = {};
  for (const r of rows) {
    if (!map[r.blockId]) map[r.blockId] = r; // первый = самый свежий
  }
  return map;
}

/**
 * Сохранить новый отчёт. Если уже 10 на блок:
 *  - overwriteOldest=true → удалить самый старый и вставить новый;
 *  - иначе → вернуть { needsOverwrite } без вставки.
 */
export async function saveBlockReport(args: {
  tenantId: string;
  userId: string;
  pageKey: string;
  blockId: string;
  blockType: string | null;
  blockTitle: string | null;
  model: string | null;
  summary: string;
  insights: SectionInsight[];
  meta: SectionReportMeta | null;
  overwriteOldest?: boolean;
  workspace?: PageWorkspaceScope;
}): Promise<SaveBlockReportResult> {
  const existing = await db
    .select({ id: blockAiReports.id, createdAt: blockAiReports.createdAt })
    .from(blockAiReports)
    .where(
      and(
        eq(blockAiReports.tenantId, args.tenantId),
        eq(blockAiReports.userId, args.userId),
        eq(blockAiReports.pageKey, args.pageKey),
        eq(blockAiReports.blockId, args.blockId),
        workspaceScopeCondition(blockAiReports.workspaceId, args.workspace),
      ),
    )
    .orderBy(asc(blockAiReports.createdAt));

  if (existing.length >= BLOCK_AI_MAX_REPORTS) {
    const oldest = existing[0];
    if (!args.overwriteOldest) {
      return { ok: false, needsOverwrite: true, oldest };
    }
    const toDelete = existing.slice(0, existing.length - (BLOCK_AI_MAX_REPORTS - 1));
    await Promise.all(
      toDelete.map((r) =>
        db
          .delete(blockAiReports)
          .where(
            and(
              eq(blockAiReports.id, r.id),
              eq(blockAiReports.tenantId, args.tenantId),
              eq(blockAiReports.userId, args.userId),
            ),
          ),
      ),
    );
  }

  const [report] = await db
    .insert(blockAiReports)
    .values({
      tenantId: args.tenantId,
      userId: args.userId,
      workspaceId: args.workspace?.workspaceId ?? null,
      pageKey: args.pageKey,
      blockId: args.blockId,
      blockType: args.blockType,
      blockTitle: args.blockTitle,
      model: args.model,
      summary: args.summary,
      insights: args.insights,
      meta: args.meta,
    })
    .returning();
  return { ok: true, report };
}

/** Удалить один отчёт (scoped tenant + user). */
export async function deleteBlockReport(args: {
  tenantId: string;
  userId: string;
  reportId: string;
}): Promise<boolean> {
  const result = await db
    .delete(blockAiReports)
    .where(
      and(
        eq(blockAiReports.id, args.reportId),
        eq(blockAiReports.tenantId, args.tenantId),
        eq(blockAiReports.userId, args.userId),
      ),
    )
    .returning({ id: blockAiReports.id });
  return result.length > 0;
}
