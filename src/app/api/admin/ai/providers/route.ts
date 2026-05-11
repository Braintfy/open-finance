// PURPOSE: GET/PUT /api/admin/ai/providers — настройки внешнего AI провайдера + прокси
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants, type TenantSettings } from '@/lib/db/schema/tenants';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

const ProviderSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(['openai', 'anthropic', 'openrouter', 'vsegpt', 'custom']),
  baseUrl: z.string().url(),
  apiKey: z.string(),
  defaultModel: z.string().max(200),
  useProxy: z.boolean().optional(),
});

const ProxySchema = z.object({
  enabled: z.boolean(),
  url: z.string(),
  type: z.enum(['http', 'https', 'socks5']),
  username: z.string().optional(),
  password: z.string().optional(),
});

const Body = z.object({
  aiExternal: ProviderSchema.optional(),
  aiProxy: ProxySchema.optional(),
});

/** Мaскировать apiKey/password перед отдачей клиенту */
function maskSecret(s: string | undefined): string {
  if (!s) return '';
  if (s.length <= 8) return '••••';
  return s.slice(0, 4) + '••••' + s.slice(-4);
}

export async function GET() {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (session.globalRole !== 'admin' && session.globalRole !== 'super_admin') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const settings = tenant?.settings ?? {};

  // Маскируем секреты для клиента
  return NextResponse.json({
    ok: true,
    aiExternal: settings.aiExternal
      ? { ...settings.aiExternal, apiKey: maskSecret(settings.aiExternal.apiKey), hasApiKey: !!settings.aiExternal.apiKey }
      : null,
    aiProxy: settings.aiProxy
      ? { ...settings.aiProxy, password: maskSecret(settings.aiProxy.password), hasPassword: !!settings.aiProxy.password }
      : null,
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  if (session.globalRole !== 'admin' && session.globalRole !== 'super_admin') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof z.ZodError ? e.flatten() : 'Invalid body' },
      { status: 400 },
    );
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  if (!tenant) {
    return NextResponse.json({ ok: false, error: 'Tenant not found' }, { status: 404 });
  }

  const settings: TenantSettings = { ...(tenant.settings ?? {}) };

  if (body.aiExternal !== undefined) {
    // Если apiKey приходит как маска "abcd••••wxyz" — оставляем старый
    const incoming = body.aiExternal;
    const currentKey = settings.aiExternal?.apiKey ?? '';
    const newKey = incoming.apiKey.includes('••••') ? currentKey : incoming.apiKey;
    settings.aiExternal = { ...incoming, apiKey: newKey };
    settings.aiProvider = incoming.enabled ? 'openai' : 'ollama';
  }

  if (body.aiProxy !== undefined) {
    const incoming = body.aiProxy;
    const currentPass = settings.aiProxy?.password ?? '';
    const newPass = incoming.password?.includes('••••') ? currentPass : (incoming.password ?? '');
    settings.aiProxy = { ...incoming, password: newPass };
  }

  await db.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, session.tenantId));

  return NextResponse.json({ ok: true });
}
