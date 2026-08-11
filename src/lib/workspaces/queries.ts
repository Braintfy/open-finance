// PURPOSE: CRUD + резолв воркспейсов («кабинетов») — Этап 3 LK_V2_PLAN.md.
// Воркспейс = контейнер персональных раскладок (block_layouts.workspace_id).
// Активный воркспейс персистится в users.settings.activeWorkspaceId.
//
// Все запросы скоупятся по (tenantId, userId) — multi-tenant инвариант.
// getOrCreateDefaultWorkspace вызывается на read-пути (loadLayout/saveLayout),
// поэтому создание default-кабинета «ленивое» для пользователей без раскладок.

import { and, asc, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db } from '@/lib/db/client';
import { workspaces, type Workspace } from '@/lib/db/schema/workspaces';
import { blockLayouts } from '@/lib/db/schema/block-layouts';
import { unitEconomicsTabs } from '@/lib/db/schema/unit-economics-tabs';
import { users } from '@/lib/db/schema/users';
import { isSharedPageKey, isUuid, type PageWorkspaceScope } from './scope';

export type WorkspaceRecord = {
  id: string;
  name: string;
  slug: string;
  template: string;
  isDefault: boolean;
  sortOrder: number;
};

function toRecord(row: Workspace): WorkspaceRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    template: row.template,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
  };
}

const DEFAULT_SLUG = 'workspace-1';
const DEFAULT_NAME = 'Кабинет 1';
const DEFAULT_TEMPLATE = 'seller-ozon';

/**
 * Возвращает default-воркспейс пары (tenant,user), создавая «Кабинет 1» если у
 * пользователя ещё нет ни одного кабинета. Идемпотентно при гонке
 * (onConflictDoNothing по уникальному (tenant,user,slug) + повторный select).
 */
export async function getOrCreateDefaultWorkspace(
  tenantId: string,
  userId: string,
): Promise<WorkspaceRecord> {
  const existing = await pickPrimary(tenantId, userId);
  if (existing) return toRecord(existing);

  await db
    .insert(workspaces)
    .values({
      tenantId,
      userId,
      name: DEFAULT_NAME,
      slug: DEFAULT_SLUG,
      template: DEFAULT_TEMPLATE,
      isDefault: true,
      sortOrder: 0,
    })
    .onConflictDoNothing({
      target: [workspaces.tenantId, workspaces.userId, workspaces.slug],
    });

  const created = await pickPrimary(tenantId, userId);
  if (!created) {
    // Практически недостижимо (insert+select в одном пуле), но не молчим.
    throw new Error('getOrCreateDefaultWorkspace: failed to create workspace');
  }
  return toRecord(created);
}

/** Первый воркспейс пары: default → минимальный sortOrder → старейший. */
async function pickPrimary(
  tenantId: string,
  userId: string,
): Promise<Workspace | undefined> {
  const [row] = await db
    .select()
    .from(workspaces)
    .where(and(eq(workspaces.tenantId, tenantId), eq(workspaces.userId, userId)))
    .orderBy(
      desc(workspaces.isDefault),
      asc(workspaces.sortOrder),
      asc(workspaces.createdAt),
    )
    .limit(1);
  return row;
}

/** Кабинет по id, строго в рамках пары (tenant,user). Невалидный uuid → null. */
export async function getWorkspaceById(args: {
  tenantId: string;
  userId: string;
  id: string;
}): Promise<WorkspaceRecord | null> {
  if (!isUuid(args.id)) return null;
  const [row] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, args.id),
        eq(workspaces.tenantId, args.tenantId),
        eq(workspaces.userId, args.userId),
      ),
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

/**
 * SQL-условие «строка принадлежит кабинету scope». В default-кабинете
 * дополнительно видны legacy-строки с workspace_id IS NULL (AI-отчёты/вкладки
 * до миграций 0010/0011). scope=undefined → без фильтра (обратная совместимость).
 */
export function workspaceScopeCondition(
  column: AnyPgColumn,
  scope?: Pick<PageWorkspaceScope, 'workspaceId' | 'includeLegacy'>,
): SQL | undefined {
  if (!scope) return undefined;
  if (scope.includeLegacy) {
    return or(eq(column, scope.workspaceId), isNull(column));
  }
  return eq(column, scope.workspaceId);
}

