// PURPOSE: Cross-cutting слой дедлайнов (на любом блоке/транзакции/документе)
import { pgTable, uuid, text, timestamp, varchar, jsonb, integer, boolean, index } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const deadlines = pgTable(
  'deadlines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 300 }).notNull(),
    description: text('description'),
    dueAt: timestamp('due_at').notNull(),
    completedAt: timestamp('completed_at'),
    // К чему относится дедлайн (полиморфная ссылка)
    targetType: varchar('target_type', { length: 50 }).notNull(),
    // 'block' | 'transaction' | 'tax' | 'supply' | 'order' | 'task' | 'document' | 'subscription' | 'goal'
    targetId: uuid('target_id'),
    priority: varchar('priority', { length: 20 }).notNull().default('medium'),
    // 'low' | 'medium' | 'high' | 'urgent'
    recurrence: jsonb('recurrence').$type<RecurrenceRule>(), // для повторяющихся (налоги, подписки)
    reminders: jsonb('reminders').$type<ReminderConfig>().notNull().default({}),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('deadlines_tenant_due_idx').on(t.tenantId, t.dueAt),
    index('deadlines_target_idx').on(t.targetType, t.targetId),
  ],
);

export type Deadline = typeof deadlines.$inferSelect;
export type NewDeadline = typeof deadlines.$inferInsert;

export type RecurrenceRule = {
  freq: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  interval?: number;
  endsAt?: string;
};

export type ReminderConfig = {
  daysBefore?: number[]; // [30, 14, 7, 3, 1]
  channels?: ('inapp' | 'telegram' | 'email' | 'push')[];
};
