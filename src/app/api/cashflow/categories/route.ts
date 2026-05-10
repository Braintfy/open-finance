// PURPOSE: GET /api/cashflow/categories — список категорий с авто-созданием дефолтных
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listCategories, ensureDefaultCategories } from '@/lib/cashflow/queries';

export async function GET() {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  await ensureDefaultCategories(session.tenantId);
  const items = await listCategories(session.tenantId);
  return NextResponse.json({ ok: true, items });
}
