// PURPOSE: Smoke-тест ядра VLESS/Xray — parseVlessLink / parseSubscription /
// buildXrayConfig / маскирование / SSRF-гард приватных IP.
// Все ссылки СИНТЕТИЧЕСКИЕ (uuid и ключи выдуманы) — реальных секретов тут нет.
// Запуск: pnpm tsx scripts/test-vless-parse.ts

import {
  buildXrayConfig,
  maskSubscriptionUrl,
  maskVlessLink,
  parseSubscription,
  parseVlessLink,
  toPublicServer,
  tryDecodeBase64,
  VlessParseError,
  XRAY_HTTP_PORT,
} from '../src/lib/ai/vpn/vless';
import { isIpLiteral, isPrivateIp } from '../src/lib/ai/vpn/ip-guard';
import { validateSubscriptionUrl } from '../src/lib/ai/vpn/subscription';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertEq<T>(actual: T, expected: T, what: string) {
  if (actual !== expected) {
    throw new Error(`${what}: ожидалось ${JSON.stringify(expected)}, получено ${JSON.stringify(actual)}`);
  }
}

function assertThrows(fn: () => unknown, whatContains?: string) {
  let thrown: unknown = null;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  if (!thrown) throw new Error('ожидалась ошибка, но её не было');
  if (whatContains) {
    const msg = thrown instanceof Error ? thrown.message : String(thrown);
    if (!msg.includes(whatContains)) {
      throw new Error(`сообщение об ошибке не содержит "${whatContains}" (получено: "${msg}")`);
    }
  }
}

// ─── Синтетические ссылки (uuid/ключи выдуманы) ───────────────────────────────
const UUID = '11111111-2222-3333-4444-555555555555';
const PBK = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcdX';

const LINK_REALITY_TCP =
  `vless://${UUID}@reality.example.com:443` +
  `?type=tcp&security=reality&pbk=${PBK}&sid=0123abcd&sni=www.microsoft.com&fp=chrome&spx=%2F&flow=xtls-rprx-vision` +
  `#RE%20Reality%20TCP`;

const LINK_TLS_WS =
  `vless://${UUID}@ws.example.com:8443` +
  `?type=ws&security=tls&sni=ws.example.com&host=ws.example.com&path=%2Fvless-ws&alpn=h2%2Chttp%2F1.1&fp=firefox` +
  `#WS%20TLS`;

const LINK_TLS_GRPC =
  `vless://${UUID}@grpc.example.com:2053` +
  `?type=grpc&security=tls&sni=grpc.example.com&serviceName=of-grpc&mode=multi` +
  `#GRPC`;

const LINK_PLAIN_TCP = `vless://${UUID}@plain.example.com:80?type=tcp&security=none#Plain`;

console.log('\n=== VLESS core smoke tests ===\n');

// ─── 1. parseVlessLink: REALITY + TCP + vision ────────────────────────────────
test('1. REALITY/TCP/vision разбирается полностью', () => {
  const s = parseVlessLink(LINK_REALITY_TCP);
  assertEq(s.host, 'reality.example.com', 'host');
  assertEq(s.port, 443, 'port');
  assertEq(s.uuid, UUID, 'uuid');
  assertEq(s.network, 'tcp', 'network');
  assertEq(s.security, 'reality', 'security');
  assertEq(s.flow, 'xtls-rprx-vision', 'flow');
  assertEq(s.reality?.sni, 'www.microsoft.com', 'reality.sni');
  assertEq(s.reality?.publicKey, PBK, 'reality.publicKey');
  assertEq(s.reality?.shortId, '0123abcd', 'reality.shortId');
  assertEq(s.reality?.utls, 'chrome', 'reality.utls');
  assertEq(s.label, 'RE Reality TCP', 'label из #fragment');
  assertEq(s.fingerprint.length, 64, 'длина fingerprint');
  assertEq(s.fingerprint8, s.fingerprint.slice(0, 8), 'fingerprint8');
  assertEq(s.id, s.fingerprint.slice(0, 16), 'id');
  assert(s.tls === undefined, 'у reality не должно быть секции tls');
});

