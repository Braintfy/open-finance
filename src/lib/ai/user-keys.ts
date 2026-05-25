// PURPOSE: Резолвер активного AI-провайдера: per-user keys → tenant admin keys → нет ключа.
// Используется в /api/ai/chat и /api/ai/analyze-section перед выбором клиента.

import { db } from '@/lib/db/client';
import { userAiCredentials } from '@/lib/db/schema/user-ai-credentials';
import { and, eq } from 'drizzle-orm';
import type { TenantSettings } from '@/lib/db/schema/tenants';

export type ResolvedCredentials = {
  /** Источник ключей */
  source: 'user' | 'tenant' | 'none';
  /** Полный идентификатор провайдера */
  provider: string;
  baseUrl: string;
  apiKey: string;
  defaultModel: string;
  useProxy: boolean;
  /** Это enabled-провайдер, готов к использованию */
  enabled: boolean;
};

/**
 * Замаскировать API ключ для безопасного показа в UI.
 * "sk-abc...xyz123" → "sk-a••••x123"
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••' + key.slice(-4);
}

/**
 * Определить активные credentials для AI-вызова.
 *
 * Приоритет:
 * 1. user_ai_credentials с enabled=true (personal user key) — только если явно включён.
 * 2. tenants.settings.aiExternal (admin key) — если включён.
 * 3. { source: 'none' } — нет конфигурации, fallback на Ollama.
 *
 * @param userId - текущий пользователь
 * @param tenantId - текущий тенант
 * @param tenantSettings - JSONB settings тенанта (уже загружены)
 * @param preferredProvider - если задан, ищем именно этот провайдер
 */
export async function getActiveCredentials(
  userId: string,
  tenantId: string,
  tenantSettings: TenantSettings | null | undefined,
  preferredProvider?: string,
): Promise<ResolvedCredentials> {
  // 1. Ищем user-level enabled key
  try {
    const whereConditions = [
      eq(userAiCredentials.userId, userId),
      eq(userAiCredentials.tenantId, tenantId),
      eq(userAiCredentials.enabled, true),
    ];
    if (preferredProvider) {
      whereConditions.push(eq(userAiCredentials.provider, preferredProvider));
    }

    const userCreds = await db
      .select()
      .from(userAiCredentials)
      .where(and(...whereConditions))
      .limit(1);

    if (userCreds.length > 0) {
      const cred = userCreds[0];
      return {
        source: 'user',
        provider: cred.provider,
        baseUrl: cred.baseUrl ?? '',
        apiKey: cred.apiKey,
        defaultModel: cred.defaultModel ?? '',
        useProxy: cred.useProxy,
        enabled: true,
      };
    }
  } catch (e) {
    console.error('[user-keys] Failed to load user credentials', e);
  }

  // 2. Tenant admin key
  const ext = tenantSettings?.aiExternal;
  if (ext?.enabled && ext.apiKey && ext.baseUrl) {
    if (!preferredProvider || preferredProvider === ext.provider) {
      return {
        source: 'tenant',
        provider: ext.provider,
        baseUrl: ext.baseUrl,
        apiKey: ext.apiKey,
        defaultModel: ext.defaultModel ?? '',
        useProxy: ext.useProxy ?? false,
        enabled: true,
      };
    }
  }

  // 3. No external credentials — будет использован Ollama
  return {
    source: 'none',
    provider: 'ollama',
    baseUrl: '',
    apiKey: '',
    defaultModel: '',
    useProxy: false,
    enabled: false,
  };
}
