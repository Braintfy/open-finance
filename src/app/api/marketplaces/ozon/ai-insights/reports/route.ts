// PURPOSE: GET /api/marketplaces/ozon/ai-insights/reports?blockId= — список
// сохранённых ИИ-отчётов блока (история до 10).
// POST — сохранить новый отчёт. При достижении лимита 10 без overwriteOldest
// возвращает 409 { needsOverwrite, oldest } — UI спросит подтверждение.
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { listReports, saveReport } from '@/lib/marketplaces/ozon/ai-insights-queries';

export const runtime = 'nodejs';

const InsightSchema = z.object({
  type: z.enum(['positive', 'warning', 'danger', 'info']),
  category: z.enum(['revenue', 'ads', 'products', 'stock', 'returns', 'general']),
  kind: z.enum(['action', 'observation', 'opportunity', 'info']).optional(),
  title: z.string().min(1).max(300),
  description: z.string().max(2000),
  metric: z.string().max(120).optional(),
  priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  sku: z.string().max(120).optional(),
  productName: z.string().max(300).optional(),
  tags: z.array(z.string().max(60)).max(6).optional(),
  recommendation: z
    .object({
      action: z.string().max(300),
      basis: z.string().max(500),
      expectedEffect: z.string().max(500),
    })
    .optional(),
});

const SaveSchema = z.object({
  blockId: z.string().min(1).max(64),
  accountId: z.string().max(64).nullable().optional(),
  periodKey: z.string().max(64).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
  summary: z.string().max(4000).default(''),
  insights: z.array(InsightSchema).max(40),
  overwriteOldest: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const blockId = new URL(req.url).searchParams.get('blockId');
  if (!blockId) {
    return NextResponse.json({ ok: false, error: 'blockId required' }, { status: 400 });
  }
  const reports = await listReports({
    tenantId: session.tenantId,
    userId: session.userId,
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

  const result = await saveReport({
    tenantId: session.tenantId,
    userId: session.userId,
    blockId: body.data.blockId,
    accountId: body.data.accountId ?? null,
    periodKey: body.data.periodKey ?? null,
    model: body.data.model ?? null,
    summary: body.data.summary,
    insights: body.data.insights,
    overwriteOldest: body.data.overwriteOldest,
  });

  if (!result.ok) {
    // Лимит достигнут — нужно подтверждение перезаписи самого старого.
    return NextResponse.json(
      { ok: false, needsOverwrite: true, oldest: result.oldest },
      { status: 409 },
    );
  }

  return NextResponse.json({ ok: true, report: result.report }, { status: 201 });
}
