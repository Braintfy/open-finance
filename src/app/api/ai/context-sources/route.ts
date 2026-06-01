// PURPOSE: GET /api/ai/context-sources?pageKey= — список разделов-источников для
// мини-модалки выбора кросс-раздельного контекста «AI Анализ раздела». Для каждого
// раздела: config блоков (из layout) + последний сохранённый ИИ-отчёт. Клиент по
// этим данным считает токены и собирает превью; реальный резолв для промпта — в
// analyze-section (resolveExternalSources, из той же БД).
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { listSectionContextSources } from '@/lib/ai/context-sources-queries';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const currentPageKey = new URL(req.url).searchParams.get('pageKey') ?? '';
  try {
    const sources = await listSectionContextSources({
      tenantId: session.tenantId,
      userId: session.userId,
      currentPageKey,
    });
    return NextResponse.json({ ok: true, sources });
  } catch (error) {
    console.error('[api/ai/context-sources GET]', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
