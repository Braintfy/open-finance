// PURPOSE: POST /api/auth/login — логин
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { signIn } from '@/lib/auth';
import { rateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit';

const Body = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(1, 'Введите пароль'),
});

const WINDOW_SEC = 15 * 60;

export async function POST(req: Request) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : 'Некорректный запрос';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  const email = parsed.email.trim().toLowerCase();
  const ipLimit = await rateLimit({ key: `auth:login:ip:${clientIp(req)}`, limit: 10, windowSec: WINDOW_SEC });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);
  const emailLimit = await rateLimit({ key: `auth:login:email:${email}`, limit: 5, windowSec: WINDOW_SEC });
  if (!emailLimit.ok) return rateLimitResponse(emailLimit);

  const result = await signIn(parsed);
  if (!result.ok) {
    return NextResponse.json(result, { status: 401 });
  }
  return NextResponse.json(result);
}
