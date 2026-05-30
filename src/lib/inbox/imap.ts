// PURPOSE: Minimal IMAP connector for testing and syncing email into Inbox.
import net from 'net';
import tls from 'tls';
import { simpleParser, type AddressObject } from 'mailparser';
import type { InboxEmailSettings, ParsedInboxMessage } from './types';
import { cleanPreview } from './clean-text';

type SocketLike = net.Socket | tls.TLSSocket;

export type ImapSyncResult = {
  messages: ParsedInboxMessage[];
};

export async function testEmailConnection(settings: InboxEmailSettings): Promise<void> {
  const client = await connectWithProviderFallback(settings);
  try {
    await client.login(settings.username, settings.password);
    await client.selectMailbox(settings.mailbox || 'INBOX');
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export async function syncRecentEmailMessages(settings: InboxEmailSettings, limit = 25): Promise<ImapSyncResult> {
  const client = await connectWithProviderFallback(settings);
  try {
    await client.login(settings.username, settings.password);
    await client.selectMailbox(settings.mailbox || 'INBOX');
    const uids = await client.searchAllUids();
    const latest = uids.sort((a, b) => a - b).slice(-limit);
    if (latest.length === 0) return { messages: [] };
    const rawMessages = await client.fetchMessages(latest);
    /**
     * v0.24.4: переход с кастомного `mime.ts` на `mailparser.simpleParser`.
     * Прежний парсер не умел nested multipart → в DB сохранялся сырой MIME
     * с QP-кодировкой (`=D0=9D=...`) и видимыми `Content-Type: ...` /
     * `------=_Part_...` границами. simpleParser корректно обрабатывает
     * вложенные multipart/alternative/related/mixed, декодирует QP/base64,
     * учитывает charset из MIME headers и encoded-word'ы.
     */
    const messages = await Promise.all(
      rawMessages.map(async (item) => {
        const parsed = await simpleParser(item.raw);
        const messageId = parsed.messageId ?? null;
        const externalId = messageId || `uid:${settings.mailbox || 'INBOX'}:${item.uid}`;
        const from = parsed.from as AddressObject | undefined;
        const fromAddr = from?.value?.[0];
        const body = (parsed.text ?? '').trim();
        const bodyHtml = typeof parsed.html === 'string' && parsed.html.length > 0 ? parsed.html : null;
        return {
          externalId,
          senderName: fromAddr?.name?.trim() || null,
          senderAddress: fromAddr?.address?.trim() || null,
          subject: parsed.subject ?? null,
          preview: makePreview(body),
          body,
          bodyHtml,
          receivedAt: parsed.date ?? new Date(),
          metadata: {
            uid: item.uid,
            mailbox: settings.mailbox || 'INBOX',
            messageId,
          },
        } satisfies ParsedInboxMessage;
      }),
    );
    return { messages };
  } finally {
    await client.logout().catch(() => undefined);
  }
}

async function connectWithProviderFallback(settings: InboxEmailSettings): Promise<ImapClient> {
  try {
    return await ImapClient.connect(settings);
  } catch (error) {
    if (shouldRetryBegetStartTls(settings, error)) {
      return ImapClient.connect({ ...settings, port: 143, secure: false });
    }
    throw error;
  }
}

function shouldRetryBegetStartTls(settings: InboxEmailSettings, error: unknown): boolean {
  if (settings.host.toLowerCase() !== 'imap.beget.com') return false;
  if (!settings.secure || settings.port !== 993) return false;
  if (!(error instanceof Error)) return false;
  return error.message.includes('greeting timeout') || error.message.includes('connection timeout');
}

function makePreview(value: string): string {
  // Декодируем entities + срезаем preheader-набивку (`&zwnj;`/`&nbsp;`) до slice.
  return cleanPreview(value, 240);
}

class ImapClient {
  private tag = 0;
  private buffer = '';
  private waiters: Array<() => void> = [];
  private dataHandler = (chunk: string | Buffer) => {
    this.buffer += chunk.toString();
    this.waiters.splice(0).forEach((resolve) => resolve());
  };

  private constructor(private socket: SocketLike) {
    this.attachSocket(socket);
  }

  static async connect(settings: InboxEmailSettings): Promise<ImapClient> {
    const socket = await new Promise<SocketLike>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      const target = settings.secure
        ? tls.connect({ host: settings.host, port: settings.port, servername: settings.host }, () => resolve(target))
        : net.connect({ host: settings.host, port: settings.port }, () => resolve(target));
      target.once('error', onError);
      target.setTimeout(20_000, () => {
        target.destroy(new Error('IMAP connection timeout'));
      });
    });
    const client = new ImapClient(socket);
    await client.waitForGreeting();
    if (!settings.secure) {
      await client.upgradeToTls(settings.host);
    }
    return client;
  }

  private attachSocket(socket: SocketLike): void {
    socket.setEncoding('utf8');
    socket.on('data', this.dataHandler);
  }

  private detachSocket(): void {
    this.socket.off('data', this.dataHandler);
  }

  private async upgradeToTls(host: string): Promise<void> {
    await this.command('STARTTLS');
    this.detachSocket();
    this.buffer = '';
    this.socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const secureSocket = tls.connect(
        { socket: this.socket, servername: host, rejectUnauthorized: true },
        () => resolve(secureSocket),
      );
      secureSocket.once('error', reject);
      secureSocket.setTimeout(20_000, () => {
        secureSocket.destroy(new Error('IMAP STARTTLS timeout'));
      });
    });
    this.attachSocket(this.socket);
  }

  async login(username: string, password: string): Promise<void> {
    await this.command(`LOGIN ${quote(username)} ${quote(password)}`);
  }

  async selectMailbox(mailbox: string): Promise<void> {
    await this.command(`SELECT ${quote(mailbox)}`);
  }

  async searchAllUids(): Promise<number[]> {
    const response = await this.command('UID SEARCH ALL');
    const searchLine = response.split(/\r?\n/).find((line) => line.startsWith('* SEARCH'));
    if (!searchLine) return [];
    return searchLine
      .replace('* SEARCH', '')
      .trim()
      .split(/\s+/)
      .map((part) => Number.parseInt(part, 10))
      .filter((uid) => Number.isFinite(uid) && uid > 0);
  }

  async fetchMessages(uids: number[]): Promise<Array<{ uid: number; raw: string }>> {
    const messages: Array<{ uid: number; raw: string }> = [];
    for (const uid of uids) {
      const response = await this.command(`UID FETCH ${uid} (UID BODY.PEEK[])`, 90_000);
      messages.push(...parseFetchResponse(response));
    }
    return messages;
  }

  async logout(): Promise<void> {
    if (this.socket.destroyed) return;
    await this.command('LOGOUT').catch(() => undefined);
    this.socket.end();
  }

  private async waitForGreeting(): Promise<void> {
    await this.waitUntil(
      () => /^\* (OK|PREAUTH)/m.test(this.buffer),
      20_000,
      'IMAP greeting timeout. Сервер не прислал приветствие. Для Beget попробуйте порт 143 и выключите SSL/TLS: приложение выполнит STARTTLS перед логином.',
    );
    if (/^\* BYE/m.test(this.buffer)) throw new Error('IMAP server closed the connection');
    this.buffer = '';
  }

  private async command(command: string, timeoutMs = 20_000): Promise<string> {
    const tag = `A${String(++this.tag).padStart(4, '0')}`;
    this.socket.write(`${tag} ${command}\r\n`);
    await this.waitUntil(
      () => new RegExp(`^${tag} (OK|NO|BAD)`, 'm').test(this.buffer),
      timeoutMs,
      `IMAP ${command.split(' ')[0]} timeout`,
    );
    const response = this.buffer;
    this.buffer = '';
    const status = new RegExp(`^${tag} (OK|NO|BAD)(.*)$`, 'm').exec(response);
    if (!status || status[1] !== 'OK') {
      throw new Error(`IMAP ${command.split(' ')[0]} failed: ${status?.[2]?.trim() || 'unknown error'}`);
    }
    return response;
  }

  private async waitUntil(predicate: () => boolean, timeoutMs: number, message = 'IMAP timeout'): Promise<void> {
    const started = Date.now();
    while (!predicate()) {
      if (Date.now() - started > timeoutMs) throw new Error(message);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 100);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}

