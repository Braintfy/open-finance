// PURPOSE: POST /api/admin/ai/vpn/subscription — скачать URL подписки и обновить
// кэш метаданных серверов (tenants.settings.aiVpn.servers — БЕЗ секретов).
// Фетч только по кнопке суперадмина (никаких кронов). SSRF-меры — в lib/ai/vpn/subscription.ts:
// только https, таймаут 10с, лимит 256KB, запрет приватных IP ПОСЛЕ резолва + пиннинг адреса.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import {
  fetchSubscription,
  SubscriptionFetchError,
  validateSubscriptionUrl,
} from '@/lib/ai/vpn/subscription';
import { maskSubscriptionUrl, parseSubscription, toPublicServer } from '@/lib/ai/vpn/vless';
import {
  decryptVpnSecret,
  encryptVpnSecret,
  getVpn,
  isVpnAdmin,
  loadTenantSettings,
  logVpnAction,
  saveTenantSettings,
  toPublicVpnState,
} from '@/lib/ai/vpn/admin';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BodySchema = z.object({
  /** Пусто/маска → перекачиваем сохранённый URL. */
  url: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
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
      key: `admin:ai:vpn:subscription:tenant:${session.tenantId}`,
      limit: 5,
      windowSec: 60,
    });
    if (!limit.ok) return rateLimitResponse(limit);

    const parsed = BodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Bad request' },
        { status: 400 },
      );
    }

    const settings = await loadTenantSettings(session.tenantId);
    const vpn = getVpn(settings);

    const incoming = (parsed.data.url ?? '').trim();
    const useStored = incoming === '' || incoming.includes('••••');
    const url = useStored ? decryptVpnSecret(vpn.subscriptionUrlEnc) : incoming;
    if (!url) {
      return NextResponse.json(
        {
          ok: false,
          error: useStored
            ? 'Сохранённого URL подписки нет (или его не удалось расшифровать) — введите URL'
            : 'Пустой URL подписки',
        },
        { status: 400 },
      );
    }

    // Валидация схемы/порта до любого обращения в сеть.
    try {
      validateSubscriptionUrl(url);
    } catch (e) {
      const message = e instanceof SubscriptionFetchError ? e.message : 'Некорректный URL';
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }

    let raw: string;
    let bytes = 0;
    let redirects = 0;
    try {
      const fetched = await fetchSubscription(url);
      raw = fetched.text;
      bytes = fetched.bytes;
      redirects = fetched.redirects;
    } catch (e) {
      const message =
        e instanceof SubscriptionFetchError ? e.message : 'Не удалось загрузить подписку';
      vpn.lastError = message.slice(0, 500);
      vpn.mode = 'subscription';
      settings.aiVpn = vpn;
      await saveTenantSettings(session.tenantId, settings);
      await logVpnAction({
        tenantId: session.tenantId,
        userId: session.userId,
        action: 'refresh_subscription',
        args: { url: maskSubscriptionUrl(url) },
        result: { ok: false, error: message },
      });
      return NextResponse.json({ ok: false, error: message }, { status: 502 });
    }

    const result = parseSubscription(raw);
    if (result.servers.length === 0) {
      const message = `В подписке нет валидных vless-ссылок (строк: ${result.totalLines}, пропущено: ${result.skipped})`;
      vpn.lastError = message;
      vpn.mode = 'subscription';
      vpn.subscriptionUrlEnc = encryptVpnSecret(url);
      settings.aiVpn = vpn;
      await saveTenantSettings(session.tenantId, settings);
      return NextResponse.json({ ok: false, error: message, details: result.errors }, { status: 422 });
    }

    vpn.mode = 'subscription';
    vpn.subscriptionUrlEnc = encryptVpnSecret(url);
    vpn.servers = result.servers.map(toPublicServer);
    vpn.lastFetchedAt = new Date().toISOString();
    vpn.lastError = undefined;
    // Если ранее выбранный сервер исчез — сбрасываем выбор.
    if (vpn.selectedServerId && !vpn.servers.some((s) => s.id === vpn.selectedServerId)) {
      vpn.selectedServerId = undefined;
    }
    settings.aiVpn = vpn;
    await saveTenantSettings(session.tenantId, settings);

    await logVpnAction({
      tenantId: session.tenantId,
      userId: session.userId,
      action: 'refresh_subscription',
      args: { url: maskSubscriptionUrl(url), redirects },
      result: {
        ok: true,
        servers: result.servers.length,
        skipped: result.skipped,
        encoding: result.encoding,
        bytes,
      },
    });

    return NextResponse.json({
      ok: true,
      servers: vpn.servers,
      skipped: result.skipped,
      encoding: result.encoding,
      warnings: result.errors,
      vpn: toPublicVpnState(settings),
    });
  } catch (e) {
    console.error('[api/admin/ai/vpn/subscription]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
