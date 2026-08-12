// PURPOSE: Одноразовая перешифровка секретов (marketplace_accounts.api_key_enc /
// perf_client_secret_enc, inbox_channels.secret, tenants.settings.aiVpn.linkEnc /
// subscriptionUrlEnc) на актуальные ключи из .env.local.
// Нужна после смены MARKETPLACE_SECRET_KEY / INBOX_SECRET_KEY: старые записи
// расшифровываются legacy-кандидатами (LEGACY_SECRET_KEYS через запятую +
// dev-fallback) и сохраняются заново актуальным primary-ключом.
//
// Запуск: pnpm admin:reencrypt-secrets
//         LEGACY_SECRET_KEYS="старый-ключ-1,старый-ключ-2" pnpm admin:reencrypt-secrets
import 'dotenv/config';
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

loadEnv({ path: '.env.local' });

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://openfinance_user:openfinance_local_dev@localhost:5434/openfinance_dev';

// Копия хелперов src/lib/inbox/crypto.ts (скрипт самодостаточен, без '@/' алиасов).
const VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const DEV_FALLBACK = 'dev-inbox-secret-key-change-before-production';

function deriveKey(raw: string): Buffer {
  return createHash('sha256').update(raw).digest();
}

function encryptWithRaw(value: string, raw: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(raw), iv, {
    authTagLength: AUTH_TAG_BYTES,
  });
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
}

function decryptWithRaw(payload: string, raw: string): string {
  const [version, ivB64, tagB64, encryptedB64] = payload.split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !encryptedB64) {
    throw new Error('Invalid encrypted secret payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', deriveKey(raw), Buffer.from(ivB64, 'base64url'), {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function decryptsWith(payload: string, raw: string): boolean {
  try {
    decryptWithRaw(payload, raw);
    return true;
  } catch {
    return false;
  }
}

/** Кандидаты для расшифровки: оба env-ключа + LEGACY_SECRET_KEYS + dev-fallback. */
function legacyCandidates(): string[] {
  const extra = (process.env.LEGACY_SECRET_KEYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    ...new Set(
      [
        process.env.MARKETPLACE_SECRET_KEY ?? '',
        process.env.INBOX_SECRET_KEY ?? '',
        ...extra,
        DEV_FALLBACK,
      ].filter(Boolean),
    ),
  ];
}

/**
 * Перешифровывает payload на primary. Возвращает:
 * - null — уже на primary, трогать не нужно;
 * - строку — новый payload;
 * - бросает, если ни один кандидат не подошёл.
 */
function reencrypt(payload: string, primary: string): string | null {
  if (decryptsWith(payload, primary)) return null;
  for (const raw of legacyCandidates()) {
    if (raw === primary) continue;
    try {
      return encryptWithRaw(decryptWithRaw(payload, raw), primary);
    } catch {
      /* следующий кандидат */
    }
  }
  throw new Error('ни один ключ-кандидат не подошёл (добавьте старый ключ в LEGACY_SECRET_KEYS)');
}

async function main() {
  const marketplacePrimary =
    process.env.MARKETPLACE_SECRET_KEY || process.env.INBOX_SECRET_KEY || '';
  const inboxPrimary = process.env.INBOX_SECRET_KEY || '';
  if (!marketplacePrimary || !inboxPrimary) {
    console.error('✗ MARKETPLACE_SECRET_KEY/INBOX_SECRET_KEY не заданы в .env.local');
    process.exit(1);
  }

  const sql = postgres(DATABASE_URL, { max: 1 });
  let changed = 0;
  let failed = 0;

  try {
    const accounts = await sql<
      { id: string; name: string; api_key_enc: string; perf_client_secret_enc: string | null }[]
    >`SELECT id, name, api_key_enc, perf_client_secret_enc FROM marketplace_accounts`;

    for (const acc of accounts) {
      for (const field of ['api_key_enc', 'perf_client_secret_enc'] as const) {
        const payload = acc[field];
        if (!payload) continue;
        try {
          const next = reencrypt(payload, marketplacePrimary);
          if (next) {
            await sql`UPDATE marketplace_accounts SET ${sql({ [field]: next, updated_at: new Date() })} WHERE id = ${acc.id}`;
            changed += 1;
            console.log(`✓ marketplace_accounts(${acc.name}).${field} — перешифрован`);
          } else {
            console.log(`= marketplace_accounts(${acc.name}).${field} — уже на актуальном ключе`);
          }
        } catch (e) {
          failed += 1;
          console.error(`✗ marketplace_accounts(${acc.name}).${field}: ${(e as Error).message}`);
        }
      }
    }

    const channels = await sql<
      { id: string; label: string | null; secret: string | null }[]
    >`SELECT id, label, secret FROM inbox_channels`;

    for (const ch of channels) {
      if (!ch.secret) continue;
      const name = ch.label ?? ch.id;
      try {
        const next = reencrypt(ch.secret, inboxPrimary);
        if (next) {
          await sql`UPDATE inbox_channels SET secret = ${next}, updated_at = ${new Date()} WHERE id = ${ch.id}`;
          changed += 1;
          console.log(`✓ inbox_channels(${name}).secret — перешифрован`);
        } else {
          console.log(`= inbox_channels(${name}).secret — уже на актуальном ключе`);
        }
      } catch (e) {
        failed += 1;
        console.error(`✗ inbox_channels(${name}).secret: ${(e as Error).message}`);
      }
    }

    // tenants.settings.aiVpn — секреты VLESS (шифруются тем же marketplace-ключом,
    // см. src/lib/ai/vpn/admin.ts → encryptSecret из marketplaces/crypto).
    const tenantRows = await sql<
      { id: string; name: string; settings: Record<string, unknown> | null }[]
    >`SELECT id, name, settings FROM tenants WHERE settings ? 'aiVpn'`;

    for (const t of tenantRows) {
      const settings = (t.settings ?? {}) as Record<string, unknown>;
      const vpn = settings.aiVpn as Record<string, unknown> | undefined;
      if (!vpn) continue;
      let touched = false;

      for (const field of ['linkEnc', 'subscriptionUrlEnc'] as const) {
        const payload = vpn[field];
        if (typeof payload !== 'string' || !payload) continue;
        try {
          const next = reencrypt(payload, marketplacePrimary);
          if (next) {
            vpn[field] = next;
            touched = true;
            changed += 1;
            console.log(`✓ tenants(${t.name}).aiVpn.${field} — перешифрован`);
          } else {
            console.log(`= tenants(${t.name}).aiVpn.${field} — уже на актуальном ключе`);
          }
        } catch (e) {
          failed += 1;
          console.error(`✗ tenants(${t.name}).aiVpn.${field}: ${(e as Error).message}`);
        }
      }

      if (touched) {
        // Мержим ТОЛЬКО изменённое поддерево (jsonb ||), а не перезаписываем весь
        // settings: в том же объекте живут aiProxy/marketplace/inbox-ветки, которые
        // мог поменять другой процесс, пока скрипт перешифровывал ключи.
        const patch = { aiVpn: vpn };
        await sql`UPDATE tenants SET settings = COALESCE(settings, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, updated_at = ${new Date()} WHERE id = ${t.id}`;
      }
    }

    console.log(`\nГотово: перешифровано ${changed}, ошибок ${failed}.`);
    if (failed > 0) {
      console.log(
        'Для записей с ошибкой укажите старый ключ: LEGACY_SECRET_KEYS="старый" pnpm admin:reencrypt-secrets',
      );
      process.exit(1);
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error('✗ Fatal:', e);
  process.exit(1);
});
