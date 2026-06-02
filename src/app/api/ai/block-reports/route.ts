// PURPOSE: GET /api/ai/block-reports?pageKey=&blockId= — список отчётов блока
// (история до 10). Без blockId (только pageKey) — карта blockId→последний отчёт
// для всех блоков раздела (используется анализом раздела и счётчиком токенов).
// POST — сохранить новый отчёт; при лимите 10 без overwriteOldest → 409.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import {
  listBlockReports,
  getLatestBlockReportsForPage,
  saveBlockReport,
} from '@/lib/ai/block-reports-queries';
import { SectionInsightSchema } from '@/lib/ai/section-insights';

export const runtime = 'nodejs';

const SaveSchema = z.object({
  pageKey: z.string().min(1).max(64),
  blockId: z.string().min(1).max(64),
  blockType: z.string().max(80).nullable().optional(),
  blockTitle: z.string().max(200).nullable().optional(),
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
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const pageKey = params.get('pageKey');
  const blockId = params.get('blockId');
  if (!pageKey) {
    return NextResponse.json({ ok: false, error: 'pageKey required' }, { status: 400 });
  }

  // Без blockId → карта последних отчётов по странице (для анализа раздела).
  if (!blockId) {
    const map = await getLatestBlockReportsForPage({
      tenantId: session.tenantId,
      userId: session.userId,
      pageKey,
    });
    const latest = Object.fromEntries(
      Object.entries(map).map(([id, r]) => [
        id,
        {
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          blockTitle: r.blockTitle,
          summary: r.summary,
          insights: r.insights,
        },
      ]),
    );
    return NextResponse.json({ ok: true, latest });
  }

  const reports = await listBlockReports({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey,
    blockId,
  });
  return NextResponse.json({ ok: true, reports });
}

export async function POST(req: NextRequest) {
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

  const result = await saveBlockReport({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey: body.data.pageKey,
    blockId: body.data.blockId,
    blockType: body.data.blockType ?? null,
    blockTitle: body.data.blockTitle ?? null,
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
}