/** Все кабинеты пользователя в порядке отображения. Пусто → создаёт default. */
export async function listWorkspaces(args: {
  tenantId: string;
  userId: string;
}): Promise<WorkspaceRecord[]> {
  const rows = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.tenantId, args.tenantId),
        eq(workspaces.userId, args.userId),
      ),
    )
    .orderBy(asc(workspaces.sortOrder), asc(workspaces.createdAt));

  if (rows.length === 0) {
    const def = await getOrCreateDefaultWorkspace(args.tenantId, args.userId);
    return [def];
  }
  return rows.map(toRecord);
}

/**
 * Создаёт новый (не-default) кабинет. cloneFromWorkspaceId — если задан и
 * принадлежит паре (tenant,user), копирует ВСЕ раскладки block_layouts
 * исходного воркспейса в новый (по образцу createTab({cloneFromPageKey})).
 */
export async function createWorkspace(args: {
  tenantId: string;
  userId: string;
  name: string;
  template?: string;
  cloneFromWorkspaceId?: string;
}): Promise<WorkspaceRecord> {
  const slug = await uniqueSlug(args.tenantId, args.userId, args.name);

  const existing = await db
    .select({ sortOrder: workspaces.sortOrder })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.tenantId, args.tenantId),
        eq(workspaces.userId, args.userId),
      ),
    );
  const maxOrder = existing.reduce((m, r) => Math.max(m, r.sortOrder), -1);

  const [row] = await db
    .insert(workspaces)
    .values({
      tenantId: args.tenantId,
      userId: args.userId,
      name: args.name,
      slug,
      template: args.template ?? DEFAULT_TEMPLATE,
      isDefault: false,
      sortOrder: maxOrder + 1,
    })
    .returning();

  if (args.cloneFromWorkspaceId) {
    // Валидируем принадлежность источника паре (tenant,user).
    const [src] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, args.cloneFromWorkspaceId),
          eq(workspaces.tenantId, args.tenantId),
          eq(workspaces.userId, args.userId),
        ),
      )
      .limit(1);
    if (src) {
      const srcLayouts = await db
        .select()
        .from(blockLayouts)
        .where(
          and(
            eq(blockLayouts.tenantId, args.tenantId),
            eq(blockLayouts.userId, args.userId),
            eq(blockLayouts.workspaceId, args.cloneFromWorkspaceId),
          ),
        );
      // ОБЩИЕ раскладки ('nav' = сайдбар, 'board-*' = доски) не клонируем:
      // они всегда читаются из default-кабинета (isSharedPageKey), копия была бы
      // мёртвыми строками. Клонируем только страничные раскладки.
      const cloneable = srcLayouts.filter((l) => !isSharedPageKey(l.pageKey));
      if (cloneable.length > 0) {
        await db.insert(blockLayouts).values(
          cloneable.map((l) => ({
            tenantId: args.tenantId,
            userId: args.userId,
            workspaceId: row.id,
            pageKey: l.pageKey,
            blocks: l.blocks,
            hiddenSections: l.hiddenSections,
          })),
        );
      }

      // Вкладки юнит-экономики тоже per-workspace: без их клонирования
      // скопированные страницы 'unit-economics-custom-*' были бы недостижимы
      // (listTabs засидил бы 4 дефолта заново). Строки берём строго по
      // workspace_id источника (после миграции 0011 колонка NOT NULL).
      const srcTabs = await db
        .select()
        .from(unitEconomicsTabs)
        .where(
          and(
            eq(unitEconomicsTabs.tenantId, args.tenantId),
            eq(unitEconomicsTabs.userId, args.userId),
            eq(unitEconomicsTabs.workspaceId, args.cloneFromWorkspaceId),
          ),
        );
      if (srcTabs.length > 0) {
        await db.insert(unitEconomicsTabs).values(
          srcTabs.map((t) => ({
            tenantId: args.tenantId,
            userId: args.userId,
            workspaceId: row.id,
            pageKey: t.pageKey,
            label: t.label,
            icon: t.icon,
            order: t.order,
            kind: t.kind,
            defaultKey: t.defaultKey,
            hidden: t.hidden,
          })),
        );
      }
    }
  }

  return toRecord(row);
}

/** Переименовать кабинет (slug стабилен — ссылки не ломаем). */
export async function renameWorkspace(args: {
  tenantId: string;
  userId: string;
  id: string;
  name: string;
}): Promise<WorkspaceRecord | null> {
  const [row] = await db
    .update(workspaces)
    .set({ name: args.name, updatedAt: new Date() })
    .where(
      and(
        eq(workspaces.tenantId, args.tenantId),
        eq(workspaces.userId, args.userId),
        eq(workspaces.id, args.id),
      ),
    )
    .returning();
  return row ? toRecord(row) : null;
}

