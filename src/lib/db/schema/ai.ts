// PURPOSE: AI infrastructure — память (RAG), счётчик токенов, audit log, агенты
import {
  pgTable,
  uuid,
  text,
  timestamp,
  varchar,
  integer,
  jsonb,
  boolean,
  vector,
  index,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

// === RAG-память: семантический поиск через pgvector ===
export const memoryChunks = pgTable(
  'memory_chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 50 }).notNull(),
    // 'transaction' | 'block' | 'document' | 'inbox' | 'chat' | 'communication'
    sourceId: uuid('source_id'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }), // text-embedding-3-small
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('memory_tenant_idx').on(t.tenantId),
    index('memory_source_idx').on(t.source, t.sourceId),
    // HNSW индекс будет создан вручную в миграции (drizzle-kit пока не поддерживает)
  ],
);

// === Счётчик токенов AI ===
export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id'),
    provider: varchar('provider', { length: 30 }).notNull(),
    // 'claude' | 'openai' | 'yandex' | 'gigachat' | 'ollama'
    model: varchar('model', { length: 100 }).notNull(),
    promptTokens: integer('prompt_tokens').notNull(),
    completionTokens: integer('completion_tokens').notNull(),
    totalCostCents: integer('total_cost_cents').notNull().default(0),
    purpose: varchar('purpose', { length: 50 }),
    // 'chat' | 'embed' | 'classify' | 'forecast' | 'agent'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('ai_usage_tenant_created_idx').on(t.tenantId, t.createdAt)],
);

// === AI Audit log: всё что AI сделал (для отката и прозрачности) ===
export const aiAuditLog = pgTable(
  'ai_audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id'),
    toolName: varchar('tool_name', { length: 100 }).notNull(),
    args: jsonb('args').notNull(),
    result: jsonb('result'),
    targetType: varchar('target_type', { length: 50 }),
    targetId: uuid('target_id'),
    inverseAction: jsonb('inverse_action'), // для отката
    revertedAt: timestamp('reverted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('audit_tenant_created_idx').on(t.tenantId, t.createdAt)],
);

// === AI агенты пользователя (Phase 2) ===
export const aiAgents = pgTable(
  'ai_agents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    skills: jsonb('skills').$type<string[]>().notNull().default([]),
    schedule: varchar('schedule', { length: 50 }), // cron-like 'daily' | 'weekly'
    enabled: boolean('enabled').notNull().default(true),
    config: jsonb('config'),
    lastRunAt: timestamp('last_run_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [index('agents_tenant_idx').on(t.tenantId)],
);

export type MemoryChunk = typeof memoryChunks.$inferSelect;
export type NewMemoryChunk = typeof memoryChunks.$inferInsert;
export type AiUsage = typeof aiUsage.$inferSelect;
export type AiAuditLog = typeof aiAuditLog.$inferSelect;
export type AiAgent = typeof aiAgents.$inferSelect;
