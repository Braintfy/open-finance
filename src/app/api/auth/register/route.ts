// PURPOSE: POST /api/auth/register — регистрация
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { signUp } from '@/lib/auth';
import { rateLimit, rateLimitResponse, clientIp } from '@/lib/rate-limit';
import { PRIVACY_POLICY_VERSION } from '@/lib/legal';

const Body = z.object({
  email: z.string().email('Некорректный email'),
  password: z.string().min(8, 'Минимум 8 символов'),
  name: z.string().max(200).optional(),
  consent: z
    .boolean()
    .refine((v) => v === true, {
      message: 'Необходимо согласие с политикой конфиденциальности',
    }),
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
  const ipLimit = await rateLimit({ key: `auth:register:ip:${clientIp(req)}`, limit: 10, windowSec: WINDOW_SEC });
  if (!ipLimit.ok) return rateLimitResponse(ipLimit);
  const emailLimit = await rateLimit({ key: `auth:register:email:${email}`, limit: 5, windowSec: WINDOW_SEC });
  if (!emailLimit.ok) return rateLimitResponse(emailLimit);

  const result = await signUp({
    email: parsed.email,
    password: parsed.password,
    name: parsed.name,
    consentVersion: PRIVACY_POLICY_VERSION,
  });
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
