// PURPOSE: Серверная обвязка VPN-роутов: гейт super_admin, чтение/запись
// tenants.settings.aiVpn, шифрование секретов, audit-log, UX-обвязка прокси.
// Импортируется ТОЛЬКО из /api/admin/ai/vpn/** (Node runtime).

import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { tenants, type TenantSettings } from '@/lib/db/schema/tenants';
import { userAiCredentials } from '@/lib/db/schema/user-ai-credentials';
import { aiAuditLog } from '@/lib/db/schema/ai';
import { PROVIDER_META } from '@/lib/ai/providers/openai-compat';
import { encryptSecret, decryptSecret } from '@/lib/marketplaces/crypto';
import {
  XRAY_HTTP_LISTEN,
  XRAY_HTTP_PORT,
  XRAY_PROXY_URL,
  maskSubscriptionUrl,
  maskVlessLink,
  type PublicVlessServer,
} from './vless';

export type AiVpnSettings = NonNullable<TenantSettings['aiVpn']>;

/** Дефолт для тенанта, у которого VPN ещё не настраивали. */
export const EMPTY_AI_VPN: AiVpnSettings = { enabled: false, mode: 'link' };

/** Гейт: управление VPN хоста — только super_admin (обычный admin не может). */
export function isVpnAdmin(globalRole: string | undefined): boolean {
  return globalRole === 'super_admin';
}

export async function loadTenantSettings(tenantId: string): Promise<TenantSettings> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  if (!tenant) throw new Error('Tenant not found');
  return tenant.settings ?? {};
}

export async function saveTenantSettings(
  tenantId: string,
  settings: TenantSettings,
): Promise<void> {
  await db.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}

/** Прочитать aiVpn с дефолтом. */
export function getVpn(settings: TenantSettings): AiVpnSettings {
  return { ...EMPTY_AI_VPN, ...(settings.aiVpn ?? {}) };
}

// ─────────────────────────── Секреты ───────────────────────────

export function encryptVpnSecret(value: string): string {
  return encryptSecret(value);
}

/** Расшифровать сохранённый секрет. null — секрета нет или ключ шифрования сменили. */
export function decryptVpnSecret(payload: string | undefined): string | null {
  if (!payload) return null;
  try {
    return decryptSecret(payload);
  } catch {
    return null;
  }
}

// ─────────────────────────── Публичное представление ───────────────────────────

export type PublicVpnState = {
  enabled: boolean;
  mode: 'link' | 'subscription';
  /** Есть сохранённая ссылка (её саму не отдаём). */
  hasLink: boolean;
  /** vless://••••@host:port (fingerprint8) либо null. */
  linkMasked: string | null;
  hasSubscription: boolean;
  /** https://host/•••• либо null. */
  subscriptionMasked: string | null;
  servers: PublicVlessServer[];
  selectedServerId: string | null;
  lastFetchedAt: string | null;
  appliedFingerprint8: string | null;
  appliedAt: string | null;
  appliedServer: { label: string; host: string; port: number; fingerprint8: string } | null;
  lastError: string | null;
  /** Секрет не расшифровывается текущим ключом — нужен reencrypt-secrets. */
  secretUnreadable: boolean;
};

/**
 * Свести настройки к тому, что разрешено показывать админу.
 * НИКОГДА не включает ссылку/URL целиком — только host:port и 8 символов отпечатка.
 */
export function toPublicVpnState(settings: TenantSettings): PublicVpnState {
  const vpn = getVpn(settings);
  const link = decryptVpnSecret(vpn.linkEnc);
  const subUrl = decryptVpnSecret(vpn.subscriptionUrlEnc);
  const secretUnreadable =
    (!!vpn.linkEnc && link === null) || (!!vpn.subscriptionUrlEnc && subUrl === null);

  return {
    enabled: vpn.enabled,
    mode: vpn.mode,
    hasLink: !!vpn.linkEnc,
    linkMasked: link ? maskVlessLink(link) : vpn.linkEnc ? 'vless://••••' : null,
    hasSubscription: !!vpn.subscriptionUrlEnc,
    subscriptionMasked: subUrl ? maskSubscriptionUrl(subUrl) : vpn.subscriptionUrlEnc ? '••••' : null,
    servers: vpn.servers ?? [],
    selectedServerId: vpn.selectedServerId ?? null,
    lastFetchedAt: vpn.lastFetchedAt ?? null,
    appliedFingerprint8: vpn.appliedFingerprint ? vpn.appliedFingerprint.slice(0, 8) : null,
    appliedAt: vpn.appliedAt ?? null,
    appliedServer: vpn.appliedServer ?? null,
    lastError: vpn.lastError ?? null,
    secretUnreadable,
  };
}

