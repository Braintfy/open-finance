// PURPOSE: Серверные действия аутентификации (regsiter, login, logout).
// Используются в API routes и server actions.

import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { users, memberships } from '@/lib/db/schema/users';
import { tenants } from '@/lib/db/schema/tenants';
import { hashPassword, verifyPassword, generatePasswordResetToken } from './password';
import {
  setSessionCookie,
  clearSessionCookie,
  getSessionFromCookie,
  type SessionPayload,
} from './session';
import { env } from '@/lib/env';
import { sendMail } from '@/lib/email/transport';
import { welcomeEmail, resetPasswordEmail } from '@/lib/email/templates';

export type RegisterInput = {
  email: string;
  password: string;
  name?: string;
  /** Версия политики конфиденциальности, с которой согласился пользователь (152-ФЗ). */
  consentVersion?: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type AuthResult =
  | { ok: true; userId: string; tenantId: string }
  | { ok: false; error: string };

function makeSlug(email: string): string {
  return email
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function trialEndsAt(): Date {
  return new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) {
    return { ok: false, error: 'Email и пароль обязательны' };
  }

  // Открыта ли регистрация?
  if (!env.FEATURE_OPEN_REGISTRATION) {
    // По плану — закрыли админкой; пока просто блок.
    return { ok: false, error: 'Регистрация закрыта администратором' };
  }

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    return { ok: false, error: 'Пользователь с таким email уже существует' };
  }

  const passwordHash = await hashPassword(input.password);

  // Создаём в одной транзакции: user → tenant → membership(owner)
  let result: { userId: string; tenantId: string; globalRole: string };
  try {
    result = await db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({
          email,
          passwordHash,
          name: input.name?.trim() || null,
          consentVersion: input.consentVersion ?? null,
          consentAt: input.consentVersion ? new Date() : null,
        })
        .returning({ id: users.id, globalRole: users.globalRole });

      const tenantSlug = `${makeSlug(email)}-${Math.random().toString(36).slice(2, 6)}`;
      const [tenant] = await tx
        .insert(tenants)
        .values({
          name: input.name?.trim() || email.split('@')[0]!,
          slug: tenantSlug,
          plan: env.FEATURE_DEFAULT_PLAN,
          trialEndsAt: env.FEATURE_DEFAULT_PLAN === 'trial' ? trialEndsAt() : null,
          settings: { theme: 'light', locale: 'ru', openRegistration: false },
        })
        .returning({ id: tenants.id });

      await tx.insert(memberships).values({
        userId: user!.id,
        tenantId: tenant!.id,
        role: 'owner',
      });

      return { userId: user!.id, tenantId: tenant!.id, globalRole: user!.globalRole };
    });
  } catch (e: unknown) {
    // Postgres unique violation = code '23505'
    const code = (e as { code?: string })?.code;
    if (code === '23505') {
      return { ok: false, error: 'Пользователь с таким email уже существует' };
    }
    console.error('[auth.register] failed:', e);
    return { ok: false, error: 'Не удалось создать аккаунт. Попробуйте позже.' };
  }

  await setSessionCookie({
    userId: result.userId,
    email,
    globalRole: result.globalRole as SessionPayload['globalRole'],
    tenantId: result.tenantId,
  });

  // Welcome email (best-effort, ошибки не блокируют регистрацию)
  void sendMail({
    to: email,
    ...welcomeEmail({ name: input.name ?? null, appUrl: env.APP_URL || 'http://localhost:3000' }),
  });

  return { ok: true, userId: result.userId, tenantId: result.tenantId };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) {
    return { ok: false, error: 'Email и пароль обязательны' };
  }

  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
      globalRole: users.globalRole,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!user) {
    return { ok: false, error: 'Неверный email или пароль' };
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    return { ok: false, error: 'Неверный email или пароль' };
  }

  // Берём первый tenant пользователя (пока всегда один)
  const [m] = await db
    .select({ tenantId: memberships.tenantId })
    .from(memberships)
    .where(eq(memberships.userId, user.id))
    .limit(1);

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

  await setSessionCookie({
    userId: user.id,
    email: user.email,
    globalRole: user.globalRole as SessionPayload['globalRole'],
    tenantId: m?.tenantId,
  });

  return { ok: true, userId: user.id, tenantId: m?.tenantId ?? '' };
}

export async function logout(): Promise<void> {
  await clearSessionCookie();
}

export async function getSession() {
  return getSessionFromCookie();
}

export async function requestPasswordReset(email: string) {
  const normalized = email.trim().toLowerCase();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalized)).limit(1);
  if (!user) {
    // не палим существование email — возвращаем ok всегда
    return { ok: true as const };
  }
  const token = generatePasswordResetToken();
  await db
    .update(users)
    .set({
      passwordResetToken: token,
      passwordResetExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 час
    })
    .where(eq(users.id, user.id));
  // Отправляем reset email (в dev без SMTP уйдёт в консоль)
  void sendMail({
    to: normalized,
    ...resetPasswordEmail({ token, appUrl: env.APP_URL || 'http://localhost:3000' }),
  });
  return { ok: true as const };
}

export async function confirmPasswordReset(token: string, newPassword: string): Promise<AuthResult> {
  if (!token || !newPassword) {
    return { ok: false, error: 'Токен и новый пароль обязательны' };
  }
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      globalRole: users.globalRole,
      expiresAt: users.passwordResetExpiresAt,
    })
    .from(users)
    .where(eq(users.passwordResetToken, token))
    .limit(1);

  if (!user || !user.expiresAt || user.expiresAt < new Date()) {
    return { ok: false, error: 'Токен недействителен или истёк' };
  }

  const passwordHash = await hashPassword(newPassword);
  await db
    .update(users)
    .set({
      passwordHash,
      passwordResetToken: null,
      passwordResetExpiresAt: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, user.id));

  return { ok: true, userId: user.id, tenantId: '' };
}
