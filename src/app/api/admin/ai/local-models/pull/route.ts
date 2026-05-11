// PURPOSE: POST /api/admin/ai/local-models/pull — стримит прогресс загрузки модели через NDJSON
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

const Body = z.object({ name: z.string().min(1) });

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

  // Проксируем стрим Ollama → клиенту
  const upstream = await fetch(`${env.OLLAMA_BASE_URL}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: body.name, name: body.name, stream: true }),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return NextResponse.json(
      { ok: false, error: `Ollama API ${upstream.status}${text ? `: ${text}` : ''}` },
      { status: 502 }
    );
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  });
}