// ─── 2. parseVlessLink: TLS + WS ──────────────────────────────────────────────
test('2. TLS/WS разбирается (path, host-заголовок, alpn, fp)', () => {
  const s = parseVlessLink(LINK_TLS_WS);
  assertEq(s.network, 'ws', 'network');
  assertEq(s.security, 'tls', 'security');
  assertEq(s.ws?.path, '/vless-ws', 'ws.path');
  assertEq(s.ws?.host, 'ws.example.com', 'ws.host');
  assertEq(s.tls?.sni, 'ws.example.com', 'tls.sni');
  assertEq(s.tls?.utls, 'firefox', 'tls.utls');
  assertEq(s.tls?.alpn?.join(','), 'h2,http/1.1', 'tls.alpn');
  assert(s.flow === undefined, 'flow не задан');
});

// ─── 3. parseVlessLink: TLS + gRPC ────────────────────────────────────────────
test('3. TLS/gRPC разбирается (serviceName, multi-mode)', () => {
  const s = parseVlessLink(LINK_TLS_GRPC);
  assertEq(s.network, 'grpc', 'network');
  assertEq(s.grpc?.serviceName, 'of-grpc', 'grpc.serviceName');
  assertEq(s.grpc?.mode, 'multi', 'grpc.mode');
  assertEq(s.port, 2053, 'port');
});

// ─── 4. parseVlessLink: без TLS ───────────────────────────────────────────────
test('4. security=none разбирается, label по умолчанию = host:port при пустом #', () => {
  const s = parseVlessLink(LINK_PLAIN_TCP);
  assertEq(s.security, 'none', 'security');
  assert(s.tls === undefined && s.reality === undefined, 'нет tls/reality секций');
  const noLabel = parseVlessLink(`vless://${UUID}@plain.example.com:80`);
  assertEq(noLabel.label, 'plain.example.com:80', 'дефолтный label');
});

// ─── 5. Битые ссылки ──────────────────────────────────────────────────────────
test('5. Битые ссылки отвергаются с понятной причиной', () => {
  assertThrows(() => parseVlessLink(''), 'Пустая ссылка');
  assertThrows(() => parseVlessLink('https://example.com'), 'vless://');
  assertThrows(() => parseVlessLink('vmess://abcdef'), 'vless://');
  assertThrows(() => parseVlessLink(`vless://not-a-uuid@host.example.com:443`), 'валидацию');
  assertThrows(() => parseVlessLink(`vless://${UUID}@host.example.com:99999`)); // URL-парсер режет >65535
  assertThrows(() => parseVlessLink(`vless://${UUID}@host.example.com`), 'порт');
  assertThrows(() => parseVlessLink(`vless://@host.example.com:443`), 'UUID');
  // Неподдерживаемый транспорт
  assertThrows(
    () => parseVlessLink(`vless://${UUID}@h.example.com:443?type=kcp&security=tls`),
    'не поддерживается',
  );
  // REALITY без pbk
  assertThrows(
    () => parseVlessLink(`vless://${UUID}@h.example.com:443?security=reality&sni=a.example.com`),
    'pbk',
  );
  // REALITY без sni
  assertThrows(
    () => parseVlessLink(`vless://${UUID}@h.example.com:443?security=reality&pbk=${PBK}`),
    'sni',
  );
  // gRPC без serviceName
  assertThrows(
    () => parseVlessLink(`vless://${UUID}@h.example.com:443?type=grpc&security=tls&sni=a.example.com`),
    'serviceName',
  );
  // encryption != none
  assertThrows(
    () => parseVlessLink(`vless://${UUID}@h.example.com:443?encryption=aes-128-gcm`),
    'encryption=none',
  );
  // flow на ws — Xray такое не примет, ловим до записи spool
  assertThrows(
    () =>
      parseVlessLink(
        `vless://${UUID}@h.example.com:443?type=ws&security=tls&path=%2Fx&flow=xtls-rprx-vision`,
      ),
    'network=tcp',
  );
  // Ошибки — именно VlessParseError (роуты отдают их текст как 400)
  try {
    parseVlessLink('мусор');
  } catch (e) {
    assert(e instanceof VlessParseError, 'ожидался VlessParseError');
  }
});

