// PURPOSE: AES-256-GCM encryption helpers for secrets (inbox channels + marketplaces).
// Низкоуровневые *WithKey/deriveKey принимают ключ явно (используются в
// marketplaces/crypto.ts с отдельным MARKETPLACE_SECRET_KEY, I5).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '@/lib/env';

const VERSION = 'v1';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

/** Производит 32-байтный AES-ключ из произвольной строки-секрета. */
export function deriveKey(raw: string): Buffer {
  return createHash('sha256').update(raw).digest();
}

function getInboxKey(): Buffer {
  const raw =
    env.INBOX_SECRET_KEY ||
    (env.NODE_ENV === 'development' ? 'dev-inbox-secret-key-change-before-production' : '');
  if (!raw) {
    throw new Error('INBOX_SECRET_KEY is required for inbox channel encryption');
  }
  return deriveKey(raw);
}

export function encryptWithKey(value: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_BYTES });
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.');
}

export function decryptWithKey(payload: string, key: Buffer): string {
  const [version, ivB64, tagB64, encryptedB64] = payload.split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !encryptedB64) {
    throw new Error('Invalid encrypted secret payload');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64url'), {
    authTagLength: AUTH_TAG_BYTES,
  });
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedB64, 'base64url')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function encryptSecret(value: string): string {
  return encryptWithKey(value, getInboxKey());
}

export function decryptSecret(payload: string): string {
  return decryptWithKey(payload, getInboxKey());
}

export function maskSecret(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 2)}••••${value.slice(-2)}`;
}
