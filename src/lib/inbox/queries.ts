// PURPOSE: Tenant-scoped CRUD and sync helpers for inbox channels/messages.
import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  inboxChannels,
  inboxMessages,
  type InboxChannel,
  type InboxEmailConfig,
} from '@/lib/db/schema/inbox';
import { decryptSecret, encryptSecret, maskSecret } from './crypto';
import { syncRecentEmailMessages, testEmailConnection } from './imap';
import type {
  InboxChannelDto,
  InboxEmailSettings,
  InboxMessageDto,
  InboxMessageQuery,
  ParsedInboxMessage,
} from './types';

export async function listInboxChannels(tenantId: string, blockId?: string): Promise<InboxChannelDto[]> {
  const filters = [
    eq(inboxChannels.tenantId, tenantId),
    blockId ? sql`${inboxChannels.config}->>'blockId' = ${blockId}` : undefined,
  ].filter(Boolean);
  const rows = await db
    .select()
    .from(inboxChannels)
    .where(and(...filters))
    .orderBy(inboxChannels.createdAt);
  return rows.map(toChannelDto);
}

export async function createOrUpdateEmailChannel(args: {
  tenantId: string;
  userId: string;
  settings: InboxEmailSettings;
}): Promise<InboxChannelDto> {
  const config: InboxEmailConfig = {
    host: args.settings.host,
    port: args.settings.port,
    secure: args.settings.secure,
    username: args.settings.username,
    mailbox: args.settings.mailbox || 'INBOX',
    blockId: args.settings.blockId,
    pageKey: args.settings.pageKey,
  };
  const [existing] = await db
    .select()
    .from(inboxChannels)
    .where(
      and(
        eq(inboxChannels.tenantId, args.tenantId),
        eq(inboxChannels.type, 'email'),
        sql`${inboxChannels.config}->>'blockId' = ${args.settings.blockId ?? ''}`,
      ),
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(inboxChannels)
      .set({
        label: args.settings.label,
        status: 'connected',
        config,
        secret: args.settings.password ? encryptSecret(args.settings.password) : existing.secret,
        updatedAt: new Date(),
      })
      .where(and(eq(inboxChannels.id, existing.id), eq(inboxChannels.tenantId, args.tenantId)))
      .returning();
    return toChannelDto(updated);
  }

  const [created] = await db
    .insert(inboxChannels)
    .values({
      tenantId: args.tenantId,
      createdBy: args.userId,
      type: 'email',
      label: args.settings.label,
      status: 'connected',
      config,
      secret: encryptSecret(args.settings.password),
    })
    .returning();
  return toChannelDto(created);
}

export async function testEmailSettings(settings: InboxEmailSettings): Promise<void> {
  await testEmailConnection(settings);
}

export async function syncInboxChannel(args: {
  tenantId: string;
  channelId: string;
  limit?: number;
}): Promise<{ inserted: number; totalCount: number }> {
  const channel = await getChannelForTenant(args.tenantId, args.channelId);
  if (!channel) throw new Error('Channel not found');
  if (channel.type !== 'email') throw new Error('Sync is not implemented for this channel');
  if (!channel.secret) throw new Error('Channel secret is missing');

  const config = channel.config as InboxEmailConfig;
  const result = await syncRecentEmailMessages(
    {
      label: channel.label,
      host: config.host,
      port: config.port,
      secure: config.secure,
      username: config.username,
      mailbox: config.mailbox || 'INBOX',
      password: decryptSecret(channel.secret),
    },
    args.limit ?? 50,
  );
  const inserted = await insertInboxMessages({
    tenantId: args.tenantId,
    channelId: channel.id,
    messages: result.messages,
  });
  const totalCount = await refreshChannelCount(args.tenantId, channel.id, 'connected');
  return { inserted, totalCount };
}

export async function deleteInboxChannel(args: {
  tenantId: string;
  channelId: string;
}): Promise<boolean> {
  const deleted = await db
    .delete(inboxChannels)
    .where(and(eq(inboxChannels.id, args.channelId), eq(inboxChannels.tenantId, args.tenantId)))
    .returning({ id: inboxChannels.id });
  return deleted.length > 0;
}

