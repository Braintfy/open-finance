// PURPOSE: Хранилище ИИ-сгенерированных отчётов блока «Ozon · AI инсайты».
// История генераций per-user × block (лимит 10 на блок enforced в queries).
import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';
import type { Insight } from '@/lib/blocks/catalog/unit-ozon-ai-insights-types';

export const ozonAiInsightReports = pgTable(
  'ozon_ai_insight_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** ID экземпляра блока (BlockInstance.id) — история скоупится на блок. */
    blockId: varchar('block_id', { length: 64 }).notNull(),
    /** Ozon-аккаунт, по которому сгенерирован отчёт (для справки). */
    accountId: varchar('account_id', { length: 64 }),
    /** Снимок периода (formatPeriodKey) на момент генерации. */
    periodKey: varchar('period_key', { length: 64 }),
    /** Модель, которой сгенерирован отчёт. */
    model: varchar('model', { length: 120 }),
    /** Executive summary (2-4 предложения). */
    summary: text('summary').notNull().default(''),
    /** Список структурных инсайтов. */
    insights: jsonb('insights').$type<Insight[]>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('ozon_ai_insight_reports_block_idx').on(
      t.tenantId,
      t.userId,
      t.blockId,
      t.createdAt,
    ),
  ],
);

export type OzonAiInsightReport = typeof ozonAiInsightReports.$inferSelect;
export type NewOzonAiInsightReport = typeof ozonAiInsightReports.$inferInsert;
