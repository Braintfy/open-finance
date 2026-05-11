// PURPOSE: POST /api/admin/ai/providers/test — тест соединения с внешним AI (без сохранения в БД)
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { eq } from 'drizzle-orm';
import { testExternalConnection } from '@/lib/ai/providers/openai-compat';
import { getExternalIp } from '@/lib/ai/providers/proxy';

export const runtime = 'nodejs';
export const maxDuration = 30;

const TestSchema = z.object({
  target: z.enum(['external', 'proxy']),
  // Если apiKey/password содержат маску "••••" — берём из БД
  aiExternal: z
    .object({
      enabled: z.boolean(),
      provider: z.enum(['openai', 'anthropic', 'openrouter', 'vsegpt', 'custom']),
      baseUrl: z.string().url(),
      apiKey: z.string(),
      defaultModel: z.string(),
      useProxy: z.boolean().optional(),
    })
    .optional(),
  aiProxy: z
    .object({
      enabled: z.boolean(),
      url: z.string(),
      type: z.enum(['http', 'https', 'socks5']),
      username: z.string().optional(),
      password: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (session.globalRole !== 'admin' && session.globalRole !== 'super_admin') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: z.infer<typeof TestSchema>;
  try {
    body = TestSchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof z.ZodError ? e.flatten() : 'Invalid body' },
      { status: 400 },
    );
  }

  // Загружаем существующие настройки чтобы заменить маски (••••)
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const stored = tenant?.settings ?? {};

  const aiExternal = body.aiExternal
    ? {
        ...body.aiExternal,
        apiKey: body.aiExternal.apiKey.includes('••••')
          ? stored.aiExternal?.apiKey ?? ''
          : body.aiExternal.apiKey,
      }
    : undefined;

  const aiProxy = body.aiProxy
    ? {
        ...body.aiProxy,
        password: body.aiProxy.password?.includes('••••')
          ? stored.aiProxy?.password ?? ''
          : body.aiProxy.password,
      }
    : undefined;

  if (body.target === 'external') {
    if (!aiExternal) {
      return NextResponse.json({ ok: false, error: 'aiExternal required for target=external' }, { status: 400 });
    }
    const result = await testExternalConnection({ config: aiExternal, proxy: aiProxy });
    return NextResponse.json(result);
  }

  if (body.target === 'proxy') {
    if (!aiProxy) {
      return NextResponse.json({ ok: false, error: 'aiProxy required for target=proxy' }, { status: 400 });
    }
    try {
      const start = Date.now();
      const ip = await getExternalIp(aiProxy);
      return NextResponse.json({
        ok: true,
        ip: ip.ip,
        country: ip.country,
        city: ip.city,
        via: ip.via,
        latencyMs: Date.now() - start,
      });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : 'Proxy test failed' },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({ ok: false, error: 'Invalid target' }, { status: 400 });
}
