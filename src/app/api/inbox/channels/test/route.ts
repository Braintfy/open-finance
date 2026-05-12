// PURPOSE: POST /api/inbox/channels/test — validate email IMAP settings without saving.
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { testEmailSettings } from '@/lib/inbox/queries';

export const runtime = 'nodejs';

const Body = z.object({
  type: z.literal('email'),
  label: z.string().max(120).optional().default('Почта'),
  host: z.string().min(1).max(200),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().min(1).max(320),
  mailbox: z.string().min(1).max(120).default('INBOX'),
  password: z.string().min(1).max(1000),
  blockId: z.string().min(1).max(100).optional(),
  pageKey: z.string().min(1).max(64).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    const error = e instanceof z.ZodError ? e.issues[0]?.message : 'Invalid body';
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }

  try {
    await testEmailSettings(body);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Не удалось подключиться к почте' },
      { status: 400 },
    );
  }
}