// ─────────────────────────── Audit log ───────────────────────────

/**
 * Записать действие в ai_audit_log. args/result проходят через вызывающий код
 * уже очищенными — сюда НЕЛЬЗЯ передавать ссылку/URL/uuid.
 */
export async function logVpnAction(opts: {
  tenantId: string;
  userId: string;
  action: 'apply_link' | 'apply_server' | 'refresh_subscription' | 'toggle';
  args: Record<string, unknown>;
  result: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(aiAuditLog).values({
      tenantId: opts.tenantId,
      toolName: `vpn.${opts.action}`,
      args: { ...opts.args, userId: opts.userId },
      result: opts.result,
      targetType: 'ai_vpn',
    });
  } catch (e) {
    // Аудит не должен ронять применение конфига — только лог.
    console.error('[vpn] audit log failed:', e instanceof Error ? e.message : e);
  }
}

// ─────────────────────────── UX-обвязка прокси ───────────────────────────

/** Провайдеры, которые из РФ работают только через VPN (PROVIDER_META.requiresVpn). */
export function vpnRequiringProviders(): string[] {
  return PROVIDER_META.filter((p) => p.requiresVpn === true).map((p) => p.id);
}

export type ProxyWireUpResult = {
  proxyEnabled: boolean;
  tenantProviderUpdated: boolean;
  userCredentialsUpdated: number;
};

/**
 * После успешного apply: включить aiProxy на локальный http-inbound Xray и
 * проставить useProxy=true всем провайдерам с requiresVpn (tenant-level и user-level).
 * Мутирует переданный settings (сохранение — на вызывающей стороне).
 */
export async function wireUpProxyAfterApply(
  tenantId: string,
  settings: TenantSettings,
): Promise<ProxyWireUpResult> {
  settings.aiProxy = {
    ...(settings.aiProxy ?? {}),
    enabled: true,
    url: XRAY_PROXY_URL,
    type: 'http',
    username: settings.aiProxy?.username,
    password: settings.aiProxy?.password,
  };

  const vpnProviders = vpnRequiringProviders();

  let tenantProviderUpdated = false;
  if (settings.aiExternal && vpnProviders.includes(settings.aiExternal.provider)) {
    if (!settings.aiExternal.useProxy) {
      settings.aiExternal = { ...settings.aiExternal, useProxy: true };
      tenantProviderUpdated = true;
    }
  }

  let userCredentialsUpdated = 0;
  try {
    const rows = await db
      .update(userAiCredentials)
      .set({ useProxy: true, updatedAt: new Date() })
      .where(
        and(
          eq(userAiCredentials.tenantId, tenantId),
          inArray(userAiCredentials.provider, vpnProviders),
          eq(userAiCredentials.useProxy, false),
        ),
      )
      .returning({ id: userAiCredentials.id });
    userCredentialsUpdated = rows.length;
  } catch (e) {
    console.error('[vpn] useProxy backfill failed:', e instanceof Error ? e.message : e);
  }

  return { proxyEnabled: true, tenantProviderUpdated, userCredentialsUpdated };
}

/** Локальный прокси-конфиг для диагностики внешнего IP (getExternalIp). */
export function localXrayProxyConfig(): NonNullable<TenantSettings['aiProxy']> {
  return { enabled: true, url: `http://${XRAY_HTTP_LISTEN}:${XRAY_HTTP_PORT}`, type: 'http' };
}
