// PURPOSE: POST /api/admin/ai/local-models/:name/unload — выгрузить модель из памяти
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { unloadModel } from '@/lib/ai/providers/ollama';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await auth();
  if (!session || (session.globalRole !== 'admin' && session.globalRole !== 'super_admin')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  const { name } = await params;
  try {
    await unloadModel(decodeURIComponent(name));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 }
    );
  }
}
