// PURPOSE: GET /api/ai/section-reports?pageKey= — список сохранённых ИИ-отчётов
// раздела (история до 10). POST — сохранить новый отчёт; при лимите 10 без
// overwriteOldest возвращает 409 { needsOverwrite, oldest } для подтверждения.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import {
  listSectionReports,
  saveSectionReport,
} from '@/lib/ai/section-reports-queries';
import { SectionInsightSchema } from '@/lib/ai/section-insights';
import { getPageWorkspaceScope } from '@/lib/workspaces/active';

export const runtime = 'nodejs';

const SaveSchema = z.object({
  pageKey: z.string().min(1).max(64),
  pageLabel: z.string().max(120).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  summary: z.string().max(4000).default(''),
  insights: z.array(SectionInsightSchema).max(40),
  meta: z
    .object({
      tokens: z.number().int().nonnegative().max(10_000_000).optional(),
      chars: z.number().int().nonnegative().max(50_000_000).optional(),
      blocks: z.number().int().nonnegative().max(1000).optional(),
    })
    .nullable()
    .optional(),
  overwriteOldest: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId || !session.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const pageKey = new URL(req.url).searchParams.get('pageKey');
    if (!pageKey) {
      return NextResponse.json({ ok: false, error: 'pageKey required' }, { status: 400 });
    }
    // Отчёты изолированы по кабинетам (legacy без workspace_id — только в default).
    const workspace = await getPageWorkspaceScope(session.tenantId, session.userId, pageKey);
    const reports = await listSectionReports({
      tenantId: session.tenantId,
      userId: session.userId,
      pageKey,
      workspace,
    });
    return NextResponse.json({ ok: true, reports });
  } catch (error) {
    console.error('[api/ai/section-reports] GET failed:', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.tenantId || !session.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }
    const body = SaveSchema.safeParse(json);
    if (!body.success) {
      return NextResponse.json(
        { ok: false, error: body.error.issues[0]?.message ?? 'Bad request' },
        { status: 400 },
      );
    }

    const workspace = await getPageWorkspaceScope(
      session.tenantId,
      session.userId,
      body.data.pageKey,
    );
    const result = await saveSectionReport({
      tenantId: session.tenantId,
      userId: session.userId,
      workspace,
      pageKey: body.data.pageKey,
      pageLabel: body.data.pageLabel ?? null,
      model: body.data.model ?? null,
      summary: body.data.summary,
      insights: body.data.insights,
      meta: body.data.meta ?? null,
      overwriteOldest: body.data.overwriteOldest,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, needsOverwrite: true, oldest: result.oldest },
        { status: 409 },
      );
    }

    return NextResponse.json({ ok: true, report: result.report }, { status: 201 });
  } catch (error) {
    console.error('[api/ai/section-reports] POST failed:', error);
    return NextResponse.json({ ok: false, error: 'Internal error' }, { status: 500 });
  }
}