// ─── 6. Подписка: base64 ──────────────────────────────────────────────────────
test('6. Подписка base64 разбирается, мусор пропускается', () => {
  const plain = [
    LINK_REALITY_TCP,
    'ss://bm90LXZsZXNz@ss.example.com:8388#Shadowsocks',
    LINK_TLS_WS,
    'совсем не ссылка',
    `vless://broken@no-port.example.com`,
    LINK_TLS_GRPC,
  ].join('\n');
  const b64 = Buffer.from(plain, 'utf8').toString('base64');

  const r = parseSubscription(b64);
  assertEq(r.encoding, 'base64', 'encoding');
  assertEq(r.servers.length, 3, 'валидных серверов');
  assert(r.skipped >= 3, `пропущено строк: ${r.skipped}`);
  assert(r.errors.length > 0, 'причины пропуска собраны');
  assertEq(r.servers[0]?.host, 'reality.example.com', 'первый сервер');
});

// ─── 7. Подписка: plain-text ──────────────────────────────────────────────────
test('7. Подписка plain-text (в т.ч. CRLF и комментарии) разбирается', () => {
  const plain = `# мой список\r\n${LINK_REALITY_TCP}\r\n\r\n${LINK_TLS_WS}\r\n// комментарий\r\n`;
  const r = parseSubscription(plain);
  assertEq(r.encoding, 'plain', 'encoding');
  assertEq(r.servers.length, 2, 'серверов');
});

// ─── 8. Подписка: дедупликация и пограничные случаи ───────────────────────────
test('8. Дубликаты схлопываются, пустая подписка не падает', () => {
  const r = parseSubscription([LINK_TLS_WS, LINK_TLS_WS, LINK_TLS_WS].join('\n'));
  assertEq(r.servers.length, 1, 'дубли схлопнуты');

  const empty = parseSubscription('');
  assertEq(empty.servers.length, 0, 'пустая подписка');
  assertEq(empty.skipped, 0, 'нечего пропускать');

  const garbage = parseSubscription('!!! не base64 и не ссылки !!!');
  assertEq(garbage.servers.length, 0, 'мусор не даёт серверов');

  assertEq(tryDecodeBase64('короткое'), null, 'не-base64 не декодируется');
  assert(tryDecodeBase64(Buffer.from(LINK_PLAIN_TCP).toString('base64')) !== null, 'base64 ссылки декодируется');
  // base64url (панели часто отдают именно его)
  const b64url = Buffer.from(LINK_PLAIN_TCP)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  assert(parseSubscription(b64url).servers.length === 1, 'base64url разбирается');
});

// ─── 9. buildXrayConfig: инварианты inbound/log ───────────────────────────────
test('9. buildXrayConfig: inbound строго 127.0.0.1:10809, log.access=none', () => {
  const s = parseVlessLink(LINK_REALITY_TCP);
  const cfg = buildXrayConfig(s, { httpPort: XRAY_HTTP_PORT });

  assertEq(cfg.log.access, 'none', 'log.access');
  assertEq(cfg.inbounds.length, 1, 'ровно один inbound');
  assertEq(cfg.inbounds[0]!.listen as string, '127.0.0.1', 'inbound.listen');
  assertEq(cfg.inbounds[0]!.port as number, 10809, 'inbound.port');
  assertEq(cfg.inbounds[0]!.protocol as string, 'http', 'inbound.protocol');
  // Дефолт порта — тот же
  assertEq(buildXrayConfig(s).inbounds[0]!.port as number, 10809, 'дефолтный порт');
  assert(!('api' in cfg), 'секции api быть не должно');
});

