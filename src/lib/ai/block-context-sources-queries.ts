// PURPOSE: Сбор блоков-источников для контекста «AI Анализ блока» (пикер блоков
// всего проекта). Перечисляет разделы пользователя (block_layouts ∪ block_ai_reports),
// и для каждого отдаёт список блоков (config + последний отчёт блока).
// Используется GET /api/ai/block-context-sources и серверным резолвом выбранных
// блоков в analyze-block. Тело резолвится из БД — не доверяется клиенту.
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { blockLayouts } from '@/lib/db/schema/block-layouts';
import { blockAiReports, type BlockAiReport } from '@/lib/db/schema/block-ai-reports';
import { loadLayout } from '@/lib/blocks/queries';
import { resolvePageLabel } from '@/lib/ai/page-labels';
import { buildCustomLabels } from '@/lib/ai/context-sources-queries';
import { getLatestBlockReportsForPage } from '@/lib/ai/block-reports-queries';
import type { BlockInstance } from '@/lib/blocks/types';
import type {
  BlockContextSourceDto,
  BlockContextBlockDto,
  ExternalSourceContext,
  SectionBlockSnapshot,
} from '@/lib/ai/section-insights';

const MAX_SECTIONS = 25;
const MAX_BLOCKS_PER_SECTION = 30;

function blockTitle(b: BlockInstance): string {
  const cfg = (b.config ?? {}) as Record<string, unknown>;
  return String(b.appearance?.title ?? cfg.title ?? b.type);
}

function toSnapshot(b: BlockInstance): SectionBlockSnapshot {
  return { blockId: b.id, type: b.type, title: blockTitle(b), config: b.config };
}

/** Разделы → блоки для пикера контекста анализа блока. */
export async function listBlockContextSources(args: {
  tenantId: string;
  userId: string;
  currentPageKey: string;
}): Promise<BlockContextSourceDto[]> {
  const { tenantId, userId, currentPageKey } = args;

  const [layoutRows, reportRows, customLabels] = await Promise.all([
    db
      .select({ pageKey: blockLayouts.pageKey })
      .from(blockLayouts)
      .where(and(eq(blockLayouts.tenantId, tenantId), eq(blockLayouts.userId, userId))),
    db
      .select({ pageKey: blockAiReports.pageKey })
      .from(blockAiReports)
      .where(and(eq(blockAiReports.tenantId, tenantId), eq(blockAiReports.userId, userId))),
    buildCustomLabels({ tenantId, userId }),
  ]);

  const pageKeys = Array.from(
    new Set<string>([
      currentPageKey,
      ...layoutRows.map((r) => r.pageKey),
      ...reportRows.map((r) => r.pageKey),
    ]),
  )
    .filter((k) => k && k !== 'nav')
    .slice(0, MAX_SECTIONS);

  const sources = await Promise.all(
    pageKeys.map(async (pageKey): Promise<BlockContextSourceDto> => {
      const [layout, reportMap] = await Promise.all([
        loadLayout({ tenantId, userId, pageKey }).catch(() => ({
          blocks: [] as BlockInstance[],
          hiddenSections: [] as string[],
        })),
        getLatestBlockReportsForPage({ tenantId, userId, pageKey }).catch(
          (): Record<string, BlockAiReport> => ({}),
        ),
      ]);
      const isCurrent = pageKey === currentPageKey;
      const blocks: BlockContextBlockDto[] = layout.blocks
        .slice(0, MAX_BLOCKS_PER_SECTION)
        .map((b) => {
          const last = reportMap[b.id];
          return {
            blockId: b.id,
            type: b.type,
            title: blockTitle(b),
            // Для текущего раздела config не нужен — клиент берёт live из page-snapshot.
            config: isCurrent ? undefined : b.config,
            lastReport: last
              ? {
                  id: last.id,
                  createdAt: last.createdAt.toISOString(),
                  summary: last.summary,
                  insights: last.insights,
                }
              : null,
          };
        });
      return {
        pageKey,
        label: resolvePageLabel(pageKey, customLabels),
        isCurrent,
        blocks,
      };
    }),
  );

  sources.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return a.label.localeCompare(b.label, 'ru');
  });

  return sources;
}

/**
 * Резолвит выбранные блоки-источники для сервера analyze-block.
 * Каждый блок → один ExternalSourceContext (report → последний отчёт блока,
 * data → snapshot блока из layout). Безопасно: тело из БД, не от клиента.
 */
export async function resolveBlockContextSelections(args: {
  tenantId: string;
  userId: string;
  selections: Array<{ pageKey: string; blockId: string; mode: 'report' | 'data' }>;
  customLabels?: Record<string, string>;
}): Promise<ExternalSourceContext[]> {
  const { tenantId, userId, selections } = args;
  if (selections.length === 0) return [];
  const customLabels = args.customLabels ?? (await buildCustomLabels({ tenantId, userId }));

  // Группируем по pageKey — один loadLayout / reportMap на раздел.
  const byPage = new Map<string, Array<{ blockId: string; mode: 'report' | 'data' }>>();
  for (const s of selections) {
    const list = byPage.get(s.pageKey) ?? [];
    list.push({ blockId: s.blockId, mode: s.mode });
    byPage.set(s.pageKey, list);
  }

  const resolved: ExternalSourceContext[] = [];
  await Promise.all(
    Array.from(byPage.entries()).map(async ([pageKey, sels]) => {
      const pageLabel = resolvePageLabel(pageKey, customLabels);
      const needReports = sels.some((s) => s.mode === 'report');
      const needData = sels.some((s) => s.mode === 'data');
      const [layout, reportMap] = await Promise.all([
        needData
          ? loadLayout({ tenantId, userId, pageKey }).catch(() => ({
              blocks: [] as BlockInstance[],
              hiddenSections: [] as string[],
            }))
          : Promise.resolve({ blocks: [] as BlockInstance[], hiddenSections: [] as string[] }),
        needReports
          ? getLatestBlockReportsForPage({ tenantId, userId, pageKey }).catch(
              (): Record<string, BlockAiReport> => ({}),
            )
          : Promise.resolve({} as Record<string, BlockAiReport>),
      ]);
      const blockMap = new Map(layout.blocks.map((b) => [b.id, b]));
      for (const sel of sels) {
        if (sel.mode === 'report') {
          const last = reportMap[sel.blockId];
          if (!last) continue;
          resolved.push({
            label: `${pageLabel} · ${last.blockTitle ?? 'блок'}`,
            mode: 'report',
            report: {
              createdAt: last.createdAt.toISOString(),
              summary: last.summary,
              insights: last.insights,
            },
          });
        } else {
          const b = blockMap.get(sel.blockId);
          if (!b) continue;
          resolved.push({
            label: `${pageLabel} · ${blockTitle(b)}`,
            mode: 'blocks',
            blocks: [toSnapshot(b)],
          });
        }
      }
    }),
  );

  return resolved;
}
