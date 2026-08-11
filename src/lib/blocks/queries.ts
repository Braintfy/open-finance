// PURPOSE: Запросы к block_layouts (load/save layout per workspace × page)
//
// workspaceId (опционально): раскладки скоупятся на воркспейс. Когда параметр не
// передан — резолвим DEFAULT-кабинет пары (tenant,user) лениво через
// getOrCreateDefaultWorkspace (обратная совместимость для вызовов, которым
// активный кабинет не важен).
//
// Активный кабинет резолвится ВЫШЕ по стеку (RSC-страницы и route handlers) через
// getPageWorkspaceScope() из src/lib/workspaces/active.ts:
//   - СТРАНИЧНЫЕ раскладки (dashboard/cashflow/unit-economics-*/marketplaces/
//     inbox/settings) → активный кабинет;
//   - ОБЩИЕ ('nav' = сайдбар, 'board-*' = доски) → всегда default-кабинет.
// Правила — src/lib/workspaces/scope.ts (isSharedPageKey / pageWorkspaceScope).
//
// workspaceTemplate влияет только на КОД-ДЕФОЛТ (строки в БД нет): кабинет
// 'blank' отдаёт пустые страницы, 'seller-ozon' — стартовый Ozon-дашборд.
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { blockLayouts } from '@/lib/db/schema/block-layouts';
import { getOrCreateDefaultWorkspace } from '@/lib/workspaces/queries';
import type { BlockInstance } from './types';
import { getDefaultLayout } from './default-layouts';

/** Резолвит workspaceId: явный аргумент или DEFAULT-кабинет пары (tenant,user). */
async function resolveWorkspaceId(args: {
  tenantId: string;
  userId: string;
  workspaceId?: string;
}): Promise<string> {
  if (args.workspaceId) return args.workspaceId;
  const ws = await getOrCreateDefaultWorkspace(args.tenantId, args.userId);
  return ws.id;
}

export async function loadLayout(args: {
  tenantId: string;
  userId: string;
  pageKey: string;
  workspaceId?: string;
  /** Шаблон кабинета ('seller-ozon' | 'blank') — влияет на код-дефолт. */
  workspaceTemplate?: string;
}): Promise<{ blocks: BlockInstance[]; hiddenSections: string[] }> {
  const workspaceId = await resolveWorkspaceId(args);
  const [row] = await db
    .select()
    .from(blockLayouts)
    .where(
      and(
        eq(blockLayouts.tenantId, args.tenantId),
        eq(blockLayouts.userId, args.userId),
        eq(blockLayouts.workspaceId, workspaceId),
        eq(blockLayouts.pageKey, args.pageKey)
      )
    )
    .limit(1);

  if (!row) {
    const defaults = getDefaultLayout(args.pageKey, args.workspaceTemplate);
    return {
      blocks: defaults.blocks,
      hiddenSections: defaults.hiddenSections ?? [],
    };
  }

  return {
    blocks: (row.blocks ?? []) as BlockInstance[],
    hiddenSections: row.hiddenSections ?? [],
  };
}

export async function deleteLayout(args: {
  tenantId: string;
  userId: string;
  pageKey: string;
  workspaceId?: string;
}): Promise<void> {
  const workspaceId = await resolveWorkspaceId(args);
  await db
    .delete(blockLayouts)
    .where(
      and(
        eq(blockLayouts.tenantId, args.tenantId),
        eq(blockLayouts.userId, args.userId),
        eq(blockLayouts.workspaceId, workspaceId),
        eq(blockLayouts.pageKey, args.pageKey)
      )
    );
}

export async function saveLayout(args: {
  tenantId: string;
  userId: string;
  pageKey: string;
  blocks: BlockInstance[];
  hiddenSections?: string[];
  workspaceId?: string;
}): Promise<void> {
  const workspaceId = await resolveWorkspaceId(args);
  await db
    .insert(blockLayouts)
    .values({
      tenantId: args.tenantId,
      userId: args.userId,
      workspaceId,
      pageKey: args.pageKey,
      blocks: args.blocks,
      hiddenSections: args.hiddenSections ?? [],
    })
    .onConflictDoUpdate({
      // Target ОБЯЗАН совпадать с уникальным индексом (workspace_id, page_key) —
      // иначе Postgres не найдёт arbiter и upsert упадёт; поэтому tenant_id в
      // target не входит. Изоляцию даёт валидация workspaceId вызывающим:
      // resolveWorkspaceId (default пары tenant+user) либо getWorkspaceById
      // с проверкой принадлежности (tenant, user).
      target: [blockLayouts.workspaceId, blockLayouts.pageKey],
      set: {
        blocks: args.blocks,
        hiddenSections: args.hiddenSections ?? [],
        updatedAt: new Date(),
      },
    });
}
