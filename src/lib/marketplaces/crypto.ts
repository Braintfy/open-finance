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

export function decryptSecret(payload: string): string {
  const { primary, legacy } = rawKeys();
  try {
    return decryptWithKey(payload, deriveKey(primary));
  } catch (e) {
    if (legacy && legacy !== primary) {
      return decryptWithKey(payload, deriveKey(legacy));
    }
    throw e;
  }
}

export { maskSecret };
