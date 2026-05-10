// PURPOSE: Точка входа auth — динамический выбор драйвера v5 (default) или v4 (fallback).
// Когда v5 (Auth.js / next-auth@5) выйдет из beta — оставим только её.
// Пока обе ветки только заготовки, реальная имплементация в Этапе 1.

import { env } from '@/lib/env';

export type AuthDriver = 'v4' | 'v5';

export const authDriver: AuthDriver = env.AUTH_DRIVER;

// Реальные модули подключим в Этапе 1:
//   v5: src/lib/auth/v5.ts (NextAuth.js 5 с Drizzle adapter)
//   v4: src/lib/auth/v4.ts (NextAuth.js 4 как fallback)
//
// Внешний API будет одинаковый:
//   import { auth, signIn, signOut } from '@/lib/auth';
//
// Это позволит откатиться сменой одного env-флага.

export function getAuthInfo() {
  return {
    driver: authDriver,
    openRegistration: env.FEATURE_OPEN_REGISTRATION,
  };
}
