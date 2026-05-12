// PURPOSE: GET /api/boards — список досок, POST /api/boards — создать доску
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { listBoards, createBoard } from '@/lib/boards/queries';

export async function GET() {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const boards = await listBoards({
    tenantId: session.tenantId,
    userId: session.userId,
  });

  return NextResponse.json({ ok: true, boards });
}

const CreateBody = z.object({
  name: z.string().min(1).max(200).optional(),
  icon: z.string().max(40).optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = {};
  }

  const body = CreateBody.safeParse(json);
  if (!body.success) {
    return NextResponse.json(
      { ok: false, error: body.error.issues[0]?.message ?? 'Bad request' },
      { status: 400 },
    );
  }

  const board = await createBoard({
    tenantId: session.tenantId,
    userId: session.userId,
    name: body.data.name,
    icon: body.data.icon,
  });

  return NextResponse.json({ ok: true, board }, { status: 201 });
}
