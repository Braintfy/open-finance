// PURPOSE: CRUD запросы для досок (boards) — персональные рабочие пространства с BlockGrid
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { boards } from '@/lib/db/schema/boards';
import type { Board } from '@/lib/db/schema/boards';
export { boardPageKey } from './utils';

/** Получить все доски пользователя в порядке sortOrder */
export async function listBoards(args: {
  tenantId: string;
  userId: string;
}): Promise<Board[]> {
  return db
    .select()
    .from(boards)
    .where(
      and(
        eq(boards.tenantId, args.tenantId),
        eq(boards.userId, args.userId),
      ),
    )
    .orderBy(asc(boards.sortOrder), asc(boards.createdAt));
}

/** Получить одну доску по ID (с проверкой tenant + user) */
export async function getBoard(args: {
  tenantId: string;
  userId: string;
  boardId: string;
}): Promise<Board | undefined> {
  const [row] = await db
    .select()
    .from(boards)
    .where(
      and(
        eq(boards.id, args.boardId),
        eq(boards.tenantId, args.tenantId),
        eq(boards.userId, args.userId),
      ),
    )
    .limit(1);
  return row;
}

/** Создать новую доску. Автоматически ставит sortOrder = max + 1 */
export async function createBoard(args: {
  tenantId: string;
  userId: string;
  name?: string;
  icon?: string;
}): Promise<Board> {
  // Определяем следующий sortOrder
  const existing = await listBoards({
    tenantId: args.tenantId,
    userId: args.userId,
  });
  const maxOrder = existing.reduce((max, b) => Math.max(max, b.sortOrder), -1);

  const [board] = await db
    .insert(boards)
    .values({
      tenantId: args.tenantId,
      userId: args.userId,
      name: args.name ?? 'Новая доска',
      icon: args.icon ?? null,
      sortOrder: maxOrder + 1,
    })
    .returning();
  return board;
}

/** Обновить доску (name, icon, accentColor, pinned) */
export async function updateBoard(args: {
  tenantId: string;
  userId: string;
  boardId: string;
  data: {
    name?: string;
    icon?: string | null;
    accentColor?: string | null;
    pinned?: boolean;
  };
}): Promise<Board | undefined> {
  const [updated] = await db
    .update(boards)
    .set({
      ...args.data,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(boards.id, args.boardId),
        eq(boards.tenantId, args.tenantId),
        eq(boards.userId, args.userId),
      ),
    )
    .returning();
  return updated;
}

/** Удалить доску (блоки удалятся отдельно через deleteLayout) */
export async function deleteBoard(args: {
  tenantId: string;
  userId: string;
  boardId: string;
}): Promise<boolean> {
  const result = await db
    .delete(boards)
    .where(
      and(
        eq(boards.id, args.boardId),
        eq(boards.tenantId, args.tenantId),
        eq(boards.userId, args.userId),
      ),
    )
    .returning();
  return result.length > 0;
}

/** Обновить порядок досок */
export async function reorderBoards(args: {
  tenantId: string;
  userId: string;
  boardIds: string[];
}): Promise<void> {
  // Обновляем sortOrder по порядку в массиве
  await Promise.all(
    args.boardIds.map((id, index) =>
      db
        .update(boards)
        .set({ sortOrder: index, updatedAt: new Date() })
        .where(
          and(
            eq(boards.id, id),
            eq(boards.tenantId, args.tenantId),
            eq(boards.userId, args.userId),
          ),
        ),
    ),
  );
}

/** Получить только запиненные доски (для sidebar) */
export async function listPinnedBoards(args: {
  tenantId: string;
  userId: string;
}): Promise<Board[]> {
  return db
    .select()
    .from(boards)
    .where(
      and(
        eq(boards.tenantId, args.tenantId),
        eq(boards.userId, args.userId),
        eq(boards.pinned, true),
      ),
    )
    .orderBy(asc(boards.sortOrder), asc(boards.createdAt));
}

