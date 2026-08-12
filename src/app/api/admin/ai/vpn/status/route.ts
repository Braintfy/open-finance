// PURPOSE: GET /api/admin/ai/vpn/status — честный статус VPN: что записал web-процесс
// (appliedFingerprint/appliedAt), что отчитался хост (status.json от of-xray-apply.sh)
// и внешний IP через локальный http-inbound Xray (?checkIp=1, медленно ~5с).
// Гейт: super_admin. Ссылки/URL наружу не отдаются.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { rateLimit, rateLimitResponse } from '@/lib/rate-limit';
import { getExternalIp } from '@/lib/ai/providers/proxy';
import {
  getVpn,
  isVpnAdmin,
  loadTenantSettings,
  localXrayProxyConfig,
  toPublicVpnState,
} from '@/lib/ai/vpn/admin';
import { getSpoolConfigPath, isSpoolWritable, readApplyStatus } from '@/lib/ai/vpn/spool';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(req: Request) {
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

    const checkIp = new URL(req.url).searchParams.get('checkIp') === '1';
    if (checkIp) {
      const limit = await rateLimit({
        key: `admin:ai:vpn:checkip:tenant:${session.tenantId}`,
        limit: 10,
        windowSec: 60,
      });
      if (!limit.ok) return rateLimitResponse(limit);
    }

    const settings = await loadTenantSettings(session.tenantId);
    const vpn = getVpn(settings);
    const [hostStatus, spoolWritable] = await Promise.all([readApplyStatus(), isSpoolWritable()]);

    // Расхождение «что просили» vs «что реально стоит на хосте».
    const drift =
      !!vpn.appliedFingerprint &&
      !!hostStatus?.fingerprint &&
      hostStatus.fingerprint !== vpn.appliedFingerprint;

    let externalIp: { ip: string; country?: string; city?: string; via: string } | null = null;
    let externalIpError: string | null = null;
    if (checkIp) {
      try {
        externalIp = await getExternalIp(localXrayProxyConfig());
      } catch (e) {
        externalIpError = e instanceof Error ? e.message : 'Не удалось определить внешний IP';
      }
    }

    return NextResponse.json({
      ok: true,
      vpn: toPublicVpnState(settings),
      spool: { path: getSpoolConfigPath(), writable: spoolWritable },
      hostStatus,
      /** true — на хосте применён другой конфиг, чем последний записанный (нужен повтор apply). */
      drift,
      externalIp,
      externalIpError,
    });
  } catch (e) {
    console.error('[api/admin/ai/vpn/status]', e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 },
    );
  }
}
