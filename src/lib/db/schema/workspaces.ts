// PURPOSE: Именованные воркспейсы («кабинеты») — контейнер персональных
// раскладок страниц (block_layouts.workspace_id) и вкладок юнит-экономики
// (unit_economics_tabs.workspace_id) per-workspace. Один пользователь может
// держать много кабинетов (вариант В из LK_V2_PLAN.md Этап 3).
//
// Скоуп версионирования:
//   - block_layouts (раскладки страниц) — раздельные per-workspace;
//   - unit_economics_tabs — per-workspace (workspace_id NOT NULL с миграции 0011);
//   - block_ai_reports / section_ai_reports — nullable workspace_id (изоляция);
//   - boards и 'nav' (сайдбар) — ОБЩИЕ между кабинетами (физически живут под
//     default-воркспейсом, резолвятся через getOrCreateDefaultWorkspace).
//
// Активный воркспейс персистится в users.settings.activeWorkspaceId
// + httpOnly-кука 'of_active_workspace' (резолв — src/lib/workspaces/active.ts). Default-кабинет пары (tenant,user) —
// is_default=true, slug='workspace-1', создаётся бэкфиллом миграции или лениво
// через getOrCreateDefaultWorkspace() на read-пути.

import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Отображаемое имя кабинета (например «Кабинет 1», «Ozon основной»). */
    name: varchar('name', { length: 120 }).notNull(),
    /** Стабильный slug для ссылок/URL, уникален в рамках (tenant,user). */
    slug: varchar('slug', { length: 140 }).notNull(),
    /** Шаблон стартового наполнения: 'seller-ozon' | 'blank' (WORKSPACE_TEMPLATES). */
    template: varchar('template', { length: 32 }).notNull().default('seller-ozon'),
    /** Дефолтный кабинет пары (tenant,user). Ровно один — enforced в queries. */
    isDefault: boolean('is_default').notNull().default(false),
    /** Порядок в переключателе кабинетов. */
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex('workspaces_tenant_user_slug_idx').on(
      t.tenantId,
      t.userId,
      t.slug,
    ),
  ],
);

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;
