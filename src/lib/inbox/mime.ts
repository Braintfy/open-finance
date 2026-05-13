// PURPOSE: Small MIME parser for IMAP-fetched email messages without external dependencies.
import { TextDecoder } from 'util';

type ParsedHeaders = Record<string, string>;

export type ParsedEmail = {
  messageId?: string;
  fromName?: string | null;
  fromAddress?: string | null;
  subject?: string | null;
  date?: Date | null;
  text: string;
};

export function parseEmail(raw: string): ParsedEmail {
  const normalized = raw.replace(/\r\n/g, '\n');
  const splitAt = normalized.indexOf('\n\n');
  const headerText = splitAt >= 0 ? normalized.slice(0, splitAt) : normalized;
  const bodyText = splitAt >= 0 ? normalized.slice(splitAt + 2) : '';
  const headers = parseHeaders(headerText);
  const contentType = headers['content-type'] ?? 'text/plain';
  const transferEncoding = headers['content-transfer-encoding'] ?? '';
  const text = extractBodyText(bodyText, contentType, transferEncoding);
  const from = parseAddress(decodeHeader(headers.from ?? ''));
  const date = headers.date ? new Date(headers.date) : null;

  return {
    messageId: stripAngles(headers['message-id']),
    fromName: from.name,
    fromAddress: from.address,
    subject: decodeHeader(headers.subject ?? '').trim() || null,
    date: date && Number.isFinite(date.getTime()) ? date : null,
    text,
  };
}

function parseHeaders(input: string): ParsedHeaders {
  const unfolded = input.replace(/\n[ \t]+/g, ' ');
  const headers: ParsedHeaders = {};
  for (const line of unfolded.split('\n')) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  return headers;
}

function extractBodyText(body: string, contentType: string, transferEncoding: string): string {
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (boundary) {
    const parts = body.split(`--${boundary}`);
    const plain = parts.find((part) => /content-type:\s*text\/plain/i.test(part));
    const html = parts.find((part) => /content-type:\s*text\/html/i.test(part));
    if (plain) return parsePartBody(plain);
    if (html) return stripHtml(parsePartBody(html));
  }
  const decoded = decodeTransfer(body, transferEncoding, getCharset(contentType));
  return contentType.toLowerCase().includes('text/html') ? stripHtml(decoded) : cleanupText(decoded);
}

function parsePartBody(part: string): string {
  const normalized = part.replace(/\r\n/g, '\n');
  const splitAt = normalized.indexOf('\n\n');
  if (splitAt < 0) return cleanupText(normalized);
  const headers = parseHeaders(normalized.slice(0, splitAt));
  return decodeTransfer(
    normalized.slice(splitAt + 2),
    headers['content-transfer-encoding'] ?? '',
    getCharset(headers['content-type'] ?? ''),
  );
}

function decodeTransfer(value: string, encoding: string, charset = 'utf-8'): string {
  const enc = encoding.toLowerCase();
  if (enc.includes('base64')) {
    try {
      return cleanupText(decodeBytes(Buffer.from(value.replace(/\s/g, ''), 'base64'), charset));
    } catch {
      return cleanupText(value);
    }
  }
  if (enc.includes('quoted-printable')) {
    return cleanupText(decodeBytes(decodeQuotedPrintable(value), charset));
  }
  return cleanupText(repairMojibake(value));
}

function decodeQuotedPrintable(value: string): Buffer {
  const softBreaks = value.replace(/=(?:\r\n|\n|\r)/g, '');
  const chunks: number[] = [];
  for (let i = 0; i < softBreaks.length; i += 1) {
    const char = softBreaks[i];
    const hex = softBreaks.slice(i + 1, i + 3);
    if (char === '=' && /^[0-9A-F]{2}$/i.test(hex)) {
      chunks.push(Number.parseInt(hex, 16));
      i += 2;
      continue;
    }
    chunks.push(...Buffer.from(char, 'utf8'));
  }
  return Buffer.from(chunks);
}

function decodeHeader(value: string): string {
  const decoded = value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (_m, charset: string, enc: string, data: string) =>
    decodeEncodedWord(charset, enc, data),
  );
  return repairMojibake(decoded);
}

function decodeEncodedWord(charset: string, encoding: string, data: string): string {
  try {
    const bytes =
      encoding.toLowerCase() === 'b'
        ? Buffer.from(data, 'base64')
        : decodeQuotedPrintable(data.replace(/_/g, ' '));
    return decodeBytes(bytes, charset);
  } catch {
    return data;
  }
}

function decodeBytes(bytes: Buffer, charset: string): string {
  const normalized = charset.toLowerCase().replace(/_/g, '-');
  try {
    if (normalized.includes('1251') || normalized.includes('windows-1251') || normalized.includes('cp1251')) {
      return new TextDecoder('windows-1251').decode(bytes);
    }
    if (normalized.includes('koi8-r')) {
      return new TextDecoder('koi8-r').decode(bytes);
    }
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return bytes.toString('utf8');
  }
}

function getCharset(contentType: string): string {
  return /charset="?([^";\s]+)"?/i.exec(contentType)?.[1] ?? 'utf-8';
}

function repairMojibake(value: string): string {
  if (!/[ÐÑ][\u0080-\u00BF]/.test(value) && !/[ÐÑ]/.test(value)) return value;
  try {
    const repaired = Buffer.from(value, 'latin1').toString('utf8');
    return countReplacementChars(repaired) <= countReplacementChars(value) ? repaired : value;
  } catch {
    return value;
  }
}

function countReplacementChars(value: string): number {
  return (value.match(/\uFFFD/g) ?? []).length;
}

function parseAddress(value: string): { name: string | null; address: string | null } {
  const match = value.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>/);
  if (match) {
    return {
      name: match[1]?.trim() || null,
      address: match[2]?.trim().toLowerCase() || null,
    };
  }
  const address = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? null;
  return { name: address ? value.replace(address, '').trim() || null : null, address };
}

function stripAngles(value: string | undefined): string | undefined {
  return value?.replace(/^<|>$/g, '').trim() || undefined;
}

function stripHtml(value: string): string {
  return cleanupText(
    value
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>'),
  );
}

function cleanupText(value: string): string {
  return value.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
