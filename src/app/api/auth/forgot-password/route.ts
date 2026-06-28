// PURPOSE: POST /api/auth/forgot-password — генерирует токен для сброса
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requestPasswordReset } from '@/lib/auth';
import { rateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit';

const Body = z.object({ email: z.string().email() });

const WINDOW_SEC = 15 * 60;

export async function POST(req: Request) {
  try {
    const { email } = Body.parse(await req.json());
    const normalized = email.trim().toLowerCase();
    const ipLimit = await rateLimit({ key: `auth:forgot:ip:${clientIp(req)}`, limit: 10, windowSec: WINDOW_SEC });
    if (!ipLimit.ok) return rateLimitResponse(ipLimit);
    const emailLimit = await rateLimit({ key: `auth:forgot:email:${normalized}`, limit: 5, windowSec: WINDOW_SEC });
    if (!emailLimit.ok) return rateLimitResponse(emailLimit);

    await requestPasswordReset(normalized);
    return NextResponse.json({ ok: true });
  } catch {
    // Не палим существование email — отвечаем ok всегда
    return NextResponse.json({ ok: true });
  }
}
