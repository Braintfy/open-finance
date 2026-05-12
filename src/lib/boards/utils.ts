// PURPOSE: Утилиты для досок — общие между клиентом и сервером

/** Хелпер: pageKey для доски */
export function boardPageKey(boardId: string): string {
  return `board-${boardId}`;
}
