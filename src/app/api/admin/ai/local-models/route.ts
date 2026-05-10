// PURPOSE: GET /api/admin/ai/local-models — список установленных + каталог рекомендованных
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { isOllamaAvailable, listInstalledModels } from '@/lib/ai/providers/ollama';
import { RECOMMENDED_MODELS } from '@/lib/ai/providers/ollama-catalog';

export const runtime = 'nodejs';

export async function GET() {
  const session = await auth();
  if (!session || (session.globalRole !== 'admin' && session.globalRole !== 'super_admin')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const available = await isOllamaAvailable();
  if (!available) {
    return NextResponse.json({
      ok: true,
      ollamaAvailable: false,
      installed: [],
      catalog: RECOMMENDED_MODELS,
      hint: 'Ollama не запущена. См. docs/LOCAL_AI.md (brew install ollama && brew services start ollama)',
    });
  }

  const installed = await listInstalledModels();
  return NextResponse.json({
    ok: true,
    ollamaAvailable: true,
    installed,
    catalog: RECOMMENDED_MODELS,
  });
}
