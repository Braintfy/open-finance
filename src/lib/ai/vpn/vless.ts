// PURPOSE: Ядро VLESS/Xray — pure-функции без БД и сети.
// parseVlessLink() — разбор vless:// (REALITY/TLS, транспорты tcp/ws/grpc, flow xtls-rprx-vision)
// parseSubscription() — base64- или plain-список ссылок → массив серверов (терпимо к мусору)
// buildXrayConfig() — полный конфиг Xray с http-inbound СТРОГО на 127.0.0.1:10809
// maskVlessLink()/maskSubscriptionUrl() — единственный разрешённый способ показать секрет наружу.
//
// ВАЖНО: наружу (клиенту, в логи, в audit) отдаётся только PublicVlessServer
// (label/host/port/fingerprint8). Сама ссылка и её uuid/ключи не покидают сервер.
//
// Smoke: pnpm tsx scripts/test-vless-parse.ts

import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Порт локального http-inbound Xray. Менять нельзя — на него завязан aiProxy и apply-скрипт. */
export const XRAY_HTTP_PORT = 10809;
/** Адрес локального http-inbound. Только loopback. */
export const XRAY_HTTP_LISTEN = '127.0.0.1';
/** URL прокси, который проставляется в tenant.settings.aiProxy после успешного apply. */
export const XRAY_PROXY_URL = `http://${XRAY_HTTP_LISTEN}:${XRAY_HTTP_PORT}`;

// ─────────────────────────── Схема результата парсинга ───────────────────────────

const NETWORKS = ['tcp', 'ws', 'grpc'] as const;
const SECURITIES = ['none', 'tls', 'reality'] as const;

/** utls-отпечаток TLS ClientHello (fp= в ссылке). */
const UTLS_FINGERPRINTS = [
  'chrome',
  'firefox',
  'safari',
  'ios',
  'android',
  'edge',
  '360',
  'qq',
  'random',
  'randomized',
] as const;

const UuidSchema = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'uuid должен быть в формате 8-4-4-4-12',
  );

export const VlessServerSchema = z
  .object({
    /** Стабильный id (первые 16 hex от fingerprint) — переживает refresh подписки. */
    id: z.string().length(16),
    /** Полный sha256-отпечаток параметров подключения. */
    fingerprint: z.string().length(64),
    /** Первые 8 символов отпечатка — единственное, что показываем в UI. */
    fingerprint8: z.string().length(8),
    label: z.string().min(1).max(120),
    host: z.string().min(1).max(255),
    port: z.number().int().min(1).max(65535),
    uuid: UuidSchema,
    encryption: z.literal('none'),
    flow: z.literal('xtls-rprx-vision').optional(),
    network: z.enum(NETWORKS),
    security: z.enum(SECURITIES),
    tls: z
      .object({
        sni: z.string().min(1).max(255).optional(),
        alpn: z.array(z.string().min(1).max(32)).max(4).optional(),
        utls: z.enum(UTLS_FINGERPRINTS).optional(),
        allowInsecure: z.boolean().optional(),
      })
      .optional(),
    reality: z
      .object({
        sni: z.string().min(1).max(255),
        publicKey: z.string().min(20).max(120),
        shortId: z.string().max(16).optional(),
        spiderX: z.string().max(200).optional(),
        utls: z.enum(UTLS_FINGERPRINTS),
      })
      .optional(),
    ws: z
      .object({
        path: z.string().min(1).max(500),
        host: z.string().max(255).optional(),
      })
      .optional(),
    grpc: z
      .object({
        serviceName: z.string().min(1).max(200),
        mode: z.enum(['gun', 'multi']),
      })
      .optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.security === 'reality' && !v.reality) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'security=reality требует секцию reality' });
    }
    if (v.security !== 'reality' && v.reality) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'секция reality без security=reality' });
    }
    if (v.network === 'ws' && !v.ws) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'network=ws требует секцию ws' });
    }
    if (v.network === 'grpc' && !v.grpc) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'network=grpc требует секцию grpc' });
    }
    if (v.flow && v.network !== 'tcp') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'flow=xtls-rprx-vision поддерживается только с network=tcp',
      });
    }
    if (v.flow && v.security === 'none') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'flow=xtls-rprx-vision требует TLS или REALITY',
      });
    }
  });

export type VlessServer = z.infer<typeof VlessServerSchema>;

/** Всё, что разрешено отдавать наружу (UI, audit-log, БД-кэш подписки). */
export type PublicVlessServer = {
  id: string;
  label: string;
  host: string;
  port: number;
  fingerprint8: string;
};

/** Ошибка разбора ссылки с человекочитаемым сообщением (безопасно показывать в UI). */
export class VlessParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VlessParseError';
  }
}

