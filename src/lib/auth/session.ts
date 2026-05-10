// PURPOSE: JWT-сессии в httpOnly cookie. Edge-runtime совместимо (jose).
// Используется в middleware и в API routes.

import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { env } from '@/lib/env';

const COOKIE_NAME = 'of_session';
const ALGO = 'HS256';
const TTL_DAYS = 30;

export type SessionPayload = {
  userId: string;
  email: string;
  globalRole: 'user' | 'admin' | 'super_admin';
  // tenant активного контекста (можно переключать)
  tenantId?: string;
};

function getSecretKey(): Uint8Array {
  const raw = env.NEXTAUTH_SECRET;
  const secret =
    raw && raw.length >= 32
      ? raw
      : env.NODE_ENV === 'development'
        ? 'dev-only-do-not-use-in-prod-min-32-chars-please'
        : null;
  if (!secret) {
    throw new Error(
      'NEXTAUTH_SECRET не задан или короче 32 символов. Сгенерируйте: openssl rand -base64 48'
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGO })
    .setIssuedAt()
    .setExpirationTime(`${TTL_DAYS}d`)
    .sign(getSecretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: [ALGO] });
    if (!payload.userId || !payload.email) return null;
    return {
      userId: payload.userId as string,
      email: payload.email as string,
      globalRole: (payload.globalRole as SessionPayload['globalRole']) ?? 'user',
      tenantId: payload.tenantId as string | undefined,
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload): Promise<void> {
  const token = await createSessionToken(payload);
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: TTL_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

export async function getSessionFromCookie(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
