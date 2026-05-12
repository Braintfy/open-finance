// PURPOSE: DELETE /api/inbox/channels/:channelId — remove a tenant inbox channel and messages.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { deleteInboxChannel } from '@/lib/inbox/queries';

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { channelId } = await params;
  const deleted = await deleteInboxChannel({ tenantId: session.tenantId, channelId });
  if (!deleted) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
