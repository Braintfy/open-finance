// PURPOSE: GET /api/admin/ai/local-models/ps — запущенные в памяти модели
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isOllamaAvailable, listRunningModels } from '@/lib/ai/providers/ollama';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session || (session.globalRole !== 'admin' && session.globalRole !== 'super_admin')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  const available = await isOllamaAvailable();
  if (!available) {
    return NextResponse.json({ ok: true, ollamaAvailable: false, running: [] });
  }
  try {
    const running = await listRunningModels();
    return NextResponse.json({ ok: true, ollamaAvailable: true, running });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed' },
      { status: 500 }
    );
  }
}
