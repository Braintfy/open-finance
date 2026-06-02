// PURPOSE: Хранилище ИИ-отчётов «AI Анализ блока» (точечный анализ одного блока).
// История скоупится на блок (tenant × user × pageKey × blockId), лимит 10 на
// блок (enforced в queries). Зеркалит section_ai_reports + ключ blockId.
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
import type {
  SectionInsight,
  SectionReportMeta,
} from '@/lib/ai/section-insights';

export const blockAiReports = pgTable(
  'block_ai_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Ключ раздела (BlockGrid pageKey). */
    pageKey: varchar('page_key', { length: 64 }).notNull(),
    /** ID блока (BlockInstance.id) — история скоупится на блок. */
    blockId: varchar('block_id', { length: 64 }).notNull(),
    /** Тип блока на момент генерации. */
    blockType: varchar('block_type', { length: 80 }),
    /** Заголовок блока на момент генерации. */
    blockTitle: varchar('block_title', { length: 200 }),
    /** Модель, которой сгенерирован отчёт. */
    model: varchar('model', { length: 120 }),
    /** Executive summary. */
    summary: text('summary').notNull().default(''),
    /** Список структурных инсайтов. */
    insights: jsonb('insights').$type<SectionInsight[]>().notNull().default([]),
    /** Метаданные генерации (tokens/chars). */
    meta: jsonb('meta').$type<SectionReportMeta>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('block_ai_reports_block_idx').on(
      t.tenantId,
      t.userId,
      t.pageKey,
      t.blockId,
      t.createdAt,
    ),
  ],
);

export type BlockAiReport = typeof blockAiReports.$inferSelect;
export type NewBlockAiReport = typeof blockAiReports.$inferInsert;
