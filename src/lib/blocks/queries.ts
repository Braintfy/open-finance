// PURPOSE: Запросы к block_layouts (load/save layout per user × tenant × page)
import { and, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { blockLayouts } from '@/lib/db/schema/block-layouts';
import type { BlockInstance } from './types';
import { getDefaultLayout } from './registry';

export async function loadLayout(args: {
  tenantId: string;
  userId: string;
  pageKey: string;
}): Promise<{ blocks: BlockInstance[]; hiddenSections: string[] }> {
  const [row] = await db
    .select()
    .from(blockLayouts)
    .where(
      and(
        eq(blockLayouts.tenantId, args.tenantId),
        eq(blockLayouts.userId, args.userId),
        eq(blockLayouts.pageKey, args.pageKey)
      )
    )
    .limit(1);

  if (!row) {
    const defaults = getDefaultLayout(args.pageKey);
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
}): Promise<void> {
  await db
    .delete(blockLayouts)
    .where(
      and(
        eq(blockLayouts.tenantId, args.tenantId),
        eq(blockLayouts.userId, args.userId),
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
}): Promise<void> {
  await db
    .insert(blockLayouts)
    .values({
      tenantId: args.tenantId,
      userId: args.userId,
      pageKey: args.pageKey,
      blocks: args.blocks,
      hiddenSections: args.hiddenSections ?? [],
    })
    .onConflictDoUpdate({
      target: [blockLayouts.tenantId, blockLayouts.userId, blockLayouts.pageKey],
      set: {
        blocks: args.blocks,
        hiddenSections: args.hiddenSections ?? [],
        updatedAt: new Date(),
      },
    });
}
