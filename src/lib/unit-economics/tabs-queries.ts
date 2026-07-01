// PURPOSE: CRUD queries для unit_economics_tabs + seed-логика дефолтов.
// Используется страницей /unit-economics и API роутами /api/unit-economics/tabs.

import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  unitEconomicsTabs,
  DEFAULT_UNIT_TABS,
  type UnitEconomicsTab,
} from '@/lib/db/schema/unit-economics-tabs';
import { blockLayouts } from '@/lib/db/schema/block-layouts';

export type TabRecord = {
  id: string;
  pageKey: string;
  label: string;
  icon: string | null;
  order: number;
  kind: 'default' | 'custom';
  defaultKey: string | null;
};

function toRecord(row: UnitEconomicsTab): TabRecord {
  return {
    id: row.id,
    pageKey: row.pageKey,
    label: row.label,
    icon: row.icon,
    order: row.order,
    kind: row.kind === 'default' ? 'default' : 'custom',
    defaultKey: row.defaultKey,
  };
}

/** Возвращает все НЕ-скрытые вкладки пользователя. Делает seed дефолтов
 * если у пользователя пока ничего не было. */
export async function listTabs(args: {
  tenantId: string;
  userId: string;
}): Promise<TabRecord[]> {
  const rows = await db
    .select()
    .from(unitEconomicsTabs)
    .where(
      and(
        eq(unitEconomicsTabs.tenantId, args.tenantId),
        eq(unitEconomicsTabs.userId, args.userId),
      ),
    )
    .orderBy(asc(unitEconomicsTabs.order));

  if (rows.length === 0) {
    // Seed дефолтов.
    await db.insert(unitEconomicsTabs).values(
      DEFAULT_UNIT_TABS.map((t) => ({
        tenantId: args.tenantId,
        userId: args.userId,
        pageKey: t.pageKey,
        label: t.label,
        icon: t.icon,
        order: t.order,
        kind: 'default' as const,
        defaultKey: t.defaultKey,
      })),
    );
    const seeded = await db
      .select()
      .from(unitEconomicsTabs)
      .where(
        and(
          eq(unitEconomicsTabs.tenantId, args.tenantId),
          eq(unitEconomicsTabs.userId, args.userId),
        ),
      )
      .orderBy(asc(unitEconomicsTabs.order));
    return seeded.filter((r) => !r.hidden).map(toRecord);
  }

  return rows.filter((r) => !r.hidden).map(toRecord);
}

/** Создаёт custom-вкладку. cloneFromPageKey — если задан, копирует layout
 * из указанной страницы в новую. */
export async function createTab(args: {
  tenantId: string;
  userId: string;
  label: string;
  icon?: string | null;
  cloneFromPageKey?: string;
}): Promise<TabRecord> {
  const newPageKey = `unit-economics-custom-${nanoid8()}`;

  // Определяем порядок: после самой большой order.
  const existing = await db
    .select({ order: unitEconomicsTabs.order })
    .from(unitEconomicsTabs)
    .where(
      and(
        eq(unitEconomicsTabs.tenantId, args.tenantId),
        eq(unitEconomicsTabs.userId, args.userId),
      ),
    );
  const maxOrder = existing.reduce((m, r) => Math.max(m, r.order), -1);

  const [row] = await db
    .insert(unitEconomicsTabs)
    .values({
      tenantId: args.tenantId,
      userId: args.userId,
      pageKey: newPageKey,
      label: args.label,
      icon: args.icon ?? null,
      order: maxOrder + 1,
      kind: 'custom',
      defaultKey: null,
    })
    .returning();

  // Clone layout если попросили.
  if (args.cloneFromPageKey) {
    const [src] = await db
      .select()
      .from(blockLayouts)
      .where(
        and(
          eq(blockLayouts.tenantId, args.tenantId),
          eq(blockLayouts.userId, args.userId),
          eq(blockLayouts.pageKey, args.cloneFromPageKey),
        ),
      )
      .limit(1);
    if (src) {
      await db.insert(blockLayouts).values({
        tenantId: args.tenantId,
        userId: args.userId,
        pageKey: newPageKey,
        blocks: src.blocks,
        hiddenSections: src.hiddenSections,
      });
    }
  }

  return toRecord(row);
}

export async function renameTab(args: {
  tenantId: string;
  userId: string;
  id: string;
  label: string;
  icon?: string | null;
}): Promise<TabRecord | null> {
  const [row] = await db
    .update(unitEconomicsTabs)
    .set({
      label: args.label,
      ...(args.icon !== undefined ? { icon: args.icon } : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(unitEconomicsTabs.tenantId, args.tenantId),
        eq(unitEconomicsTabs.userId, args.userId),
        eq(unitEconomicsTabs.id, args.id),
      ),
    )
    .returning();
  return row ? toRecord(row) : null;
}

export async function reorderTabs(args: {
  tenantId: string;
  userId: string;
  orderedIds: string[];
}): Promise<void> {
  for (let i = 0; i < args.orderedIds.length; i++) {
    await db
      .update(unitEconomicsTabs)
      .set({ order: i, updatedAt: new Date() })
      .where(
        and(
          eq(unitEconomicsTabs.tenantId, args.tenantId),
          eq(unitEconomicsTabs.userId, args.userId),
          eq(unitEconomicsTabs.id, args.orderedIds[i]),
        ),
      );
  }
}

/** Soft-delete для default, hard-delete для custom (cascade чистит block_layouts). */
export async function deleteTab(args: {
  tenantId: string;
  userId: string;
  id: string;
}): Promise<{ deleted: boolean; kind: 'default' | 'custom' | null }> {
  const [tab] = await db
    .select()
    .from(unitEconomicsTabs)
    .where(
      and(
        eq(unitEconomicsTabs.tenantId, args.tenantId),
        eq(unitEconomicsTabs.userId, args.userId),
        eq(unitEconomicsTabs.id, args.id),
      ),
    )
    .limit(1);
  if (!tab) return { deleted: false, kind: null };

  if (tab.kind === 'default') {
    await db
      .update(unitEconomicsTabs)
      .set({ hidden: true, updatedAt: new Date() })
      .where(
        and(
          eq(unitEconomicsTabs.tenantId, args.tenantId),
          eq(unitEconomicsTabs.userId, args.userId),
          eq(unitEconomicsTabs.id, args.id),
        ),
      );
    return { deleted: true, kind: 'default' };
  }

  // Custom: чистим layout + сам tab.
  await db
    .delete(blockLayouts)
    .where(
      and(
        eq(blockLayouts.tenantId, args.tenantId),
        eq(blockLayouts.userId, args.userId),
        eq(blockLayouts.pageKey, tab.pageKey),
      ),
    );
  // Defence-in-depth (H1): финальный delete тоже скоупим по tenant/user, а не только по id.
  await db
    .delete(unitEconomicsTabs)
    .where(
      and(
        eq(unitEconomicsTabs.tenantId, args.tenantId),
        eq(unitEconomicsTabs.userId, args.userId),
        eq(unitEconomicsTabs.id, args.id),
      ),
    );
  return { deleted: true, kind: 'custom' };
}

/** nanoid из 8 символов (a-z0-9). Без внешней зависимости. */
function nanoid8(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}
