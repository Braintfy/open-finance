// PURPOSE: POST /api/admin/ai/local-models/hf-parse — парсит HuggingFace ссылку в Ollama tag
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { parseHuggingFaceUrl } from '@/lib/ai/providers/ollama-catalog';

export const runtime = 'nodejs';

const Body = z.object({ input: z.string().min(1).max(500) });

export async function POST(req: Request) {
  const session = await auth();
  if (!session || (session.globalRole !== 'admin' && session.globalRole !== 'super_admin')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }
  const result = parseHuggingFaceUrl(body.input);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    ollamaTag: result.ollamaTag,
    user: result.user,
    repo: result.repo,
    quantization: result.quantization,
  });
}