// ─────────────────────────── parseVlessLink ───────────────────────────

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function firstParam(sp: URLSearchParams, ...names: string[]): string | undefined {
  for (const n of names) {
    const v = sp.get(n);
    if (v !== null && v.trim() !== '') return v.trim();
  }
  return undefined;
}

function normalizeUtls(raw: string | undefined): (typeof UTLS_FINGERPRINTS)[number] | undefined {
  if (!raw) return undefined;
  const v = raw.toLowerCase();
  return (UTLS_FINGERPRINTS as readonly string[]).includes(v)
    ? (v as (typeof UTLS_FINGERPRINTS)[number])
    : undefined;
}

/** sha256 по канонической строке параметров подключения. */
function computeFingerprint(parts: (string | number | undefined)[]): string {
  return createHash('sha256').update(parts.map((p) => (p === undefined ? '' : String(p))).join('|')).digest('hex');
}

/**
 * Разобрать одну vless://-ссылку.
 * Бросает VlessParseError с понятным сообщением (без содержимого ссылки).
 */
export function parseVlessLink(rawLink: string): VlessServer {
  const link = rawLink.trim();
  if (!link) throw new VlessParseError('Пустая ссылка');
  if (link.length > 4000) throw new VlessParseError('Ссылка слишком длинная (>4000 символов)');
  if (!/^vless:\/\//i.test(link)) {
    throw new VlessParseError('Ссылка должна начинаться с vless:// (vmess/ss/trojan не поддерживаются)');
  }

  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new VlessParseError('Не удалось разобрать ссылку как URL');
  }

  const uuid = decodeURIComponent(url.username || '');
  if (!uuid) throw new VlessParseError('В ссылке нет UUID пользователя (vless://UUID@host:port)');

  const host = stripBrackets(url.hostname);
  if (!host) throw new VlessParseError('В ссылке нет адреса сервера');

  const port = Number.parseInt(url.port, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    throw new VlessParseError('Некорректный порт (ожидается 1..65535)');
  }

  const sp = url.searchParams;

  const encryption = (firstParam(sp, 'encryption') ?? 'none').toLowerCase();
  if (encryption !== 'none') {
    throw new VlessParseError(`VLESS поддерживает только encryption=none (получено: ${encryption})`);
  }

  const rawNetwork = (firstParam(sp, 'type', 'net') ?? 'tcp').toLowerCase();
  const networkAlias: Record<string, string> = { h2: 'http', xhttp: 'http', splithttp: 'http' };
  const network = networkAlias[rawNetwork] ?? rawNetwork;
  if (!(NETWORKS as readonly string[]).includes(network)) {
    throw new VlessParseError(
      `Транспорт "${rawNetwork}" не поддерживается. Доступны: tcp, ws, grpc`,
    );
  }

  const rawSecurity = (firstParam(sp, 'security') ?? 'none').toLowerCase();
  const security = rawSecurity === '' ? 'none' : rawSecurity;
  if (!(SECURITIES as readonly string[]).includes(security)) {
    throw new VlessParseError(
      `Тип шифрования "${rawSecurity}" не поддерживается. Доступны: none, tls, reality`,
    );
  }

  const headerType = (firstParam(sp, 'headerType') ?? 'none').toLowerCase();
  if (network === 'tcp' && headerType !== 'none') {
    throw new VlessParseError(`headerType=${headerType} (HTTP-обфускация TCP) не поддерживается`);
  }

  const flowRaw = firstParam(sp, 'flow');
  let flow: 'xtls-rprx-vision' | undefined;
  if (flowRaw) {
    const f = flowRaw.toLowerCase();
    // Некоторые панели дописывают -udp443 — трактуем как обычный vision.
    if (f === 'xtls-rprx-vision' || f === 'xtls-rprx-vision-udp443') flow = 'xtls-rprx-vision';
    else throw new VlessParseError(`flow="${flowRaw}" не поддерживается (только xtls-rprx-vision)`);
  }

  const sni = firstParam(sp, 'sni', 'peer');
  const utls = normalizeUtls(firstParam(sp, 'fp'));
  const alpnRaw = firstParam(sp, 'alpn');
  const alpn = alpnRaw
    ? alpnRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 4)
    : undefined;
  const allowInsecureRaw = firstParam(sp, 'allowInsecure');
  const allowInsecure =
    allowInsecureRaw === '1' || allowInsecureRaw?.toLowerCase() === 'true' ? true : undefined;

  const candidate: Record<string, unknown> = {
    uuid,
    host,
    port,
    encryption: 'none' as const,
    network,
    security,
    flow,
  };

  if (security === 'reality') {
    const publicKey = firstParam(sp, 'pbk', 'publicKey');
    if (!publicKey) throw new VlessParseError('REALITY требует параметр pbk (публичный ключ)');
    const realitySni = sni;
    if (!realitySni) throw new VlessParseError('REALITY требует параметр sni');
    candidate.reality = {
      sni: realitySni,
      publicKey,
      shortId: firstParam(sp, 'sid'),
      spiderX: firstParam(sp, 'spx'),
      // Xray требует fingerprint для REALITY; при отсутствии — chrome по умолчанию.
      utls: utls ?? 'chrome',
    };
  } else if (security === 'tls') {
    candidate.tls = {
      sni: sni ?? host,
      alpn,
      utls,
      allowInsecure,
    };
  }

  if (network === 'ws') {
    const path = firstParam(sp, 'path') ?? '/';
    candidate.ws = { path: path.startsWith('/') ? path : `/${path}`, host: firstParam(sp, 'host') };
  } else if (network === 'grpc') {
    const serviceName = firstParam(sp, 'serviceName', 'servicename');
    if (!serviceName) throw new VlessParseError('gRPC требует параметр serviceName');
    const mode = (firstParam(sp, 'mode') ?? 'gun').toLowerCase();
    candidate.grpc = { serviceName, mode: mode === 'multi' ? 'multi' : 'gun' };
  }

  const fingerprint = computeFingerprint([
    uuid,
    host,
    port,
    network,
    security,
    sni,
    firstParam(sp, 'pbk', 'publicKey'),
    firstParam(sp, 'sid'),
    firstParam(sp, 'path'),
    firstParam(sp, 'serviceName', 'servicename'),
    flow,
  ]);

  const fragment = url.hash ? safeDecode(url.hash.slice(1)) : '';
  const label = (fragment || `${host}:${port}`).slice(0, 120);

  const parsed = VlessServerSchema.safeParse({
    ...candidate,
    id: fingerprint.slice(0, 16),
    fingerprint,
    fingerprint8: fingerprint.slice(0, 8),
    label,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new VlessParseError(
      `Ссылка не прошла валидацию: ${issue?.message ?? 'неизвестная ошибка'}${
        issue?.path?.length ? ` (${issue.path.join('.')})` : ''
      }`,
    );
  }

  return parsed.data;
}

