// PURPOSE: Персональные layout'ы страниц пользователя — какие блоки, в каком порядке/размере
import {
  pgTable,
  uuid,
  varchar,
  jsonb,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import type { BlockInstance } from '@/lib/blocks/types';

export const blockLayouts = pgTable(
  'block_layouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Ключ страницы: 'cashflow' | 'dashboard' | 'taxes' | ...
    pageKey: varchar('page_key', { length: 64 }).notNull(),
    // Массив блоков с координатами grid'а (x, y, w, h, config)
    blocks: jsonb('blocks').$type<BlockInstance[]>().notNull().default([]),
    // Скрытые системные секции (если есть стандартный набор виджетов которые можно отключить)
    hiddenSections: jsonb('hidden_sections')
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('block_layouts_tenant_user_page_idx').on(
      t.tenantId,
      t.userId,
      t.pageKey
    ),
  ],
);

export type BlockLayout = typeof blockLayouts.$inferSelect;
export type NewBlockLayout = typeof blockLayouts.$inferInsert;
