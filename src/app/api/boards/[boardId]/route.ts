// PURPOSE: PUT/DELETE /api/boards/[boardId] — обновить/удалить доску
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { updateBoard, deleteBoard, getBoard } from '@/lib/boards/queries';
import { boardPageKey } from '@/lib/boards/queries';
import { deleteLayout } from '@/lib/blocks/queries';

const UpdateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  icon: z.string().max(40).nullable().optional(),
  accentColor: z.string().max(40).nullable().optional(),
  pinned: z.boolean().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { boardId } = await params;
  const board = await getBoard({
    tenantId: session.tenantId,
    userId: session.userId,
    boardId,
  });
  if (!board) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ ok: true, board });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { boardId } = await params;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const body = UpdateBody.safeParse(json);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? 'Bad request' },
      { status: 400 },
    );
  }

  const updated = await updateBoard({
    tenantId: session.tenantId,
    userId: session.userId,
    boardId,
    data: body.data,
  });

  if (!updated) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, board: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ boardId: string }> },
) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const { boardId } = await params;

  const deleted = await deleteBoard({
    tenantId: session.tenantId,
    userId: session.userId,
    boardId,
  });

  if (!deleted) {
    return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  // Также удаляем layout блоков этой доски
  try {
    await deleteLayout({
      tenantId: session.tenantId,
      userId: session.userId,
      pageKey: boardPageKey(boardId),
    });
  } catch {
    // layout может не существовать — это нормально
  }

  return NextResponse.json({ ok: true });
}
