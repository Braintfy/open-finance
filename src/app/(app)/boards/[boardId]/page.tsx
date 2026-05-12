// PURPOSE: /boards/[boardId] — отдельная доска с BlockGrid + таб-бар
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listBoards, getBoard, boardPageKey } from '@/lib/boards/queries';
import { loadLayout } from '@/lib/blocks/queries';
import { BoardClient } from './board-client';

export default async function BoardPage({
  params,
}: {
  params: Promise<{ boardId: string }>;
}) {
  const session = await auth();
  if (!session?.tenantId || !session.userId) redirect('/login');

  const { boardId } = await params;

  const [board, allBoards] = await Promise.all([
    getBoard({
      tenantId: session.tenantId,
      userId: session.userId,
      boardId,
    }),
    listBoards({
      tenantId: session.tenantId,
      userId: session.userId,
    }),
  ]);

  if (!board) {
    // Доска удалена или не найдена — перенаправляем к списку
    redirect('/boards');
  }

  const layout = await loadLayout({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey: boardPageKey(boardId),
  });

  return (
    <BoardClient
      tenantId={session.tenantId}
      board={board}
      allBoards={allBoards}
      initialBlocks={layout.blocks}
    />
  );
}
