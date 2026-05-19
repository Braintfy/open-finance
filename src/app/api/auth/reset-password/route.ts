// PURPOSE: POST /api/auth/reset-password — подтверждение сброса пароля.
// Принимает { token, password } из формы на /reset-password.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { confirmPasswordReset } from '@/lib/auth';

const Body = z.object({
  token: z.string().min(8, 'Некорректный токен'),
  password: z.string().min(8, 'Минимум 8 символов'),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof Body>;
  try {
    parsed = Body.parse(await req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0]?.message : 'Некорректный запрос';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }

  const result = await confirmPasswordReset(parsed.token, parsed.password);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