// ─── 10. buildXrayConfig: round-trip параметров ───────────────────────────────
test('10. buildXrayConfig: round-trip reality/ws/grpc', () => {
  type Vnext = { address: string; port: number; users: Array<Record<string, unknown>> };
  const outboundOf = (link: string) => {
    const cfg = buildXrayConfig(parseVlessLink(link));
    const ob = cfg.outbounds[0] as Record<string, unknown>;
    const settings = ob.settings as { vnext: Vnext[] };
    return { ob, vnext: settings.vnext[0]!, stream: ob.streamSettings as Record<string, unknown> };
  };

  const reality = outboundOf(LINK_REALITY_TCP);
  assertEq(reality.ob.protocol as string, 'vless', 'protocol');
  assertEq(reality.vnext.address, 'reality.example.com', 'vnext.address');
  assertEq(reality.vnext.port, 443, 'vnext.port');
  assertEq(reality.vnext.users[0]!.id as string, UUID, 'users[0].id');
  assertEq(reality.vnext.users[0]!.encryption as string, 'none', 'users[0].encryption');
  assertEq(reality.vnext.users[0]!.flow as string, 'xtls-rprx-vision', 'users[0].flow');
  assertEq(reality.stream.security as string, 'reality', 'stream.security');
  const rs = reality.stream.realitySettings as Record<string, unknown>;
  assertEq(rs.serverName as string, 'www.microsoft.com', 'realitySettings.serverName');
  assertEq(rs.publicKey as string, PBK, 'realitySettings.publicKey');
  assertEq(rs.shortId as string, '0123abcd', 'realitySettings.shortId');
  assertEq(rs.fingerprint as string, 'chrome', 'realitySettings.fingerprint');

  const ws = outboundOf(LINK_TLS_WS);
  assertEq(ws.stream.network as string, 'ws', 'stream.network');
  const wsS = ws.stream.wsSettings as { path: string; headers?: { Host?: string } };
  assertEq(wsS.path, '/vless-ws', 'wsSettings.path');
  assertEq(wsS.headers?.Host, 'ws.example.com', 'wsSettings.headers.Host');
  const tlsS = ws.stream.tlsSettings as Record<string, unknown>;
  assertEq(tlsS.serverName as string, 'ws.example.com', 'tlsSettings.serverName');
  assertEq((tlsS.alpn as string[]).join(','), 'h2,http/1.1', 'tlsSettings.alpn');
  assert(ws.vnext.users[0]!.flow === undefined, 'flow не должен попадать в ws');

  const grpc = outboundOf(LINK_TLS_GRPC);
  const gs = grpc.stream.grpcSettings as { serviceName: string; multiMode: boolean };
  assertEq(gs.serviceName, 'of-grpc', 'grpcSettings.serviceName');
  assertEq(gs.multiMode, true, 'grpcSettings.multiMode');

  // Конфиг должен быть сериализуем (его пишет spool.writeSpoolConfig)
  const json = JSON.stringify(buildXrayConfig(parseVlessLink(LINK_REALITY_TCP)));
  assert(JSON.parse(json).log.access === 'none', 'JSON round-trip');
});

// ─── 11. Маскирование секретов ────────────────────────────────────────────────
test('11. Маскирование: uuid и токены наружу не попадают', () => {
  const masked = maskVlessLink(LINK_REALITY_TCP);
  assert(!masked.includes(UUID), 'uuid не должен быть в маске');
  assert(!masked.includes(PBK), 'pbk не должен быть в маске');
  assert(masked.includes('reality.example.com:443'), 'host:port показываем');
  assertEq(maskVlessLink('мусор'), 'vless://••••', 'битая ссылка маскируется целиком');

  const url = 'https://panel.example.com/sub/SECRET-TOKEN-123?u=1';
  const maskedUrl = maskSubscriptionUrl(url);
  assert(!maskedUrl.includes('SECRET-TOKEN-123'), 'токен подписки не должен утекать');
  assertEq(maskedUrl, 'https://panel.example.com/••••', 'маска URL подписки');
  assertEq(maskSubscriptionUrl('https://panel.example.com'), 'https://panel.example.com', 'URL без пути');
  assertEq(maskSubscriptionUrl('не url'), '••••', 'битый URL');

  const pub = toPublicServer(parseVlessLink(LINK_REALITY_TCP));
  assertEq(Object.keys(pub).sort().join(','), 'fingerprint8,host,id,label,port', 'поля PublicVlessServer');
});

