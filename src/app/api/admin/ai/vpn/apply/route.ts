// PURPOSE: POST /api/admin/ai/vpn/apply — применить конфиг Xray.
// Два режима:
//   { mode:'link', link? }         — разобрать vless://-ссылку (или переприменить сохранённую);
//   { mode:'subscription', serverId } — перекачать подписку и применить выбранный сервер.
// Web-процесс ТОЛЬКО пишет spool-конфиг (0600); установку делает root-овый systemd
// path-юнит (deploy/xray/of-xray-apply.path). sudo/exec у приложения нет.
// Гейт: super_admin + rateLimit + ai_audit_log. Ссылка наружу не возвращается.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import {
  buildXrayConfig,
  parseSubscription,
  parseVlessLink,
  toPublicServer,
  VlessParseError,
  type VlessServer,
} from '@/lib/ai/vpn/vless';
import { fetchSubscription, SubscriptionFetchError } from '@/lib/ai/vpn/subscription';
import { writeSpoolConfig } from '@/lib/ai/vpn/spool';
import {
  decryptVpnSecret,
  encryptVpnSecret,
  getVpn,
  isVpnAdmin,
  loadTenantSettings,
  logVpnAction,
  saveTenantSettings,
  toPublicVpnState,
  wireUpProxyAfterApply,
} from '@/lib/ai/vpn/admin';

export const runtime = 'nodejs';
export const maxDuration = 30;

const BodySchema = z.union([
  z.object({
    mode: z.literal('link'),
    /** Пусто/маска → переприменяем сохранённую ссылку. */
    link: z.string().max(4000).optional(),
  }),
  z.object({
    mode: z.literal('subscription'),
    serverId: z.string().min(8).max(64),
  }),
]);

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
      key: `admin:ai:vpn:apply:tenant:${session.tenantId}`,
      limit: 10,
      windowSec: 60,
    });
    if (!limit.ok) return rateLimitResponse(limit);

    const parsed = BodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message ?? 'Bad request' },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const settings = await loadTenantSettings(session.tenantId);
    const vpn = getVpn(settings);

    // ── 1. Получить сервер для применения ────────────────────────────────
    let server: VlessServer;
    let linkToStore: string | null = null;

    if (body.mode === 'link') {
      const incoming = (body.link ?? '').trim();
      const useStored = incoming === '' || incoming.includes('••••');
      const link = useStored ? decryptVpnSecret(vpn.linkEnc) : incoming;
      if (!link) {
        return NextResponse.json(
          {
            ok: false,
            error: useStored
              ? 'Сохранённой ссылки нет (или её не удалось расшифровать) — вставьте vless://-ссылку'
              : 'Пустая ссылка',
          },
          { status: 400 },
        );
      }
      try {
        server = parseVlessLink(link);
      } catch (e) {
        const message = e instanceof VlessParseError ? e.message : 'Не удалось разобрать ссылку';
        await persistError(session.tenantId, settings, message);
        return NextResponse.json({ ok: false, error: message }, { status: 400 });
      }
      linkToStore = link;
    } else {
      const subUrl = decryptVpnSecret(vpn.subscriptionUrlEnc);
      if (!subUrl) {
        return NextResponse.json(
          { ok: false, error: 'URL подписки не сохранён — сначала «Обновить список»' },
          { status: 400 },
        );
      }
      // Секретные ссылки серверов НЕ хранятся (в кэше только метаданные),
      // поэтому подписка перекачивается на каждое применение — по кнопке админа.
      let raw: string;
      try {
        raw = (await fetchSubscription(subUrl)).text;
      } catch (e) {
        const message =
          e instanceof SubscriptionFetchError ? e.message : 'Не удалось загрузить подписку';
        await persistError(session.tenantId, settings, message);
        return NextResponse.json({ ok: false, error: message }, { status: 502 });
      }
      const result = parseSubscription(raw);
      const found = result.servers.find((s) => s.id === body.serverId);
      if (!found) {
        const message = 'Выбранный сервер исчез из подписки — обновите список';
        await persistError(session.tenantId, settings, message);
        return NextResponse.json({ ok: false, error: message }, { status: 409 });
      }
      server = found;
      // Заодно освежаем кэш метаданных (список мог поменяться).
      vpn.servers = result.servers.map(toPublicServer);
      vpn.lastFetchedAt = new Date().toISOString();
      // Кладём обратно сразу — иначе persistError на следующем шаге потеряет кэш.
      settings.aiVpn = vpn;
    }

    // ── 2. Собрать конфиг и записать spool ───────────────────────────────
    const config = buildXrayConfig(server);
    const requestedAt = new Date().toISOString();
    try {
      await writeSpoolConfig(config, {
        fingerprint: server.fingerprint,
        server: `${server.host}:${server.port}`,
        requestedAt,
        requestedBy: session.userId,
        tenantId: session.tenantId,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Не удалось записать spool-конфиг';
      await persistError(session.tenantId, settings, message);
      await logVpnAction({
        tenantId: session.tenantId,
        userId: session.userId,
        action: body.mode === 'link' ? 'apply_link' : 'apply_server',
        args: { host: server.host, port: server.port, fingerprint8: server.fingerprint8 },
        result: { ok: false, error: message },
      });
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }

    // ── 3. Сохранить настройки + UX-обвязку прокси ───────────────────────
    vpn.enabled = true;
    vpn.mode = body.mode;
    if (linkToStore) vpn.linkEnc = encryptVpnSecret(linkToStore);
    if (body.mode === 'subscription') vpn.selectedServerId = server.id;
    vpn.appliedFingerprint = server.fingerprint;
    vpn.appliedAt = requestedAt;
    vpn.appliedServer = {
      label: server.label,
      host: server.host,
      port: server.port,
      fingerprint8: server.fingerprint8,
    };
    vpn.lastError = undefined;
    settings.aiVpn = vpn;

    const wiring = await wireUpProxyAfterApply(session.tenantId, settings);
    await saveTenantSettings(session.tenantId, settings);

    await logVpnAction({
      tenantId: session.tenantId,
      userId: session.userId,
      action: body.mode === 'link' ? 'apply_link' : 'apply_server',
      args: {
        mode: body.mode,
        host: server.host,
        port: server.port,
        network: server.network,
        security: server.security,
        fingerprint8: server.fingerprint8,
      },
      result: { ok: true, ...wiring },
    });

    return NextResponse.json({
      ok: true,
      /** Конфиг записан в spool; фактическое применение — асинхронно на хосте. */
      pending: true,
      server: toPublicServer(server),
      wiring,
      vpn: toPublicVpnState(settings),
    });
  } catch (e) {
    console.error('[api/admin/ai/vpn/apply]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}

/** Записать lastError в настройки, не роняя основной ответ. */
async function persistError(
  tenantId: string,
  settings: Awaited<ReturnType<typeof loadTenantSettings>>,
  message: string,
): Promise<void> {
  try {
    const vpn = getVpn(settings);
    vpn.lastError = message.slice(0, 500);
    settings.aiVpn = vpn;
    await saveTenantSettings(tenantId, settings);
  } catch (e) {
    console.error('[vpn] persistError failed:', e instanceof Error ? e.message : e);
  }
}
