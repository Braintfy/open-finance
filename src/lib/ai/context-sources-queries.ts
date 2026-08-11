// PURPOSE: Сбор разделов-источников для кросс-раздельного контекста «AI Анализ
// раздела». Перечисляет разделы пользователя (block_layouts ∪ section_ai_reports ∪
// текущий), и для каждого отдаёт config блоков (из layout, без live-значений) +
// последний сохранённый ИИ-отчёт. Используется GET /api/ai/context-sources и
// серверным резолвом выбранных источников в analyze-section.
import { and, eq, inArray, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { blockLayouts } from '@/lib/db/schema/block-layouts';
import { sectionAiReports } from '@/lib/db/schema/section-ai-reports';
import { unitEconomicsTabs } from '@/lib/db/schema/unit-economics-tabs';
import { loadLayout } from '@/lib/blocks/queries';
import { listBoards } from '@/lib/boards/queries';
import { listSectionReports } from '@/lib/ai/section-reports-queries';
import { resolvePageLabel } from '@/lib/ai/page-labels';
import type { BlockInstance } from '@/lib/blocks/types';
import { workspaceScopeCondition } from '@/lib/workspaces/queries';
import {
  activeWorkspaceScope,
  isSharedPageKey,
  pageWorkspaceScope,
  type ActiveWorkspaceScope,
} from '@/lib/workspaces/scope';
import type {
  ExternalSourceContext,
  SectionBlockSnapshot,
  SectionContextSourceDto,
} from '@/lib/ai/section-insights';

const MAX_SECTIONS = 25;
const MAX_BLOCKS_PER_SECTION = 24;

function blockTitle(b: BlockInstance): string {
  const cfg = (b.config ?? {}) as Record<string, unknown>;
  return String(b.appearance?.title ?? cfg.title ?? b.type);
}

function toSnapshot(b: BlockInstance): SectionBlockSnapshot {
  return {
    blockId: b.id,
    type: b.type,
    title: blockTitle(b),
    config: b.config,
  };
}

/** Карта pageKey → человекочитаемая метка (UE-вкладки + доски). */
export async function buildCustomLabels(args: {
  tenantId: string;
  userId: string;
  workspace?: ActiveWorkspaceScope;
}): Promise<Record<string, string>> {
  // Вкладки UE — per-workspace: метки берём из активного кабинета.
  const tabScope = args.workspace ? activeWorkspaceScope(args.workspace) : undefined;
  const [tabRows, boards] = await Promise.all([
    db
      .select({ pageKey: unitEconomicsTabs.pageKey, label: unitEconomicsTabs.label })
      .from(unitEconomicsTabs)
      .where(
        and(
          eq(unitEconomicsTabs.tenantId, args.tenantId),
          eq(unitEconomicsTabs.userId, args.userId),
          workspaceScopeCondition(unitEconomicsTabs.workspaceId, tabScope),
        ),
      )
      .catch(() => [] as Array<{ pageKey: string; label: string }>),
    listBoards({ tenantId: args.tenantId, userId: args.userId }).catch(() => []),
  ]);
  const custom: Record<string, string> = {};
  for (const t of tabRows) custom[t.pageKey] = t.label;
  for (const b of boards) custom[`board-${b.id}`] = b.name || 'Доска';
  return custom;
}

/** Разделы-источники для мини-модалки выбора контекста. */
export async function listSectionContextSources(args: {
  tenantId: string;
  userId: string;
  currentPageKey: string;
  workspace?: ActiveWorkspaceScope;
}): Promise<SectionContextSourceDto[]> {
  const { tenantId, userId, currentPageKey, workspace } = args;
  const reportScope = workspace ? activeWorkspaceScope(workspace) : undefined;
  // Обе половины union'а тянут активный + default кабинет, лишнее отсекается
  // фильтром ниже: иначе 'board-*' страница с отчётами, но без строки layout,
  // пропадала бы из пикера в не-default кабинете.
  const reportWorkspaceFilter = workspace
    ? or(
        // активный кабинет (+ legacy NULL, если активный и есть default)
        workspaceScopeCondition(sectionAiReports.workspaceId, reportScope),
        // + default-кабинет — из него берём только общие ('board-*') страницы
        eq(sectionAiReports.workspaceId, workspace.defaultId),
      )
    : undefined;

  const [savedRowsAll, reportRowsAll, customLabels] = await Promise.all([
    db
      .select({ pageKey: blockLayouts.pageKey, workspaceId: blockLayouts.workspaceId })
      .from(blockLayouts)
      .where(
        and(
          eq(blockLayouts.tenantId, tenantId),
          eq(blockLayouts.userId, userId),
          workspace
            ? inArray(blockLayouts.workspaceId, [workspace.activeId, workspace.defaultId])
            : undefined,
        ),
      ),
    db
      .select({ pageKey: sectionAiReports.pageKey, workspaceId: sectionAiReports.workspaceId })
      .from(sectionAiReports)
      .where(
        and(
          eq(sectionAiReports.tenantId, tenantId),
          eq(sectionAiReports.userId, userId),
          reportWorkspaceFilter,
        ),
      ),
    buildCustomLabels({ tenantId, userId, workspace }),
  ]);

  // Изоляция кабинетов: страницы активного + ОБЩИЕ ('board-*') из default.
  const savedRows = workspace
    ? savedRowsAll.filter(
        (r) => r.workspaceId === workspace.activeId || isSharedPageKey(r.pageKey),
      )
    : savedRowsAll;

  // Та же изоляция для отчётов (+ legacy NULL — только в default-кабинете).
  const reportRows = workspace
    ? reportRowsAll.filter(
        (r) =>
          r.workspaceId === workspace.activeId ||
          (r.workspaceId === workspace.defaultId && isSharedPageKey(r.pageKey)) ||
          (r.workspaceId === null && reportScope?.includeLegacy === true),
      )
    : reportRowsAll;

  const pageKeys = Array.from(
    new Set<string>([
      currentPageKey,
      ...savedRows.map((r) => r.pageKey),
      ...reportRows.map((r) => r.pageKey),
    ]),
  )
    .filter((k) => k && k !== 'nav')
    .slice(0, MAX_SECTIONS);

  const sources = await Promise.all(
    pageKeys.map(async (pageKey): Promise<SectionContextSourceDto> => {
      const pageScope = workspace ? pageWorkspaceScope(workspace, pageKey) : undefined;
      const [layout, reports] = await Promise.all([
        loadLayout({
          tenantId,
          userId,
          pageKey,
          workspaceId: pageScope?.workspaceId,
          workspaceTemplate: pageScope?.template,
        }).catch(() => ({
          blocks: [] as BlockInstance[],
          hiddenSections: [] as string[],
        })),
        listSectionReports({ tenantId, userId, pageKey, workspace: pageScope }).catch(
          () => [],
        ),
      ]);
      const blocks = layout.blocks.slice(0, MAX_BLOCKS_PER_SECTION).map(toSnapshot);
      const last = reports[0];
      return {
        pageKey,
        label: resolvePageLabel(pageKey, customLabels),
        isCurrent: pageKey === currentPageKey,
        blocks,
        lastReport: last
          ? {
              id: last.id,
              createdAt: last.createdAt.toISOString(),
              model: last.model,
              summary: last.summary,
              insights: last.insights,
            }
          : null,
      };
    }),
  );

  // Сортировка: текущий раздел → с отчётом → по алфавиту.
  sources.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    const ar = a.lastReport ? 0 : 1;
    const br = b.lastReport ? 0 : 1;
    if (ar !== br) return ar - br;
    return a.label.localeCompare(b.label, 'ru');
  });

  return sources;
}

