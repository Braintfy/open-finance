// PURPOSE: Multi-tenant организации (рабочее пространство пользователя)
import { pgTable, uuid, timestamp, varchar, jsonb, boolean } from 'drizzle-orm/pg-core';

export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: varchar('name', { length: 200 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  plan: varchar('plan', { length: 50 }).notNull().default('free'),
  // 'free' | 'trial_pro' | 'pro' | 'business' | 'enterprise'
  trialEndsAt: timestamp('trial_ends_at'),
  taxMode: varchar('tax_mode', { length: 20 }),
  // Результат onboarding-визарда
  onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
  setupAnswers: jsonb('setup_answers').$type<SetupAnswers>(),
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
  aiProvider?: 'anthropic' | 'openai' | 'yandex' | 'gigachat' | 'ollama' | 'mock';
  aiModel?: string;
  aiTokenLimit?: number; // дневной лимит
  aiSystemPrompt?: string; // кастомный system prompt для всех AI вызовов tenant'а
  /**
   * Конфигурация внешнего OpenAI-совместимого провайдера.
   * ВНИМАНИЕ: apiKey хранится в JSONB plain-text. Доступ только super_admin.
   * В production переносить в Vault/Doppler.
   */
  aiExternal?: {
    enabled: boolean;
    provider: 'openai' | 'anthropic' | 'openrouter' | 'vsegpt' | 'custom';
    /** Например: https://api.openai.com/v1 — должен заканчиваться на /v1 */
    baseUrl: string;
    /** sk-... — для OpenAI / OpenRouter / VSEGPT / Anthropic / etc */
    apiKey: string;
    /** Дефолтная модель: gpt-4o-mini, claude-3-5-sonnet, etc */
    defaultModel: string;
    /** Через прокси (см. aiProxy) маршрутизировать вызовы? */
    useProxy?: boolean;
  };
  /**
   * Конфигурация HTTP/SOCKS5 прокси для обхода блокировок.
   * Используется для запросов к внешним AI API из РФ.
   */
  aiProxy?: {
    enabled: boolean;
    /** http://user:pass@host:port или socks5://user:pass@host:port */
    url: string;
    type: 'http' | 'https' | 'socks5';
    /** Логин (опционально, может быть в url) */
    username?: string;
    /** Пароль (опционально) */
    password?: string;
  };
  notifications?: {
    telegram?: boolean;
    email?: boolean;
    push?: boolean;
  };
  // Открытая регистрация в этот tenant (или по приглашениям)
  openRegistration?: boolean;
};

export type SetupAnswers = {
  occupation?:
    | 'marketplace_seller'
    | 'freelancer'
    | 'small_business'
    | 'self_employed'
    | 'personal'
    | 'other';
  taxMode?: string;
  trackingPriorities?: string[];
  dataSources?: string[];
  aiChannel?: 'web' | 'telegram' | 'email' | 'none';
  completedAt?: string; // ISO date
};