function parseFetchResponse(response: string): Array<{ uid: number; raw: string }> {
  const messages: Array<{ uid: number; raw: string }> = [];
  let cursor = 0;
  while (cursor < response.length) {
    const fetchStart = response.indexOf(' FETCH (', cursor);
    if (fetchStart < 0) break;
    const headerEnd = response.indexOf('\n', fetchStart);
    if (headerEnd < 0) break;
    const header = response.slice(fetchStart, headerEnd + 1);
    const uid = Number.parseInt(header.match(/UID (\d+)/)?.[1] ?? '', 10);
    const length = Number.parseInt(header.match(/BODY(?:\.PEEK)?\[\] \{(\d+)\}/)?.[1] ?? '', 10);
    if (!Number.isFinite(uid) || !Number.isFinite(length)) {
      cursor = headerEnd + 1;
      continue;
    }
    const start = headerEnd + 1;
    const endByTrailer = findFetchLiteralEnd(response, start);
    const raw = response.slice(start, endByTrailer ?? start + length);
    messages.push({ uid, raw });
    cursor = endByTrailer ?? start + length;
  }
  return messages;
}

function findFetchLiteralEnd(response: string, start: number): number | null {
  const tail = response.slice(start).search(/\r?\n\)\r?\nA\d{4} (?:OK|NO|BAD)/);
  return tail >= 0 ? start + tail : null;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
