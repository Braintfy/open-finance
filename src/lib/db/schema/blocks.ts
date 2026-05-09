// PURPOSE: Универсальные блоки модульного конструктора (Excel-like, charts, text)
import { pgTable, uuid, text, timestamp, varchar, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const blocks = pgTable(
  'blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    // 'spreadsheet' | 'chart' | 'text' | 'kpi' | 'list' | 'calendar' | 'form'
    title: varchar('title', { length: 200 }),
    parentId: uuid('parent_id'), // вложенные блоки (например, страница с блоками)
    moduleSlug: varchar('module_slug', { length: 50 }),
    // 'cashflow' | 'taxes' | 'supply' | 'orders' | 'planner' | 'custom'
    position: integer('position').notNull().default(0),
    config: jsonb('config').$type<BlockConfig>().notNull().default({}),
    data: jsonb('data'), // инлайн данные для spreadsheet, etc.
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('blocks_tenant_module_idx').on(t.tenantId, t.moduleSlug),
    index('blocks_parent_idx').on(t.parentId, t.position),
  ],
);

export type Block = typeof blocks.$inferSelect;
export type NewBlock = typeof blocks.$inferInsert;

export type BlockConfig = Record<string, unknown> & {
  width?: 'sm' | 'md' | 'lg' | 'full';
  formula?: string;
  refs?: string[]; // ссылки на другие блоки/модули (@module.field)
};