/** Декод фрагмента-метки + вычистка управляющих символов (лейбл идёт в UI). */
function safeDecode(s: string): string {
  // eslint-disable-next-line no-control-regex
  const CONTROL = /[\u0000-\u001F\u007F]/g;
  try {
    return decodeURIComponent(s).replace(CONTROL, '').trim();
  } catch {
    return s.replace(CONTROL, '').trim();
  }
}

/** Свести сервер к публичному виду (единственное, что уходит наружу). */
export function toPublicServer(s: VlessServer): PublicVlessServer {
  return { id: s.id, label: s.label, host: s.host, port: s.port, fingerprint8: s.fingerprint8 };
}

// ─────────────────────────── parseSubscription ───────────────────────────

export type SubscriptionParseResult = {
  servers: VlessServer[];
  /** Всего строк, похожих на ссылки (включая неподдерживаемые протоколы). */
  totalLines: number;
  /** Строк пропущено (мусор, другие протоколы, битые ссылки). */
  skipped: number;
  /** Первые несколько причин пропуска — для показа админу. */
  errors: string[];
  /** Формат исходника: подписка была base64 или plain-text. */
  encoding: 'base64' | 'plain';
};

const BASE64_RE = /^[A-Za-z0-9+/_-]+={0,2}$/;

/** Попытаться раскодировать base64/base64url. Возвращает null если это не base64. */
export function tryDecodeBase64(raw: string): string | null {
  const compact = raw.replace(/\s+/g, '');
  if (compact.length < 8 || !BASE64_RE.test(compact)) return null;
  try {
    const normalized = compact.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = Buffer.from(normalized, 'base64').toString('utf8');
    // Мусорный декод легко отличить: в валидной подписке есть схема протокола.
    if (!/:\/\//.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}

/**
 * Разобрать содержимое подписки: base64-блоб ИЛИ plain-text список ссылок.
 * Терпимо к мусору: неизвестные протоколы и битые строки просто пропускаются.
 */
export function parseSubscription(raw: string): SubscriptionParseResult {
  const text = (raw ?? '').trim();
  let body = text;
  let encoding: 'base64' | 'plain' = 'plain';

  if (!/vless:\/\//i.test(text)) {
    const decoded = tryDecodeBase64(text);
    if (decoded !== null) {
      body = decoded;
      encoding = 'base64';
    }
  }

  const lines = body
    .split(/\r?\n|\r/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));

  const servers: VlessServer[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  let skipped = 0;

  for (const line of lines) {
    if (!/^vless:\/\//i.test(line)) {
      skipped += 1;
      const scheme = line.split('://')[0];
      if (errors.length < 5 && line.includes('://')) {
        errors.push(`Протокол ${scheme?.slice(0, 12)} не поддерживается`);
      }
      continue;
    }
    try {
      const server = parseVlessLink(line);
      if (seen.has(server.fingerprint)) continue;
      seen.add(server.fingerprint);
      servers.push(server);
    } catch (e) {
      skipped += 1;
      if (errors.length < 5) {
        errors.push(e instanceof Error ? e.message : 'Неизвестная ошибка разбора');
      }
    }
  }

  return { servers, totalLines: lines.length, skipped, errors, encoding };
}

// ─────────────────────────── buildXrayConfig ───────────────────────────

export type XrayConfig = {
  log: { loglevel: string; access: 'none'; error: string };
  inbounds: Array<Record<string, unknown>>;
  outbounds: Array<Record<string, unknown>>;
  routing: Record<string, unknown>;
};

/**
 * Собрать полный конфиг Xray для одного VLESS-сервера.
 * Inbound — СТРОГО http на 127.0.0.1:httpPort (по умолчанию 10809), access-лог выключен.
 * Тот же инвариант проверяет deploy/xray/of-xray-apply.sh перед установкой.
 */
export function buildXrayConfig(
  server: VlessServer,
  opts: { httpPort?: number } = {},
): XrayConfig {
  const httpPort = opts.httpPort ?? XRAY_HTTP_PORT;
  if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) {
    throw new VlessParseError('httpPort должен быть 1..65535');
  }

  const streamSettings: Record<string, unknown> = {
    network: server.network,
    security: server.security,
  };

  if (server.security === 'tls') {
    const tls = server.tls ?? {};
    streamSettings.tlsSettings = {
      serverName: tls.sni ?? server.host,
      allowInsecure: tls.allowInsecure ?? false,
      ...(tls.alpn && tls.alpn.length > 0 ? { alpn: tls.alpn } : {}),
      ...(tls.utls ? { fingerprint: tls.utls } : {}),
    };
  } else if (server.security === 'reality' && server.reality) {
    streamSettings.realitySettings = {
      serverName: server.reality.sni,
      fingerprint: server.reality.utls,
      publicKey: server.reality.publicKey,
      shortId: server.reality.shortId ?? '',
      spiderX: server.reality.spiderX ?? '',
      show: false,
    };
  }

  if (server.network === 'ws' && server.ws) {
    streamSettings.wsSettings = {
      path: server.ws.path,
      ...(server.ws.host ? { headers: { Host: server.ws.host } } : {}),
    };
  } else if (server.network === 'grpc' && server.grpc) {
    streamSettings.grpcSettings = {
      serviceName: server.grpc.serviceName,
      multiMode: server.grpc.mode === 'multi',
    };
  }

  // flow валиден только для tcp+tls/reality (проверено схемой, дублируем защиту).
  const useFlow = server.flow && server.network === 'tcp' && server.security !== 'none';

  return {
    log: { loglevel: 'warning', access: 'none', error: '' },
    inbounds: [
      {
        tag: 'http-in',
        listen: XRAY_HTTP_LISTEN,
        port: httpPort,
        protocol: 'http',
        settings: { allowTransparent: false },
        sniffing: { enabled: true, destOverride: ['http', 'tls'] },
      },
    ],
    outbounds: [
      {
        tag: 'proxy',
        protocol: 'vless',
        settings: {
          vnext: [
            {
              address: server.host,
              port: server.port,
              users: [
                {
                  id: server.uuid,
                  encryption: 'none',
                  ...(useFlow ? { flow: server.flow } : {}),
                  level: 0,
                },
              ],
            },
          ],
        },
        streamSettings,
      },
      { tag: 'direct', protocol: 'freedom', settings: {} },
      { tag: 'block', protocol: 'blackhole', settings: {} },
    ],
    routing: {
      domainStrategy: 'AsIs',
      rules: [
        { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
        { type: 'field', network: 'tcp,udp', outboundTag: 'proxy' },
      ],
    },
  };
}

// ─────────────────────────── Маскирование секретов ───────────────────────────

/**
 * Замаскировать vless-ссылку для показа админу: остаётся только host:port.
 * Никогда не показываем uuid, pbk, sid, path.
 */
export function maskVlessLink(link: string): string {
  try {
    const s = parseVlessLink(link);
    return `vless://••••@${s.host}:${s.port} (${s.fingerprint8})`;
  } catch {
    return 'vless://••••';
  }
}

/** Замаскировать URL подписки: остаётся только схема+хост, путь и query скрыты. */
export function maskSubscriptionUrl(url: string): string {
  try {
    const u = new URL(url);
    const hasTail = (u.pathname && u.pathname !== '/') || u.search.length > 0;
    return `${u.protocol}//${u.host}${hasTail ? '/••••' : ''}`;
  } catch {
    return '••••';
  }
}
