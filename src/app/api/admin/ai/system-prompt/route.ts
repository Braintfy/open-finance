// PURPOSE: GET/PUT /api/admin/ai/system-prompt — кастомный system prompt tenant'а
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { DEFAULT_SYSTEM_PROMPT } from '@/lib/ai/system-prompt';

export const runtime = 'nodejs';

const PutBody = z.object({
  prompt: z.string().max(20000).optional(),
});

export async function GET() {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const [row] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const custom = row?.settings?.aiSystemPrompt ?? '';
  return NextResponse.json({
    ok: true,
    default: DEFAULT_SYSTEM_PROMPT,
    custom,
    usingDefault: !custom || custom.trim().length === 0,
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const json = await req.json();
  const body = PutBody.safeParse(json);
  if (!body.success) {
    return NextResponse.json({ ok: false, error: 'Bad body' }, { status: 400 });
  }

  const [row] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const settings = row?.settings ?? {};
  const prompt = body.data.prompt?.trim() ?? '';
  const nextSettings = {
    ...settings,
    aiSystemPrompt: prompt.length > 0 ? prompt : undefined,
  };

  await db
    .update(tenants)
    .set({ settings: nextSettings, updatedAt: new Date() })
    .where(eq(tenants.id, session.tenantId));

  return NextResponse.json({
    ok: true,
    usingDefault: prompt.length === 0,
  });
}
