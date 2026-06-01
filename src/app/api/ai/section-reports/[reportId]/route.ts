// PURPOSE: DELETE /api/ai/section-reports/[reportId] — удалить один сохранённый
// ИИ-отчёт раздела (scoped tenant + user).
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { deleteSectionReport } from '@/lib/ai/section-reports-queries';

export const runtime = 'nodejs';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ reportId: string }> },
) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { reportId } = await params;
  if (!reportId) {
    return NextResponse.json({ ok: false, error: 'reportId required' }, { status: 400 });
  }
  const deleted = await deleteSectionReport({
    tenantId: session.tenantId,
    userId: session.userId,
    reportId,
  });
  if (!deleted) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
