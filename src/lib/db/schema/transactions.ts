// PURPOSE: Финансовые транзакции (доходы/расходы)
import { pgTable, uuid, text, timestamp, varchar, integer, jsonb, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: varchar('name', { length: 100 }).notNull(),
    type: varchar('type', { length: 20 }).notNull(), // 'income' | 'expense'
    icon: varchar('icon', { length: 50 }),
    color: varchar('color', { length: 20 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('categories_tenant_idx').on(t.tenantId)],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => categories.id),
    amount: integer('amount').notNull(), // в копейках (для точности)
    currency: varchar('currency', { length: 3 }).notNull().default('RUB'),
    type: varchar('type', { length: 20 }).notNull(), // 'income' | 'expense'
    description: text('description'),
    counterparty: varchar('counterparty', { length: 200 }),
    source: varchar('source', { length: 50 }), // 'manual' | 'ozon' | 'wb' | 'bank' | 'inbox'
    sourceRef: varchar('source_ref', { length: 200 }),
    metadata: jsonb('metadata'),
    occurredAt: timestamp('occurred_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('tx_tenant_occurred_idx').on(t.tenantId, t.occurredAt),
    index('tx_tenant_category_idx').on(t.tenantId, t.categoryId),
    index('tx_source_idx').on(t.source, t.sourceRef),
  ],
);

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type Category = typeof categories.$inferSelect;
