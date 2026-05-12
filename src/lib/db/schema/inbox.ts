// PURPOSE: Inbox channels and messages for AI-readable communication intake.
import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { tenants } from './tenants';
import { users } from './users';

export type InboxChannelType = 'email' | 'telegram';
export type InboxChannelStatus = 'connected' | 'error' | 'disconnected';

export type InboxEmailConfig = {
  blockId?: string;
  pageKey?: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  mailbox: string;
};

export type InboxTelegramConfig = {
  username?: string;
};

export type InboxChannelConfig = InboxEmailConfig | InboxTelegramConfig | Record<string, unknown>;

export const inboxChannels = pgTable(
  'inbox_channels',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 20 }).$type<InboxChannelType>().notNull(),
    label: varchar('label', { length: 120 }).notNull(),
    status: varchar('status', { length: 20 }).$type<InboxChannelStatus>().notNull().default('disconnected'),
    config: jsonb('config').$type<InboxChannelConfig>().notNull().default({}),
    secret: text('secret'),
    totalCount: integer('total_count').notNull().default(0),
    lastSyncedAt: timestamp('last_synced_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('inbox_channels_tenant_idx').on(t.tenantId),
    index('inbox_channels_tenant_type_idx').on(t.tenantId, t.type),
  ],
);

export const inboxMessages = pgTable(
  'inbox_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => inboxChannels.id, { onDelete: 'cascade' }),
    externalId: varchar('external_id', { length: 300 }).notNull(),
    senderName: varchar('sender_name', { length: 200 }),
    senderAddress: varchar('sender_address', { length: 320 }),
    subject: varchar('subject', { length: 500 }),
    preview: varchar('preview', { length: 500 }),
    body: text('body'),
    receivedAt: timestamp('received_at').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('inbox_messages_tenant_received_idx').on(t.tenantId, t.receivedAt),
    index('inbox_messages_channel_idx').on(t.channelId),
    uniqueIndex('inbox_messages_channel_external_idx').on(t.channelId, t.externalId),
  ],
);

export type InboxChannel = typeof inboxChannels.$inferSelect;
export type NewInboxChannel = typeof inboxChannels.$inferInsert;
export type InboxMessage = typeof inboxMessages.$inferSelect;
export type NewInboxMessage = typeof inboxMessages.$inferInsert;
