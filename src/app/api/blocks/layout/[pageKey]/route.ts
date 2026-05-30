// PURPOSE: GET/PUT /api/blocks/layout/[pageKey] — персональный layout страницы
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { loadLayout, saveLayout, deleteLayout } from '@/lib/blocks/queries';
import { getDefaultLayout } from '@/lib/blocks/registry';

const PageKey = z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i);

const AppearanceSchema = z
  .object({
    title: z.string().max(200).optional(),
    borderColor: z.string().max(40).optional(),
    accentColor: z.string().max(40).optional(),
    icon: z.string().max(40).optional(),
  })
  .optional();

const BlockRefSchema = z.object({
  blockId: z.string().min(1).max(64),
  pageKey: z.string().max(64).optional(),
  field: z.string().max(64).optional(),
  label: z.string().max(200).optional(),
});

const BlockDependenciesSchema = z
  .object({
    sources: z.array(BlockRefSchema).max(32),
    aggregation: z.enum(['sum', 'avg', 'min', 'max', 'count', 'formula', 'ai']),
  })
  .optional();

const BlockInstanceSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.string().min(1).max(64),
  x: z.number().int().min(0).max(50),
  y: z.number().int().min(0).max(1000),
  w: z.number().int().min(1).max(50),
  h: z.number().int().min(1).max(100),
  config: z.record(z.string(), z.unknown()).optional(),
  appearance: AppearanceSchema,
  dependencies: BlockDependenciesSchema,
  aiPrompt: z.string().max(8000).optional(),
  aiPromptSupplement: z.string().max(500).optional(),
  // Раскладка узла в режиме «Карта связей». Координаты canvas (px, могут быть < 0).
  // Без этого поля PUT вырезал бы mindmap-позиции (jsonb round-trip).
  mindmap: z
    .object({
      x: z.number().min(-100000).max(100000),
      y: z.number().min(-100000).max(100000),
      collapsed: z.boolean().optional(),
    })
    .optional(),
});

const PutBody = z.object({
  blocks: z.array(BlockInstanceSchema).max(100),
  hiddenSections: z.array(z.string().max(64)).max(50).optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ pageKey: string }> }
) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { pageKey: rawKey } = await params;
  const parseKey = PageKey.safeParse(rawKey);
  if (!parseKey.success) {
    return NextResponse.json({ ok: false, error: 'Invalid pageKey' }, { status: 400 });
  }
  const layout = await loadLayout({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey: parseKey.data,
  });
  return NextResponse.json({ ok: true, ...layout });
}

async function handleSave(
  req: Request,
  params: Promise<{ pageKey: string }>
) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { pageKey: rawKey } = await params;
  const parseKey = PageKey.safeParse(rawKey);
  if (!parseKey.success) {
    return NextResponse.json({ ok: false, error: 'Invalid pageKey' }, { status: 400 });
  }
  // sendBeacon отправляет Blob с типом application/json — поддерживаем и его, и обычный JSON
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    const text = await req.text();
    try {
      json = JSON.parse(text);
    } catch {
      return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
    }
  }
  const body = PutBody.safeParse(json);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? 'Bad request' },
      { status: 400 }
    );
  }
  await saveLayout({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey: parseKey.data,
    blocks: body.data.blocks,
    hiddenSections: body.data.hiddenSections,
  });
  return NextResponse.json({ ok: true });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ pageKey: string }> }
) {
  return handleSave(req, params);
}

// POST используется navigator.sendBeacon (он умеет только POST) для гарантированного
// сохранения при unload страницы. Семантически идентичен PUT.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ pageKey: string }> }
) {
  return handleSave(req, params);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ pageKey: string }> }
) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { pageKey: rawKey } = await params;
  const parseKey = PageKey.safeParse(rawKey);
  if (!parseKey.success) {
    return NextResponse.json({ ok: false, error: 'Invalid pageKey' }, { status: 400 });
  }
  await deleteLayout({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey: parseKey.data,
  });
  const defaults = getDefaultLayout(parseKey.data);
  return NextResponse.json({ ok: true, ...defaults });
}
