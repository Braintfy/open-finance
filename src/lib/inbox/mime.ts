// PURPOSE: Small MIME parser for IMAP-fetched email messages without external dependencies.

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
  const decoded = decodeTransfer(body, transferEncoding);
  return contentType.toLowerCase().includes('text/html') ? stripHtml(decoded) : cleanupText(decoded);
}

function parsePartBody(part: string): string {
  const normalized = part.replace(/\r\n/g, '\n');
  const splitAt = normalized.indexOf('\n\n');
  if (splitAt < 0) return cleanupText(normalized);
  const headers = parseHeaders(normalized.slice(0, splitAt));
  return decodeTransfer(normalized.slice(splitAt + 2), headers['content-transfer-encoding'] ?? '');
}

function decodeTransfer(value: string, encoding: string): string {
  const enc = encoding.toLowerCase();
  if (enc.includes('base64')) {
    try {
      return cleanupText(Buffer.from(value.replace(/\s/g, ''), 'base64').toString('utf8'));
    } catch {
      return cleanupText(value);
    }
  }
  if (enc.includes('quoted-printable')) {
    return cleanupText(decodeQuotedPrintable(value));
  }
  return cleanupText(value);
}

function decodeQuotedPrintable(value: string): string {
  const softBreaks = value.replace(/=\n/g, '');
  return softBreaks.replace(/=([0-9A-F]{2})/gi, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

function decodeHeader(value: string): string {
  return value.replace(/=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g, (_m, charset: string, enc: string, data: string) => {
    const normalizedCharset = charset.toLowerCase();
    if (!normalizedCharset.includes('utf') && !normalizedCharset.includes('windows-1251')) {
      return data;
    }
    if (enc.toLowerCase() === 'b') {
      return Buffer.from(data, 'base64').toString(normalizedCharset.includes('1251') ? 'latin1' : 'utf8');
    }
    const qp = data.replace(/_/g, ' ').replace(/=([0-9A-F]{2})/gi, (_: string, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    return qp;
  });
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
