// PURPOSE: GET /api/admin/ai/local-models/:name/show — modelfile, parameters, template, license
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { showModel } from '@/lib/ai/providers/ollama';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  const session = await auth();
  if (!session || (session.globalRole !== 'admin' && session.globalRole !== 'super_admin')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  const { name } = await params;
  try {
    const info = await showModel(decodeURIComponent(name));
    return NextResponse.json({ ok: true, ...info });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 }
    );
  }
}
