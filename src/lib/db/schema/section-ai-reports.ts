// PURPOSE: Хранилище ИИ-отчётов «AI Анализ раздела». История скоупится на
// раздел (tenant × user × pageKey), лимит 10 на раздел (enforced в queries).
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
import { workspaces } from './workspaces';
import type {
  SectionInsight,
  SectionReportMeta,
} from '@/lib/ai/section-insights';

export const sectionAiReports = pgTable(
  'section_ai_reports',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Воркспейс отчёта (изоляция AI-отчётов per-workspace). NULLABLE и БЕЗ
    // бэкфилла: новые отчёты пишутся с workspace_id активного кабинета, а
    // legacy-строки (NULL) видны ТОЛЬКО в default-кабинете —
    // см. workspaceScopeCondition() в src/lib/workspaces/queries.ts.
    workspaceId: uuid('workspace_id').references(() => workspaces.id, {
      onDelete: 'cascade',
    }),
    /** Ключ раздела (BlockGrid pageKey) — история скоупится на раздел. */
    pageKey: varchar('page_key', { length: 64 }).notNull(),
    /** Человекочитаемое название раздела на момент генерации. */
    pageLabel: varchar('page_label', { length: 120 }),
    /** Модель, которой сгенерирован отчёт. */
    model: varchar('model', { length: 120 }),
    /** Executive summary. */
    summary: text('summary').notNull().default(''),
    /** Список структурных инсайтов. */
    insights: jsonb('insights').$type<SectionInsight[]>().notNull().default([]),
    /** Метаданные генерации (tokens/chars/blocks). */
    meta: jsonb('meta').$type<SectionReportMeta>(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('section_ai_reports_page_idx').on(
      t.tenantId,
      t.userId,
      t.pageKey,
      t.createdAt,
    ),
  ],
);

export type SectionAiReport = typeof sectionAiReports.$inferSelect;
export type NewSectionAiReport = typeof sectionAiReports.$inferInsert;
