// PURPOSE: Точка входа auth — реальная имплементация поверх JWT cookie.
// API сделан совместимым с NextAuth v5 (auth/signIn/signOut), чтобы потом легко мигрировать.

import { env } from '@/lib/env';
import { register, login, logout, getSession, requestPasswordReset, confirmPasswordReset } from './actions';

export type AuthDriver = 'v4' | 'v5' | 'minimal';

// Сейчас используется minimal (свой JWT). v4/v5 — для будущей миграции.
export const authDriver: AuthDriver = 'minimal';

export const auth = getSession;
export const signIn = login;
export const signOut = logout;
export const signUp = register;
export { requestPasswordReset, confirmPasswordReset };

export function getAuthInfo() {
  return {
    driver: authDriver,
    targetDriver: env.AUTH_DRIVER,
    openRegistration: env.FEATURE_OPEN_REGISTRATION,
  };
}
