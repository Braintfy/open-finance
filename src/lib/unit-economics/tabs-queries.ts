// PURPOSE: CRUD queries для unit_economics_tabs + seed-логика дефолтов.
// Используется страницей /unit-economics и API роутами /api/unit-economics/tabs.
//
// Воркспейсы (Этап 3): вкладки скоупятся на АКТИВНЫЙ кабинет — у каждого свой
// набор вкладок и свои раскладки. Скоуп резолвится вызывающим кодом
// (getActiveWorkspacePageScope) и передаётся сюда параметром `workspace`.
// Без него — фолбэк на default-кабинет (обратная совместимость).
// Legacy-строки с workspace_id IS NULL (до миграций 0010/0011) видны только в
// default-кабинете — см. workspaceScopeCondition.

import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  unitEconomicsTabs,
  DEFAULT_UNIT_TABS,
  type UnitEconomicsTab,
} from '@/lib/db/schema/unit-economics-tabs';
import { blockLayouts } from '@/lib/db/schema/block-layouts';
import {
  getOrCreateDefaultWorkspace,
  workspaceScopeCondition,
} from '@/lib/workspaces/queries';
import type { PageWorkspaceScope } from '@/lib/workspaces/scope';

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

/** Резолвит скоуп кабинета: явный аргумент или DEFAULT-кабинет пары (tenant,user). */
async function resolveScope(args: {
  tenantId: string;
  userId: string;
  workspace?: PageWorkspaceScope;
}): Promise<PageWorkspaceScope> {
  if (args.workspace) return args.workspace;
  const def = await getOrCreateDefaultWorkspace(args.tenantId, args.userId);
  return { workspaceId: def.id, template: def.template, includeLegacy: true };
}

/** Возвращает все НЕ-скрытые вкладки кабинета. Делает seed дефолтов
 * если в этом кабинете пока ничего не было. */
export async function listTabs(args: {
  tenantId: string;
  userId: string;
  workspace?: PageWorkspaceScope;
}): Promise<TabRecord[]> {
  const scope = await resolveScope(args);
  const scoped = and(
    eq(unitEconomicsTabs.tenantId, args.tenantId),
    eq(unitEconomicsTabs.userId, args.userId),
    workspaceScopeCondition(unitEconomicsTabs.workspaceId, scope),
  );

  const rows = await db
    .select()
    .from(unitEconomicsTabs)
    .where(scoped)
    .orderBy(asc(unitEconomicsTabs.order));

  if (rows.length === 0) {
    // Seed дефолтов в текущем кабинете.
    await db.insert(unitEconomicsTabs).values(
      DEFAULT_UNIT_TABS.map((t) => ({
        tenantId: args.tenantId,
        userId: args.userId,
        workspaceId: scope.workspaceId,
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
      .where(scoped)
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
  workspace?: PageWorkspaceScope;
}): Promise<TabRecord> {
  const newPageKey = `unit-economics-custom-${nanoid8()}`;
  const scope = await resolveScope(args);

  // Определяем порядок: после самой большой order в этом кабинете.
  const existing = await db
    .select({ order: unitEconomicsTabs.order })
    .from(unitEconomicsTabs)
    .where(
      and(
        eq(unitEconomicsTabs.tenantId, args.tenantId),
        eq(unitEconomicsTabs.userId, args.userId),
        workspaceScopeCondition(unitEconomicsTabs.workspaceId, scope),
      ),
    );
  const maxOrder = existing.reduce((m, r) => Math.max(m, r.order), -1);

  const [row] = await db
    .insert(unitEconomicsTabs)
    .values({
      tenantId: args.tenantId,
      userId: args.userId,
      workspaceId: scope.workspaceId,
      pageKey: newPageKey,
      label: args.label,
      icon: args.icon ?? null,
      order: maxOrder + 1,
      kind: 'custom',
      defaultKey: null,
    })
    .returning();

  // Clone layout если попросили — источник и копия в ОДНОМ кабинете
  // (cross-workspace клонирование вкладок запрещено, как и @-ссылки).
  if (args.cloneFromPageKey) {
    const wsId = scope.workspaceId;
    const [src] = await db
      .select()
      .from(blockLayouts)
      .where(
        and(
          eq(blockLayouts.tenantId, args.tenantId),
          eq(blockLayouts.userId, args.userId),
          eq(blockLayouts.workspaceId, wsId),
          eq(blockLayouts.pageKey, args.cloneFromPageKey),
        ),
      )
      .limit(1);
    if (src) {
      await db.insert(blockLayouts).values({
        tenantId: args.tenantId,
        userId: args.userId,
        workspaceId: wsId,
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
  workspace?: PageWorkspaceScope;
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

  const scope = await resolveScope(args);
  // Изоляция кабинетов: вкладку чужого кабинета не удаляем (legacy NULL —
  // считается принадлежащей default-кабинету, см. includeLegacy).
  const tabWorkspaceId = tab.workspaceId ?? null;
  const belongsToScope =
    tabWorkspaceId === scope.workspaceId ||
    (tabWorkspaceId === null && scope.includeLegacy);
  if (!belongsToScope) return { deleted: false, kind: null };

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

  // Custom: чистим layout (только в кабинете вкладки) + сам tab.
  await db
    .delete(blockLayouts)
    .where(
      and(
        eq(blockLayouts.tenantId, args.tenantId),
        eq(blockLayouts.userId, args.userId),
        eq(blockLayouts.workspaceId, tabWorkspaceId ?? scope.workspaceId),
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
