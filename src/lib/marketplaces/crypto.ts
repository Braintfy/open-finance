// PURPOSE: Шифрование API-ключей маркетплейсов AES-256-GCM (I5).
// Ключ: MARKETPLACE_SECRET_KEY если задан, иначе INBOX_SECRET_KEY (исторически
// креды шифровались им). Расшифровка: сначала основной ключ, при неудаче —
// legacy INBOX-ключ, чтобы уже сохранённые креды не ломались при вводе нового
// отдельного ключа. maskSecret key-независим — реэкспорт из inbox/crypto.
import { env } from '@/lib/env';
import { deriveKey, encryptWithKey, decryptWithKey, maskSecret } from '@/lib/inbox/crypto';

function inboxRaw(): string {
  return (
    env.INBOX_SECRET_KEY ||
    (env.NODE_ENV === 'development' ? 'dev-inbox-secret-key-change-before-production' : '')
  );
}

/** Основной (для шифрования) и legacy (только для расшифровки) raw-секреты. */
function rawKeys(): { primary: string; legacy: string | null } {
  const inbox = inboxRaw();
  const marketplace = env.MARKETPLACE_SECRET_KEY || '';
  if (marketplace) {
    return { primary: marketplace, legacy: inbox || null };
  }
  if (!inbox) {
    throw new Error(
      'MARKETPLACE_SECRET_KEY или INBOX_SECRET_KEY обязателен для шифрования ключей маркетплейсов',
    );
  }
  return { primary: inbox, legacy: null };
}

export function encryptSecret(value: string): string {
  return encryptWithKey(value, deriveKey(rawKeys().primary));
}

/** Dev-fallback (см. inboxRaw): пробуется ПОСЛЕДНИМ кандидатом при расшифровке
 * в development — спасает креды, сохранённые до появления реальных ключей в env. */
const DEV_FALLBACK_RAW = 'dev-inbox-secret-key-change-before-production';

export function decryptSecret(payload: string): string {
  const { primary, legacy } = rawKeys();
  const candidates = [primary];
  if (legacy && !candidates.includes(legacy)) candidates.push(legacy);
  if (env.NODE_ENV === 'development' && !candidates.includes(DEV_FALLBACK_RAW)) {
    candidates.push(DEV_FALLBACK_RAW);
  }
  let lastError: unknown = null;
  for (const raw of candidates) {
    try {
      return decryptWithKey(payload, deriveKey(raw));
    } catch (e) {
      lastError = e;
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    'Не удалось расшифровать секрет маркетплейса: текущие MARKETPLACE_SECRET_KEY/INBOX_SECRET_KEY ' +
      'не совпадают с ключом, которым секрет был сохранён (ключи меняли?). ' +
      'Переподключите аккаунт в Настройки → Интеграции или выполните pnpm admin:reencrypt-secrets ' +
      `со старым ключом в LEGACY_SECRET_KEYS. (${detail})`,
  );
}

export { maskSecret };