export type DeleteWorkspaceResult = {
  deleted: boolean;
  reason?: 'not_found' | 'last' | 'is_default';
};

/**
 * Удалить кабинет. Запрещено удалять последний и default (нужно сперва назначить
 * другой default — переназначение делает следующий шаг/UI). Cascade чистит
 * block_layouts удаляемого воркспейса. Если удаляемый был активным —
 * сбрасываем users.settings.activeWorkspaceId (фолбэк на default при резолве).
 */
export async function deleteWorkspace(args: {
  tenantId: string;
  userId: string;
  id: string;
}): Promise<DeleteWorkspaceResult> {
  const [target] = await db
    .select()
    .from(workspaces)
    .where(
      and(
        eq(workspaces.tenantId, args.tenantId),
        eq(workspaces.userId, args.userId),
        eq(workspaces.id, args.id),
      ),
    )
    .limit(1);
  if (!target) return { deleted: false, reason: 'not_found' };

  const all = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.tenantId, args.tenantId),
        eq(workspaces.userId, args.userId),
      ),
    );
  if (all.length <= 1) return { deleted: false, reason: 'last' };
  if (target.isDefault) return { deleted: false, reason: 'is_default' };

  await db
    .delete(workspaces)
    .where(
      and(
        eq(workspaces.tenantId, args.tenantId),
        eq(workspaces.userId, args.userId),
        eq(workspaces.id, args.id),
      ),
    );

  // Сбросить активный, если указывал на удалённый кабинет.
  await db
    .update(users)
    .set({
      settings: sql`COALESCE(${users.settings}, '{}'::jsonb) - 'activeWorkspaceId'`,
    })
    .where(
      and(
        eq(users.id, args.userId),
        sql`${users.settings}->>'activeWorkspaceId' = ${args.id}`,
      ),
    );

  return { deleted: true };
}

/**
 * Записать активный воркспейс в users.settings.activeWorkspaceId (JSONB merge).
 * Возвращает false, если воркспейс не принадлежит паре (tenant,user).
 */
export async function setActiveWorkspace(args: {
  tenantId: string;
  userId: string;
  workspaceId: string;
}): Promise<boolean> {
  const [ws] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.id, args.workspaceId),
        eq(workspaces.tenantId, args.tenantId),
        eq(workspaces.userId, args.userId),
      ),
    )
    .limit(1);
  if (!ws) return false;

  // JSON.stringify обязателен (защита от инжектов) — см. drizzle.mdc JSONB merge.
  const patch = JSON.stringify({ activeWorkspaceId: args.workspaceId });
  await db
    .update(users)
    .set({
      settings: sql`COALESCE(${users.settings}, '{}'::jsonb) || ${patch}::jsonb`,
    })
    .where(eq(users.id, args.userId));
  return true;
}

/**
 * Резолвит активный воркспейс: читает users.settings.activeWorkspaceId,
 * валидирует принадлежность паре (tenant,user), иначе фолбэк на default.
 */
export async function resolveActiveWorkspace(
  tenantId: string,
  userId: string,
): Promise<WorkspaceRecord> {
  const [u] = await db
    .select({ settings: users.settings })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const activeId = u?.settings?.activeWorkspaceId;
  if (activeId) {
    const [ws] = await db
      .select()
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, activeId),
          eq(workspaces.tenantId, tenantId),
          eq(workspaces.userId, userId),
        ),
      )
      .limit(1);
    if (ws) return toRecord(ws);
  }
  return getOrCreateDefaultWorkspace(tenantId, userId);
}

/** slug из имени, уникальный в рамках (tenant,user). Кириллица → фолбэк 'workspace'. */
async function uniqueSlug(
  tenantId: string,
  userId: string,
  name: string,
): Promise<string> {
  const base = slugify(name);
  const rows = await db
    .select({ slug: workspaces.slug })
    .from(workspaces)
    .where(and(eq(workspaces.tenantId, tenantId), eq(workspaces.userId, userId)));
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${nanoid8()}`;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return base || 'workspace';
}

/** nanoid из 8 символов (a-z0-9). Без внешней зависимости (как в tabs-queries). */
function nanoid8(): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  for (let i = 0; i < 8; i++) {
    s += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return s;
}
