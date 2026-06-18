// PURPOSE: /boards — список досок, redirect на первую или пустое состояние
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listBoards } from '@/lib/boards/queries';
import { BoardsEmptyClient } from './boards-empty-client';

export default async function BoardsPage() {
  const session = await auth();
  if (!session?.tenantId || !session.userId) redirect('/login');

  const allBoards = await listBoards({
    tenantId: session.tenantId,
    userId: session.userId,
  });

  // Если есть доски — переходим к первой
  if (allBoards.length > 0) {
    redirect(`/app/boards/${allBoards[0].id}`);
  }

  // Пустое состояние — предложить создать первую
  return <BoardsEmptyClient />;
}
