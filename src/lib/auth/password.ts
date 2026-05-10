// PURPOSE: Хеш и проверка паролей через bcrypt.
// 12 раундов — sweet spot для bcrypt в 2025+ (~250ms на iPhone, безопасно).

import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < 8) {
    throw new Error('Пароль должен быть не меньше 8 символов');
  }
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

export function generatePasswordResetToken(): string {
  // 32 байта рандома → 64 hex символа
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
