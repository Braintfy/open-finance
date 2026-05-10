// PURPOSE: POST /api/auth/forgot-password — генерирует токен для сброса
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requestPasswordReset } from '@/lib/auth';

const Body = z.object({ email: z.string().email() });

export async function POST(req: Request) {
  try {
    const { email } = Body.parse(await req.json());
    await requestPasswordReset(email);
    return NextResponse.json({ ok: true });
  } catch {
    // Не палим существование email — отвечаем ok всегда
    return NextResponse.json({ ok: true });
  }
}
