// PURPOSE: Per-user AI API credentials — позволяет пользователям подключать свои ключи
// вместо (или дополнительно к) tenant-level ключам администратора.
import { pgTable, uuid, text, boolean, timestamp, unique } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export const userAiCredentials = pgTable(
  'user_ai_credentials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Идентификатор провайдера.
     * 'deepseek' | 'qwen' | 'yandex' | 'gigachat' | 'openai' | 'anthropic' | 'openrouter' | 'vsegpt' | 'custom'
     */
    provider: text('provider').notNull(),
    /** Кастомный baseUrl (только для 'custom' провайдера) */
    baseUrl: text('base_url'),
    /**
     * API ключ. Plain text в MVP.
     * TODO production: AES-256-GCM / Vault / Doppler.
     */
    apiKey: text('api_key').notNull(),
    /** Дефолтная модель для этого провайдера (gpt-4o-mini, deepseek-chat, etc.) */
    defaultModel: text('default_model'),
    /** Маршрутизировать через tenant proxy (aiProxy) */
    useProxy: boolean('use_proxy').default(false).notNull(),
    /** Юзер явно включил «использовать мои ключи» для этого провайдера */
    enabled: boolean('enabled').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => ({
    uniqUserProvider: unique('user_ai_credentials_user_provider_uniq').on(
      t.userId,
      t.tenantId,
      t.provider,
    ),
  }),
);

export type UserAiCredential = typeof userAiCredentials.$inferSelect;
export type NewUserAiCredential = typeof userAiCredentials.$inferInsert;
