// PURPOSE: Multi-tenant организации (рабочее пространство пользователя)
import { pgTable, uuid, text, timestamp, varchar, jsonb } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  plan: varchar('plan', { length: 50 }).notNull().default('free'),
  // 'free' | 'trial_pro' | 'pro' | 'business' | 'enterprise'
  trialEndsAt: timestamp('trial_ends_at'),
  taxMode: varchar('tax_mode', { length: 20 }),
  // 'usn_6' | 'usn_15' | 'nds_5' | 'nds_7' | 'nds_20' | 'psn' | 'npd' | 'ausn' | 'osno'
  settings: jsonb('settings').$type<TenantSettings>().default({}),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

export type TenantSettings = {
  theme?: 'light' | 'dark' | 'system';
  locale?: 'ru' | 'en';
  timezone?: string;
  aiProvider?: 'claude' | 'openai' | 'yandex' | 'gigachat' | 'ollama';
  aiTokenLimit?: number; // дневной лимит
  notifications?: {
    telegram?: boolean;
    email?: boolean;
    push?: boolean;
  };
};
