// PURPOSE: GET/PUT /api/admin/ai/prompts/blocks — промпты для конкретных типов блоков.
import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { BLOCK_SKILLS } from '@/lib/ai/prompts/block-skills/index';
import { listAllBlocks } from '@/lib/blocks/registry';

export const runtime = 'nodejs';

const PutBody = z.object({
  /** Record<blockType, customPrompt> — пустая строка = сброс к дефолту */
  blocks: z.record(z.string().max(3000)),
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

    const overrides = row?.settings?.aiPrompts?.blocks ?? {};

    // Собрать список всех зарегистрированных типов блоков
    const allBlocks = listAllBlocks();

    const blockList = allBlocks.map((b) => ({
      type: b.type,
      displayName: b.displayName,
      default: BLOCK_SKILLS[b.type] ?? '',
      custom: overrides[b.type] ?? '',
    }));

    return NextResponse.json({ ok: true, blocks: blockList });
  } catch (error) {
    console.error('[api/admin/ai/prompts/blocks GET]', error);
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

    // Фильтруем пустые строки → удаляем (сброс к дефолту)
    const cleanBlocks: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.data.blocks)) {
      if (v.trim()) cleanBlocks[k] = v.trim();
    }

    await db
      .update(tenants)
      .set({
        settings: {
          ...settings,
          aiPrompts: {
            ...existingPrompts,
            blocks: Object.keys(cleanBlocks).length > 0 ? cleanBlocks : undefined,
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, session.tenantId));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/admin/ai/prompts/blocks PUT]', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
