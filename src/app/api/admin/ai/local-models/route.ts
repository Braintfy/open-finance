// PURPOSE: GET /api/admin/ai/local-models — список установленных + каталог рекомендованных
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { isChatCapableModel, isOllamaAvailable, listInstalledModels } from '@/lib/ai/providers/ollama';
import { RECOMMENDED_MODELS } from '@/lib/ai/providers/ollama-catalog';
import { db } from '@/lib/db/client';
import { tenants, type TenantSettings } from '@/lib/db/schema/tenants';
import { eq } from 'drizzle-orm';

export const runtime = 'nodejs';

const Body = z.object({
  defaultModel: z.string().min(1).max(300),
});

export async function GET() {
  const session = await auth();
  if (!session?.tenantId || (session.globalRole !== 'admin' && session.globalRole !== 'super_admin')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  const defaultModel = tenant?.settings?.aiModel ?? null;

  const available = await isOllamaAvailable();
  if (!available) {
    return NextResponse.json({
      ok: true,
      ollamaAvailable: false,
      installed: [],
      catalog: RECOMMENDED_MODELS,
      defaultModel,
      hint: 'Ollama не запущена. См. docs/LOCAL_AI.md (brew install ollama && brew services start ollama)',
    });
  }

  const installed = await listInstalledModels();
  return NextResponse.json({
    ok: true,
    ollamaAvailable: true,
    installed,
    catalog: RECOMMENDED_MODELS,
    defaultModel,
  });
}

export async function PUT(req: Request) {
  const session = await auth();
  if (!session?.tenantId || (session.globalRole !== 'admin' && session.globalRole !== 'super_admin')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof z.ZodError ? 'Некорректная модель' : 'Invalid body' },
      { status: 400 },
    );
  }

  let installed;
  try {
    installed = await listInstalledModels();
  } catch {
    return NextResponse.json({ ok: false, error: 'Ollama недоступна' }, { status: 502 });
  }
  const selected = installed.find((m) => m.name === body.defaultModel);
  if (!selected) {
    return NextResponse.json({ ok: false, error: 'Модель не установлена в Ollama' }, { status: 400 });
  }
  if (!isChatCapableModel(selected)) {
    return NextResponse.json(
      { ok: false, error: 'Эту модель нельзя сделать основной: она не поддерживает chat (/api/chat)' },
      { status: 400 },
    );
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
  if (!tenant) {
    return NextResponse.json({ ok: false, error: 'Tenant not found' }, { status: 404 });
  }

  const settings: TenantSettings = { ...(tenant.settings ?? {}) };
  settings.aiProvider = 'ollama';
  settings.aiModel = selected.name;

  await db.update(tenants).set({ settings, updatedAt: new Date() }).where(eq(tenants.id, session.tenantId));

  return NextResponse.json({ ok: true, defaultModel: selected.name });
}
