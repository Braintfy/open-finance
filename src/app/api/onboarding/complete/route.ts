// PURPOSE: POST /api/onboarding/complete — фиксируем выбор и помечаем tenant как прошедший онбординг
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { pickTemplate } from '@/lib/onboarding/templates';

const Body = z.object({
  occupation: z.enum([
    'marketplace_seller',
    'freelancer',
    'small_business',
    'self_employed',
    'personal',
    'other',
  ]).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const template = pickTemplate({ occupation: body.occupation ?? 'other' });

  await db
    .update(tenants)
    .set({
      onboardingCompleted: true,
      setupAnswers: {
        occupation: body.occupation ?? 'other',
        completedAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    })
    .where(eq(tenants.id, session.tenantId));

  // TODO Этап 1: применить template — создать модули, AI-агентов, демо-данные
  return NextResponse.json({ ok: true, template: template.id, modules: template.modules });
}
