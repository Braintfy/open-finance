// PURPOSE: GET /api/inbox/messages — tenant-scoped inbox message list for UI and blocks.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { listInboxMessages } from '@/lib/inbox/queries';

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const channelId = url.searchParams.get('channelId') ?? undefined;
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const query = url.searchParams.get('query') ?? undefined;
  const limit = Number(url.searchParams.get('limit') ?? '50');
  const offset = Number(url.searchParams.get('offset') ?? '0');
  const messages = await listInboxMessages({
    tenantId: session.tenantId,
    channelId,
    blockId,
    query,
    limit,
    offset,
  });
  return NextResponse.json({ ok: true, messages });
}
