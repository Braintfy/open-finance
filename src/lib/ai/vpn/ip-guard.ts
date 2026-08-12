// PURPOSE: SSRF-защита — pure-проверка «этот IP приватный/служебный?».
// Используется при фетче URL подписки: после DNS-резолва каждый адрес обязан быть
// публичным, иначе подписка может увести запрос на localhost / в приватную сеть.
// Чистый модуль без сети и БД — покрыт scripts/test-vless-parse.ts.

/** Разобрать IPv4 в 32-битное число. null — не IPv4. */
function parseIpv4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number.parseInt(part, 10);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

function inCidr(ip: number, base: string, bits: number): boolean {
  const baseNum = parseIpv4(base);
  if (baseNum === null) return false;
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ip & mask) === (baseNum & mask);
}

/** Диапазоны IPv4, куда приложению ходить нельзя (RFC1918/loopback/link-local/CGNAT/спец). */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (включая 169.254.169.254 — метаданные облаков)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

/**
 * Развернуть IPv6-литерал в РОВНО 8 групп по 16 бит (числами). null — не разбирается.
 * Поддерживает сокращение "::" (групп может быть <8). Смешанную точечную форму
 * (`::ffff:1.2.3.4`) НЕ обрабатывает — её ловит отдельная embedded-ветка в isPrivateIp.
 */
function expandIpv6Groups(ip: string): number[] | null {
  const s = ip.toLowerCase();
  if (!s.includes(':')) return null;
  // Точечная форма внутри — уже обработана выше по embedded-регэкспу, здесь не наша.
  if (s.includes('.')) return null;

  const halves = s.split('::');
  if (halves.length > 2) return null; // более одного "::" — невалидно

  const parseChunk = (chunk: string): number[] | null => {
    if (chunk === '') return [];
    const out: number[] = [];
    for (const g of chunk.split(':')) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };

  const head = parseChunk(halves[0] ?? '');
  if (head === null) return null;

  if (halves.length === 2) {
    const tail = parseChunk(halves[1] ?? '');
    if (tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    return [...head, ...new Array<number>(missing).fill(0), ...tail];
  }

  // Без "::" — обязаны быть ровно 8 групп.
  return head.length === 8 ? head : null;
}

/** true — адрес приватный/служебный, ходить туда запрещено. */
export function isPrivateIp(rawIp: string): boolean {
  const ip = rawIp.trim().replace(/^\[|\]$/g, '');
  if (!ip) return true;

  // Зона IPv6 (fe80::1%eth0) — отрезаем.
  const noZone = ip.split('%')[0] ?? ip;

  const v4 = parseIpv4(noZone);
  if (v4 !== null) {
    return BLOCKED_V4.some(([base, bits]) => inCidr(v4, base, bits));
  }

  const lower = noZone.toLowerCase();
  if (!lower.includes(':')) {
    // Не IP вовсе (имя хоста) — считаем небезопасным для этой проверки.
    return true;
  }

  // IPv4-mapped / IPv4-compatible / NAT64 — проверяем встроенный IPv4.
  const embedded = lower.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (embedded?.[1]) {
    if (isPrivateIp(embedded[1])) return true;
  }
  if (lower.startsWith('64:ff9b:')) return true; // NAT64 без встроенного v4 в конце

  if (lower === '::' || lower === '::1' || lower === '::0') return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true; // fe80::/10 link-local
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique-local
  if (/^ff[0-9a-f]{2}:/.test(lower)) return true; // ff00::/8 multicast
  if (lower.startsWith('2001:db8:')) return true; // документационный
  if (lower.startsWith('2002:')) {
    // 6to4 — встроенный IPv4 в первых двух группах.
    const groups = lower.split(':');
    const hex = `${groups[1] ?? ''}${(groups[2] ?? '').padStart(4, '0')}`;
    if (hex.length >= 8) {
      const n = Number.parseInt(hex.slice(0, 8), 16);
      if (Number.isFinite(n)) {
        const dotted = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
        if (isPrivateIp(dotted)) return true;
      }
    }
  }

  // IPv4-mapped (::ffff:0:0/96) и IPv4-compatible (::/96) в HEX-форме.
  // new URL('https://[::ffff:127.0.0.1]') нормализует hostname в '::ffff:7f00:1'
  // (и '::7f00:1' для compat) — точечная embedded-ветка выше такое не ловит.
  // Разворачиваем в 8 групп и вынимаем встроенный IPv4 из двух хвостовых групп.
  const groups = expandIpv6Groups(lower);
  if (groups) {
    const firstFiveZero =
      groups[0] === 0 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0 && groups[4] === 0;
    const isMapped = firstFiveZero && groups[5] === 0xffff;
    const isCompat = firstFiveZero && groups[5] === 0;
    if (isMapped || isCompat) {
      const low32 = ((((groups[6] ?? 0) << 16) | (groups[7] ?? 0)) >>> 0) as number;
      // Для '::' и '::1' в полной записи (0:0:0:0:0:0:0:1) сюда попадает 0.0.0.0/0.0.0.1 —
      // они лежат в 0.0.0.0/8 и корректно блокируются рекурсией, отдельный кейс не нужен.
      const dotted = [
        (low32 >>> 24) & 255,
        (low32 >>> 16) & 255,
        (low32 >>> 8) & 255,
        low32 & 255,
      ].join('.');
      if (isPrivateIp(dotted)) return true;
    }
  }

  return false;
}

/** Похоже ли на IP-литерал (а не на доменное имя). */
export function isIpLiteral(host: string): boolean {
  const h = host.trim().replace(/^\[|\]$/g, '');
  return parseIpv4(h) !== null || h.includes(':');
}
