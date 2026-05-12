// PURPOSE: GET/POST /api/inbox/channels — manage tenant-wide inbox channels.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { createOrUpdateEmailChannel, listInboxChannels } from '@/lib/inbox/queries';

export const runtime = 'nodejs';

const EmailChannelBody = z.object({
  type: z.literal('email'),
  label: z.string().min(1).max(120),
  host: z.string().min(1).max(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().min(1).max(320),
  mailbox: z.string().min(1).max(120).default('INBOX'),
  password: z.string().max(1000).optional().default(''),
  blockId: z.string().min(1).max(100).optional(),
  pageKey: z.string().min(1).max(64).optional(),
});

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const blockId = url.searchParams.get('blockId') ?? undefined;
  const channels = await listInboxChannels(session.tenantId, blockId);
  return NextResponse.json({ ok: true, channels });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof EmailChannelBody>;
  try {
    body = EmailChannelBody.parse(await req.json());
  } catch (e) {
    const error = e instanceof z.ZodError ? e.issues[0]?.message : 'Invalid body';
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }

  try {
    const channel = await createOrUpdateEmailChannel({
      tenantId: session.tenantId,
      userId: session.userId,
      settings: {
        label: body.label,
        host: body.host,
        port: body.port,
        secure: body.secure,
        username: body.username,
        mailbox: body.mailbox,
        password: body.password,
        blockId: body.blockId,
        pageKey: body.pageKey,
      },
    });
    return NextResponse.json({ ok: true, channel });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Failed to save channel' },
      { status: 500 },
    );
  }
}
