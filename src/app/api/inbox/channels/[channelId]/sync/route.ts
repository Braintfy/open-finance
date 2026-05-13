// PURPOSE: POST /api/inbox/channels/:channelId/sync — fetch recent channel messages.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { syncInboxChannel } from '@/lib/inbox/queries';

export const runtime = 'nodejs';

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { channelId } = await params;
  try {
    const result = await syncInboxChannel({
      tenantId: session.tenantId,
      channelId,
      limit: 50,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Sync failed' },
      { status: 400 },
    );
  }
}