// ─── 12. SSRF-гард: приватные адреса ──────────────────────────────────────────
test('12. isPrivateIp блокирует loopback/приватные/метаданные', () => {
  for (const ip of [
    '127.0.0.1',
    '127.255.255.254',
    '0.0.0.0',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // метаданные облаков
    '100.64.0.1', // CGNAT
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fd00::1',
    'fc00::abcd',
    'ff02::1',
    '::ffff:127.0.0.1',
    // IPv4-mapped/compat в HEX-форме (именно так new URL нормализует [::ffff:127.0.0.1]).
    '::ffff:7f00:1', // 127.0.0.1
    '::ffff:a9fe:a9fe', // 169.254.169.254 — метаданные облаков
    '::7f00:1', // ::127.0.0.1 (IPv4-compatible)
    '::ffff:c0a8:1', // 192.168.0.1
    // Несжатые формы: полагаться на нормализацию new URL нельзя — isPrivateIp
    // вызывается и на сырых адресах из DNS-резолва.
    '0:0:0:0:0:0:0:1', // тот же ::1
    '0:0:0:0:0:ffff:7f00:1', // тот же ::ffff:127.0.0.1
    '2001:db8::1',
  ]) {
    assert(isPrivateIp(ip), `${ip} должен считаться приватным`);
  }

  for (const ip of ['1.1.1.1', '8.8.8.8', '95.161.1.1', '172.32.0.1', '2606:4700:4700::1111']) {
    assert(!isPrivateIp(ip), `${ip} должен считаться публичным`);
  }

  assert(isPrivateIp('example.com'), 'доменное имя не проходит IP-проверку');
  assert(isIpLiteral('1.2.3.4') && isIpLiteral('[::1]'), 'IP-литералы распознаются');
  assert(!isIpLiteral('example.com'), 'домен — не IP-литерал');
});

// ─── 13. SSRF-гард: валидация URL подписки (без сети) ─────────────────────────
test('13. validateSubscriptionUrl пропускает только безопасные https-URL', () => {
  assertThrows(() => validateSubscriptionUrl('http://panel.example.com/sub'), 'https');
  assertThrows(() => validateSubscriptionUrl('file:///etc/passwd'), 'https');
  assertThrows(() => validateSubscriptionUrl('ftp://panel.example.com/sub'), 'https');
  assertThrows(() => validateSubscriptionUrl('https://u:p@panel.example.com/sub'), 'логином');
  assertThrows(() => validateSubscriptionUrl('https://panel.example.com:9999/sub'), 'Порт');
  assertThrows(() => validateSubscriptionUrl('https://127.0.0.1/sub'), 'приватную сеть');
  assertThrows(() => validateSubscriptionUrl('https://169.254.169.254/meta'), 'приватную сеть');
  assertThrows(() => validateSubscriptionUrl('https://[::1]/sub'), 'приватную сеть');
  assertThrows(() => validateSubscriptionUrl(''), 'Пустой');
  assertThrows(() => validateSubscriptionUrl('не url'), 'Некорректный');

  for (const url of [
    'https://panel.example.com/sub/token',
    'https://panel.example.com:2053/sub',
    'https://panel.example.com:8443/sub?u=1',
  ]) {
    assertEq(validateSubscriptionUrl(url).protocol, 'https:', `${url} должен проходить`);
  }
});

// ─── 14. SSRF-гард: IPv4-mapped/compat IPv6-литералы через полный URL-путь ─────
test('14. validateSubscriptionUrl блокирует IPv4-mapped/compat IPv6 (new URL нормализует в hex)', () => {
  // Каждый литерал проверяем именно через validateSubscriptionUrl — так же, как это
  // делает роут: new URL(...) нормализует hostname в hex-форму (::ffff:7f00:1 и т.п.),
  // и гард обязан заблокировать loopback/приватку/метаданные.
  for (const literal of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::7f00:1', '::ffff:c0a8:1']) {
    assertThrows(
      () => validateSubscriptionUrl(`https://[${literal}]:8443/sub`),
      'приватную сеть',
    );
  }
  // Для контроля: и dotted-форма, которую new URL нормализует в hex, тоже блокируется.
  assertThrows(() => validateSubscriptionUrl('https://[::ffff:127.0.0.1]:8443/sub'), 'приватную сеть');

  // Легитимный публичный IPv6 НЕ блокируется.
  assertEq(
    validateSubscriptionUrl('https://[2606:4700:4700::1111]:8443/sub').protocol,
    'https:',
    'публичный IPv6 должен проходить',
  );
});

console.log(`\n=== Итог: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed > 0 ? 1 : 0);
