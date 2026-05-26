// PURPOSE: POST /api/inbox/channels/:channelId/sync — fetch recent channel messages.
import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { syncInboxChannel } from '@/lib/inbox/queries';

export const runtime = 'nodejs';

/**
 * Лимит по умолчанию повышен с 50 до 200 (v0.24.4) — при первом sync
 * после fix парсера (mailparser) старые письма перезаписываются через
 * upsert по `external_id`, поэтому больший лимит = больше писем удастся
 * починить за один проход без отдельного backfill-скрипта.
 *
 * Клиент может передать `?limit=N` (clamp 1..500) для ручного управления.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ channelId: string }> },
) {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { channelId } = await params;
  const url = new URL(req.url);
  const limitParam = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(Math.max(limitParam, 1), 500)
    : 200;
  try {
    const result = await syncInboxChannel({
      tenantId: session.tenantId,
      channelId,
      limit,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Sync failed' },
      { status: 400 },
    );
  }
}
