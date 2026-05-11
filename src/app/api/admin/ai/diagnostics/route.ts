// PURPOSE: GET /api/admin/ai/diagnostics — диагностика подключений: Ollama, External API, Proxy
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { eq } from 'drizzle-orm';
import { isOllamaAvailable, listInstalledModels, isChatCapableModel } from '@/lib/ai/providers/ollama';
import { testExternalConnection } from '@/lib/ai/providers/openai-compat';
import { getExternalIp } from '@/lib/ai/providers/proxy';
import { env } from '@/lib/env';

export const runtime = 'nodejs';

type CheckResult =
  | { name: string; status: 'ok'; message: string; details?: Record<string, unknown> }
  | { name: string; status: 'warning'; message: string; details?: Record<string, unknown> }
  | { name: string; status: 'error'; message: string; details?: Record<string, unknown> }
  | { name: string; status: 'skipped'; message: string };

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

  const checks: CheckResult[] = [];

  // 1. Ollama (локальный)
  try {
    const available = await isOllamaAvailable();
    if (available) {
      const models = await listInstalledModels();
      const chatModels = models.filter(isChatCapableModel);
      const embedModels = models.length - chatModels.length;
      checks.push({
        name: 'Ollama',
        status: chatModels.length === 0 ? 'warning' : 'ok',
        message:
          chatModels.length === 0
            ? `Запущена, но нет chat-моделей (только ${embedModels} embedding). Установите: ollama pull qwen2.5:1.5b`
            : `Запущена. ${chatModels.length} chat-моделей${embedModels > 0 ? `, ${embedModels} embedding` : ''}`,
        details: {
          url: env.OLLAMA_BASE_URL,
          totalModels: models.length,
          chatModels: chatModels.map((m) => m.name),
          embeddingModels: models.filter((m) => !isChatCapableModel(m)).map((m) => m.name),
        },
      });
    } else {
      checks.push({
        name: 'Ollama',
        status: 'error',
        message: `Не запущена. Запустите: ollama serve (или brew services start ollama)`,
        details: { url: env.OLLAMA_BASE_URL },
      });
    }
  } catch (e) {
    checks.push({
      name: 'Ollama',
      status: 'error',
      message: e instanceof Error ? e.message : 'unknown',
    });
  }

  // 2. External AI Provider
  if (settings.aiExternal?.enabled && settings.aiExternal.apiKey && settings.aiExternal.baseUrl) {
    const result = await testExternalConnection({
      config: settings.aiExternal,
      proxy: settings.aiProxy,
    });
    if (result.ok) {
      checks.push({
        name: `External AI (${settings.aiExternal.provider})`,
        status: 'ok',
        message: `Подключение успешно. Доступно ${result.modelsCount} моделей`,
        details: {
          baseUrl: settings.aiExternal.baseUrl,
          defaultModel: settings.aiExternal.defaultModel,
          sampleModels: result.sample,
        },
      });
    } else {
      checks.push({
        name: `External AI (${settings.aiExternal.provider})`,
        status: 'error',
        message: result.error,
        details: { baseUrl: settings.aiExternal.baseUrl },
      });
    }
  } else {
    checks.push({
      name: 'External AI',
      status: 'skipped',
      message: 'Не настроен (используется только локальный Ollama)',
    });
  }

  // 3. Proxy / VPN (через настройки tenant'а или env)
  if (settings.aiProxy?.enabled && settings.aiProxy.url) {
    try {
      const ipInfo = await getExternalIp(settings.aiProxy);
      checks.push({
        name: 'Proxy (VPN)',
        status: 'ok',
        message: `Работает. IP: ${ipInfo.ip}${ipInfo.country ? ` (${ipInfo.country}${ipInfo.city ? `, ${ipInfo.city}` : ''})` : ''}`,
        details: {
          via: ipInfo.via,
          url: settings.aiProxy.url.replace(/:[^:@/]+@/, ':***@'), // маскируем пароль
          type: settings.aiProxy.type,
        },
      });
    } catch (e) {
      checks.push({
        name: 'Proxy (VPN)',
        status: 'error',
        message: e instanceof Error ? e.message : 'unknown',
        details: { url: settings.aiProxy.url.replace(/:[^:@/]+@/, ':***@') },
      });
    }
  } else {
    // Прямой IP без прокси
    try {
      const ipInfo = await getExternalIp(undefined);
      checks.push({
        name: 'Прямое подключение',
        status: 'ok',
        message: `IP: ${ipInfo.ip}${ipInfo.country ? ` (${ipInfo.country}${ipInfo.city ? `, ${ipInfo.city}` : ''})` : ''}`,
        details: { via: 'direct' },
      });
    } catch (e) {
      checks.push({
        name: 'Интернет',
        status: 'warning',
        message: `Не удалось определить внешний IP: ${e instanceof Error ? e.message : 'unknown'}`,
      });
    }
  }

  return NextResponse.json({ ok: true, checks });
}
