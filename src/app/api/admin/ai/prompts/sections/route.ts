// PURPOSE: GET/PUT /api/admin/ai/prompts/sections — промпты для групп разделов и per-page overrides.
import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { SECTION_GROUPS, SECTION_GROUP_IDS } from '@/lib/ai/sections';
import { SECTION_GROUP_DEFAULTS, PAGE_KEY_HINTS } from '@/lib/ai/prompts/section-defaults';

export const runtime = 'nodejs';

const PutBody = z.object({
  /** Override для группы: { finance: "...", dashboard: "..." } */
  groups: z.record(z.string().max(5000)).optional(),
  /** Override для конкретного pageKey: { 'cashflow': "..." } */
  pages: z.record(z.string().max(5000)).optional(),
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

    const overrides = row?.settings?.aiPrompts?.sections ?? {};

    return NextResponse.json({
      ok: true,
      groups: SECTION_GROUPS.map((g) => ({
        id: g.id,
        label: g.label,
        description: g.description,
        default: SECTION_GROUP_DEFAULTS[g.id] ?? '',
        custom: overrides.groups?.[g.id] ?? '',
      })),
      pageHints: PAGE_KEY_HINTS,
      pageOverrides: overrides.pages ?? {},
    });
  } catch (error) {
    console.error('[api/admin/ai/prompts/sections GET]', error);
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

    // Фильтруем пустые строки → удаляем
    const cleanGroups: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.data.groups ?? {})) {
      if (v.trim()) cleanGroups[k] = v.trim();
    }

    const cleanPages: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.data.pages ?? {})) {
      if (v.trim()) cleanPages[k] = v.trim();
    }

    await db
      .update(tenants)
      .set({
        settings: {
          ...settings,
          aiPrompts: {
            ...existingPrompts,
            sections: {
              groups: Object.keys(cleanGroups).length > 0 ? cleanGroups : undefined,
              pages: Object.keys(cleanPages).length > 0 ? cleanPages : undefined,
            },
          },
        },
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, session.tenantId));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[api/admin/ai/prompts/sections PUT]', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
