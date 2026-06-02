// PURPOSE: GET /api/ai/block-context-sources?pageKey= — дерево блоков проекта для
// пикера контекста «AI Анализ блока». Для каждого раздела: список блоков (config
// для не-текущих разделов + последний отчёт блока). Клиент по этим данным считает
// токены и собирает превью; реальный резолв для промпта — в analyze-block
// (resolveBlockContextSelections, из той же БД).
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { listBlockContextSources } from '@/lib/ai/block-context-sources-queries';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const currentPageKey = new URL(req.url).searchParams.get('pageKey') ?? '';
  try {
    const sources = await listBlockContextSources({
      tenantId: session.tenantId,
      userId: session.userId,
      currentPageKey,
    });
    return NextResponse.json({ ok: true, sources });
  } catch (error) {
    console.error('[api/ai/block-context-sources GET]', error);
    return NextResponse.json({ ok: false, error: String(error) }, { status: 500 });
  }
}
