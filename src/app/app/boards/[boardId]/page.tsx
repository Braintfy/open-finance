// PURPOSE: /boards/[boardId] — отдельная доска с BlockGrid + таб-бар
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listBoards, getBoard, boardPageKey } from '@/lib/boards/queries';
import { loadLayout } from '@/lib/blocks/queries';
import { getPageWorkspaceScope } from '@/lib/workspaces/active';
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
    redirect('/app/boards');
  }

  // Доски ОБЩИЕ между кабинетами → раскладка всегда из default-кабинета
  // (isSharedPageKey('board-*') === true).
  const pageKey = boardPageKey(boardId);
  const scope = await getPageWorkspaceScope(session.tenantId, session.userId, pageKey);
  const layout = await loadLayout({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey,
    workspaceId: scope.workspaceId,
    workspaceTemplate: scope.template,
  });

  return (
    <BoardClient
      tenantId={session.tenantId}
      board={board}
      allBoards={allBoards}
      workspaceId={scope.workspaceId}
      initialBlocks={layout.blocks}
    />
  );
}
