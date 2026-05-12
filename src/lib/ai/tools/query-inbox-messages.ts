// PURPOSE: Read-only AI tool for querying tenant-scoped inbox messages.
import { z } from 'zod';
import type { Tool } from '@/lib/ai/types';
import { listInboxMessages } from '@/lib/inbox/queries';

export const queryInboxMessagesTool: Tool = {
  name: 'query_inbox_messages',
  description: 'Найти последние сообщения из Входящих по каналам коммуникаций tenant-а.',
  parameters: z.object({
    channelId: z.string().uuid().optional(),
    blockId: z.string().max(100).optional(),
    query: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  handler: async (args, ctx) => {
    return listInboxMessages({
      tenantId: ctx.tenantId,
      channelId: args.channelId,
      blockId: args.blockId,
      query: args.query,
      limit: args.limit,
    });
  },
};
