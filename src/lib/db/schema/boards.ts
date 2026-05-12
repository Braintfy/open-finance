// PURPOSE: Персональные доски пользователя — произвольные рабочие пространства с BlockGrid
import {
  pgTable,
  uuid,
  varchar,
  integer,
  boolean,
  timestamp,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const boards = pgTable('boards', {
  id: uuid('id').defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 200 }).notNull().default('Новая доска'),
  icon: varchar('icon', { length: 40 }),
  accentColor: varchar('accent_color', { length: 40 }),
  sortOrder: integer('sort_order').notNull().default(0),
  pinned: boolean('pinned').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Board = typeof boards.$inferSelect;
export type NewBoard = typeof boards.$inferInsert;
