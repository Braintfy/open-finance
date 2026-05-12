// PURPOSE: Shared inbox DTOs for API, UI blocks, and channel connectors.
import type { InboxChannelStatus, InboxChannelType } from '@/lib/db/schema/inbox';

export type InboxEmailSettings = {
  label: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  mailbox: string;
  password: string;
  blockId?: string;
  pageKey?: string;
};

export type InboxChannelDto = {
  id: string;
  type: InboxChannelType;
  label: string;
  status: InboxChannelStatus;
  totalCount: number;
  lastSyncedAt: string | null;
  config: {
    blockId?: string;
    pageKey?: string;
    host?: string;
    port?: number;
    secure?: boolean;
    username?: string;
    mailbox?: string;
    usernameMasked?: string;
  };
  hasSecret: boolean;
};

export type InboxMessageDto = {
  id: string;
  channelId: string;
  externalId: string;
  senderName: string | null;
  senderAddress: string | null;
  subject: string | null;
  preview: string | null;
  body: string | null;
  receivedAt: string;
  metadata: Record<string, unknown>;
};

export type ParsedInboxMessage = {
  externalId: string;
  senderName?: string | null;
  senderAddress?: string | null;
  subject?: string | null;
  preview?: string | null;
  body?: string | null;
  receivedAt: Date;
  metadata?: Record<string, unknown>;
};

export type InboxMessageQuery = {
  tenantId: string;
  channelId?: string;
  blockId?: string;
  limit?: number;
  offset?: number;
  query?: string;
};
