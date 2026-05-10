// PURPOSE: DELETE /api/admin/ai/local-models/:name — удаление установленной модели
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { deleteModel } from '@/lib/ai/providers/ollama';

export const runtime = 'nodejs';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await auth();
  if (!session || (session.globalRole !== 'admin' && session.globalRole !== 'super_admin')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  const { name } = await params;
  try {
    await deleteModel(decodeURIComponent(name));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 }
    );
  }
}
