// PURPOSE: GET /api/admin/ai/vpn — состояние VLESS-настроек (замаскированное) + spool-инфо.
//          PATCH /api/admin/ai/vpn — включить/выключить использование VPN (без записи конфига).
// Гейт: super_admin (управление конфигом хоста). Секреты наружу не отдаются никогда.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import {
  isVpnAdmin,
  loadTenantSettings,
  saveTenantSettings,
  getVpn,
  toPublicVpnState,
  logVpnAction,
} from '@/lib/ai/vpn/admin';
import { getSpoolConfigPath, isSpoolWritable, readApplyStatus } from '@/lib/ai/vpn/spool';
import { XRAY_PROXY_URL } from '@/lib/ai/vpn/vless';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.tenantId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!isVpnAdmin(session.globalRole)) {
      return NextResponse.json(
        { ok: false, error: 'Управление VPN доступно только super_admin' },
        { status: 403 },
      );
    }

    const settings = await loadTenantSettings(session.tenantId);
    const [status, spoolWritable] = await Promise.all([readApplyStatus(), isSpoolWritable()]);

    return NextResponse.json({
      ok: true,
      vpn: toPublicVpnState(settings),
      spool: {
        path: getSpoolConfigPath(),
        writable: spoolWritable,
      },
      /** Статус применения с хоста (пишет of-xray-apply.sh). null — юниты не установлены. */
      hostStatus: status,
      proxy: {
        expectedUrl: XRAY_PROXY_URL,
        enabled: settings.aiProxy?.enabled ?? false,
        url: settings.aiProxy?.url ?? null,
      },
    });
  } catch (e) {
    console.error('[api/admin/ai/vpn GET]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}

const PatchSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(['link', 'subscription']).optional(),
});

export async function PATCH(req: Request) {
  try {
    const session = await auth();
    if (!session?.tenantId || !session.userId) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    if (!isVpnAdmin(session.globalRole)) {
      return NextResponse.json(
        { ok: false, error: 'Управление VPN доступно только super_admin' },
        { status: 403 },
      );
    }

    const limit = await rateLimit({
      key: `admin:ai:vpn:patch:tenant:${session.tenantId}`,
      limit: 20,
      windowSec: 60,
    });
    if (!limit.ok) return rateLimitResponse(limit);

    const parsed = PatchSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Bad request' },
        { status: 400 },
      );
    }

    const settings = await loadTenantSettings(session.tenantId);
    const vpn = getVpn(settings);

    if (parsed.data.mode !== undefined) vpn.mode = parsed.data.mode;
    if (parsed.data.enabled !== undefined) {
      vpn.enabled = parsed.data.enabled;
      // Выключение VPN не переписывает конфиг на хосте (это делает только apply),
      // но снимает маршрутизацию AI-запросов через локальный прокси.
      if (!parsed.data.enabled && settings.aiProxy?.url === XRAY_PROXY_URL) {
        settings.aiProxy = { ...settings.aiProxy, enabled: false };
      }
    }

    settings.aiVpn = vpn;
    await saveTenantSettings(session.tenantId, settings);

    await logVpnAction({
      tenantId: session.tenantId,
      userId: session.userId,
      action: 'toggle',
      args: { enabled: vpn.enabled, mode: vpn.mode },
      result: { ok: true },
    });

    return NextResponse.json({ ok: true, vpn: toPublicVpnState(settings) });
  } catch (e) {
    console.error('[api/admin/ai/vpn PATCH]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
