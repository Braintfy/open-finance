// PURPOSE: Server endpoint для импорта данных из блока unit.ozon-analytics
// в блок unit.my-store-table (v0.22.0).
//
// POST { sourceBlockId, sourcePageKey }
//   1. Загружает source-layout, находит блок (тип unit.ozon-analytics).
//   2. Парсит config (accountId + period preset/custom dates).
//   3. Резолвит период через resolvePeriod() в fromDate/toDateExclusive.
//   4. Зовёт существующий endpoint /api/marketplaces/analytics/ozon
//      (через absolute URL fetch на самого себя — Next.js routes
//      isolated; вызвать handler напрямую без mock'а Request тяжело).
//   5. Возвращает { rows, source: { accountId, periodPreset, ... } }.

import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/lib/auth';
import { loadLayout } from '@/lib/blocks/queries';
import {
  OzonAnalyticsBlockConfigSchema,
  resolvePeriod,
} from '@/lib/blocks/catalog/unit-ozon-analytics-types';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.tenantId || !session?.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ ok: false, error: 'Bad payload' }, { status: 400 });
  }
  const { sourceBlockId, sourcePageKey } = body as {
    sourceBlockId?: string;
    sourcePageKey?: string;
  };
  if (!sourceBlockId || !sourcePageKey) {
    return NextResponse.json(
      { ok: false, error: 'sourceBlockId and sourcePageKey required' },
      { status: 400 },
    );
  }

  const layout = await loadLayout({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey: sourcePageKey,
  });
  const sourceBlock = layout.blocks.find((b) => b.id === sourceBlockId);
  if (!sourceBlock) {
    return NextResponse.json({ ok: false, error: 'Source block not found' }, { status: 404 });
  }
  if (sourceBlock.type !== 'unit.ozon-analytics') {
    return NextResponse.json(
      { ok: false, error: 'Source block is not unit.ozon-analytics' },
      { status: 400 },
    );
  }

  const cfgParse = OzonAnalyticsBlockConfigSchema.safeParse(sourceBlock.config ?? {});
  if (!cfgParse.success) {
    return NextResponse.json(
      { ok: false, error: 'Source block config invalid' },
      { status: 400 },
    );
  }
  const cfg = cfgParse.data;
  if (!cfg.accountId) {
    return NextResponse.json(
      { ok: false, error: 'Source block has no Ozon account selected' },
      { status: 400 },
    );
  }

  const period = resolvePeriod(cfg.periodPreset, cfg.customFrom, cfg.customTo);

  // Strict same-origin fetch на собственный endpoint аналитики.
  const origin = new URL(req.url).origin;
  const params = new URLSearchParams({
    accountId: cfg.accountId,
    fromDate: period.msc.fromDate,
    toDateExclusive: period.msc.toDateExclusive,
  });
  const upstream = await fetch(`${origin}/api/marketplaces/analytics/ozon?${params}`, {
    // Передаём cookies сессии для аутентификации.
    headers: {
      cookie: req.headers.get('cookie') ?? '',
    },
  });
  if (!upstream.ok) {
    return NextResponse.json(
      { ok: false, error: `Analytics fetch failed: ${upstream.status}` },
      { status: 502 },
    );
  }
  const data = (await upstream.json()) as { ok: boolean; rows?: unknown[]; error?: string };
  if (!data.ok || !Array.isArray(data.rows)) {
    return NextResponse.json(
      { ok: false, error: data.error ?? 'Analytics response invalid' },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    rows: data.rows,
    source: {
      accountId: cfg.accountId,
      periodPreset: cfg.periodPreset,
      customFrom: cfg.customFrom,
      customTo: cfg.customTo,
    },
    fetchedAt: new Date().toISOString(),
  });
}
