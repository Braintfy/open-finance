// PURPOSE: GET/PUT /api/admin/ai/prompts/pointwise — промпт для анализа dependency-tree блока.
import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { DEFAULT_POINTWISE_PROMPT } from '@/lib/ai/prompts/pointwise';

export const runtime = 'nodejs';

const PutBody = z.object({
  prompt: z.string().max(5000).optional(),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const [row] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);

    const custom = row?.settings?.aiPrompts?.pointwise ?? '';

    return NextResponse.json({
      ok: true,
      default: DEFAULT_POINTWISE_PROMPT,
      custom,
      usingDefault: !custom || custom.trim().length === 0,
    });
  } catch (error) {
    console.error('[api/admin/ai/prompts/pointwise GET]', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const json = await req.json();
    const body = PutBody.safeParse(json);
    if (!body.success) {
      return NextResponse.json(
        { ok: false, error: body.error.issues[0]?.message ?? 'Bad request' },
        { status: 400 },
      );
    }

    const [row] = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);

    const settings = row?.settings ?? {};
    const existingPrompts = settings.aiPrompts ?? {};
    const prompt = body.data.prompt?.trim() ?? '';

    await db
      .update(tenants)
      .set({
        settings: {
          ...settings,
          aiPrompts: {
            ...existingPrompts,
            pointwise: prompt.length > 0 ? prompt : undefined,
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, session.tenantId));

    return NextResponse.json({ ok: true, usingDefault: prompt.length === 0 });
  } catch (error) {
    console.error('[api/admin/ai/prompts/pointwise PUT]', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