export async function listInboxMessages(query: InboxMessageQuery): Promise<InboxMessageDto[]> {
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 100);
  const offset = Math.max(query.offset ?? 0, 0);
  const blockChannels = query.blockId ? await listInboxChannels(query.tenantId, query.blockId) : [];
  const channelIds = blockChannels.map((channel) => channel.id);
  const filters = [
    eq(inboxMessages.tenantId, query.tenantId),
    query.channelId ? eq(inboxMessages.channelId, query.channelId) : undefined,
    query.blockId ? (channelIds.length > 0 ? inArray(inboxMessages.channelId, channelIds) : sql`false`) : undefined,
    query.query
      ? or(
          ilike(inboxMessages.subject, `%${query.query}%`),
          ilike(inboxMessages.senderName, `%${query.query}%`),
          ilike(inboxMessages.senderAddress, `%${query.query}%`),
          ilike(inboxMessages.preview, `%${query.query}%`),
        )
      : undefined,
  ].filter(Boolean);

  const rows = await db
    .select()
    .from(inboxMessages)
    .where(and(...filters))
    .orderBy(desc(inboxMessages.receivedAt))
    .limit(limit)
    .offset(offset);
  return rows.map((row) => ({
    id: row.id,
    channelId: row.channelId,
    externalId: row.externalId,
    senderName: row.senderName,
    senderAddress: row.senderAddress,
    subject: row.subject,
    preview: row.preview,
    body: row.body,
    bodyHtml: row.bodyHtml,
    receivedAt: row.receivedAt.toISOString(),
    metadata: row.metadata,
  }));
}

async function getChannelForTenant(tenantId: string, channelId: string): Promise<InboxChannel | null> {
  const [channel] = await db
    .select()
    .from(inboxChannels)
    .where(and(eq(inboxChannels.id, channelId), eq(inboxChannels.tenantId, tenantId)))
    .limit(1);
  return channel ?? null;
}

async function insertInboxMessages(args: {
  tenantId: string;
  channelId: string;
  messages: ParsedInboxMessage[];
}): Promise<number> {
  let inserted = 0;
  for (const message of args.messages) {
    const [existing] = await db
      .select({ id: inboxMessages.id })
      .from(inboxMessages)
      .where(
        and(
          eq(inboxMessages.tenantId, args.tenantId),
          eq(inboxMessages.channelId, args.channelId),
          eq(inboxMessages.externalId, message.externalId),
        ),
      )
      .limit(1);

    const values = {
      senderName: message.senderName ?? null,
      senderAddress: message.senderAddress ?? null,
      subject: message.subject ?? null,
      preview: message.preview ?? null,
      body: message.body ?? null,
      bodyHtml: message.bodyHtml ?? null,
      receivedAt: message.receivedAt,
      metadata: message.metadata ?? {},
    };

    if (existing) {
      await db
        .update(inboxMessages)
        .set(values)
        .where(and(eq(inboxMessages.id, existing.id), eq(inboxMessages.tenantId, args.tenantId)));
      continue;
    }

    const result = await db
      .insert(inboxMessages)
      .values({
        tenantId: args.tenantId,
        channelId: args.channelId,
        externalId: message.externalId,
        ...values,
      })
      .returning({ id: inboxMessages.id });
    if (result.length > 0) inserted += 1;
  }
  return inserted;
}

async function refreshChannelCount(
  tenantId: string,
  channelId: string,
  status: 'connected' | 'error',
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(inboxMessages)
    .where(and(eq(inboxMessages.tenantId, tenantId), eq(inboxMessages.channelId, channelId)));
  const totalCount = row?.value ?? 0;
  await db
    .update(inboxChannels)
    .set({ totalCount, status, lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(inboxChannels.id, channelId), eq(inboxChannels.tenantId, tenantId)));
  return totalCount;
}

function toChannelDto(channel: InboxChannel): InboxChannelDto {
  const config = channel.config as InboxEmailConfig;
  return {
    id: channel.id,
    type: channel.type,
    label: channel.label,
    status: channel.status,
    totalCount: channel.totalCount,
    lastSyncedAt: channel.lastSyncedAt?.toISOString() ?? null,
    config: {
      host: config.host,
      blockId: config.blockId,
      pageKey: config.pageKey,
      port: config.port,
      secure: config.secure,
      username: config.username,
      usernameMasked: maskSecret(config.username),
      mailbox: config.mailbox,
    },
    hasSecret: Boolean(channel.secret),
  };
}