/**
 * Резолвит выбранные кросс-раздельные источники для сервера analyze-section.
 * Возвращает контекст (label + mode + report|blocks), которые подмешиваются в
 * assembleSectionContext. Безопасно: тело резолвится из БД, не доверяется клиенту.
 */
export async function resolveExternalSources(args: {
  tenantId: string;
  userId: string;
  selections: Array<{ pageKey: string; mode: 'report' | 'blocks' }>;
  customLabels?: Record<string, string>;
  workspace?: ActiveWorkspaceScope;
}): Promise<ExternalSourceContext[]> {
  const { tenantId, userId, selections, workspace } = args;
  const customLabels =
    args.customLabels ?? (await buildCustomLabels({ tenantId, userId, workspace }));

  const resolved = await Promise.all(
    selections.map(async (sel): Promise<ExternalSourceContext | null> => {
      const label = resolvePageLabel(sel.pageKey, customLabels);
      const pageScope = workspace ? pageWorkspaceScope(workspace, sel.pageKey) : undefined;
      if (sel.mode === 'report') {
        const reports = await listSectionReports({
          tenantId,
          userId,
          pageKey: sel.pageKey,
          workspace: pageScope,
        }).catch(() => []);
        const last = reports[0];
        if (!last) return null;
        return {
          label,
          mode: 'report' as const,
          report: {
            createdAt: last.createdAt.toISOString(),
            summary: last.summary,
            insights: last.insights,
          },
        };
      }
      const layout = await loadLayout({
        tenantId,
        userId,
        pageKey: sel.pageKey,
        workspaceId: pageScope?.workspaceId,
        workspaceTemplate: pageScope?.template,
      }).catch(() => ({
        blocks: [] as BlockInstance[],
        hiddenSections: [] as string[],
      }));
      const blocks = layout.blocks.slice(0, MAX_BLOCKS_PER_SECTION).map(toSnapshot);
      if (blocks.length === 0) return null;
      return { label, mode: 'blocks' as const, blocks };
    }),
  );

  return resolved.filter((r): r is ExternalSourceContext => r !== null);
}
