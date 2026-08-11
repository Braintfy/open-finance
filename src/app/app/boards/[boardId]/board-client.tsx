// PURPOSE: BoardClient — таб-бар досок + BlockGrid для активной доски
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Pin,
  PinOff,
  MoreHorizontal,
  Trash2,
  Pencil,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { BlockGrid } from '@/components/blocks/block-grid';
import type { BlockInstance } from '@/lib/blocks/types';
import type { Board } from '@/lib/db/schema/boards';
import { boardPageKey } from '@/lib/boards/utils';
import { SectionAiButton } from '@/components/blocks/section-ai-button';

type Props = {
  tenantId: string;
  board: Board;
  allBoards: Board[];
  initialBlocks: BlockInstance[];
  /**
   * Кабинет раскладки доски. Доски ОБЩИЕ между кабинетами → это всегда
   * default-кабинет (см. isSharedPageKey). Передаём явно, чтобы отложенный
   * save не зависел от куки активного кабинета.
   */
  workspaceId?: string;
};

export function BoardClient({
  tenantId,
  board,
  allBoards,
  initialBlocks,
  workspaceId,
}: Props) {
  const router = useRouter();
  const [boards, setBoards] = useState<Board[]>(allBoards);
  const [currentBoard, setCurrentBoard] = useState<Board>(board);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Board | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync when props change (navigation)
  useEffect(() => {
    setBoards(allBoards);
    setCurrentBoard(board);
  }, [board, allBoards]);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleCreate = useCallback(async () => {
    setCreating(true);
    try {
      const res = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Новая доска' }),
      });
      const data = await res.json();
      if (data.ok && data.board) {
        router.push(`/app/boards/${data.board.id}`);
        router.refresh();
      }
    } finally {
      setCreating(false);
    }
  }, [router]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    const res = await fetch(`/api/boards/${deleteTarget.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.ok) {
      const remaining = boards.filter((b) => b.id !== deleteTarget.id);
      setBoards(remaining);
      setDeleteTarget(null);
      if (deleteTarget.id === currentBoard.id) {
        // Переходим к следующей доске или к пустому состоянию
        if (remaining.length > 0) {
          router.push(`/app/boards/${remaining[0].id}`);
        } else {
          router.push('/app/boards');
        }
        router.refresh();
      }
    }
    setDeleteTarget(null);
  }, [deleteTarget, boards, currentBoard.id, router]);

  const handleRename = useCallback(
    async (boardId: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) {
        setEditingId(null);
        return;
      }
      const res = await fetch(`/api/boards/${boardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (data.ok && data.board) {
        setBoards((prev) =>
          prev.map((b) => (b.id === boardId ? data.board : b)),
        );
        if (boardId === currentBoard.id) {
          setCurrentBoard(data.board);
        }
      }
      setEditingId(null);
    },
    [currentBoard.id],
  );

  const handleTogglePin = useCallback(
    async (b: Board) => {
      const res = await fetch(`/api/boards/${b.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pinned: !b.pinned }),
      });
      const data = await res.json();
      if (data.ok && data.board) {
        setBoards((prev) =>
          prev.map((x) => (x.id === b.id ? data.board : x)),
        );
        if (b.id === currentBoard.id) {
          setCurrentBoard(data.board);
        }
        router.refresh();
      }
    },
    [currentBoard.id, router],
  );

  const startEdit = useCallback((b: Board) => {
    setEditingId(b.id);
    setEditName(b.name);
  }, []);

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">
            Мои доски
          </h1>
          <p className="text-xs text-muted-foreground">
            Персональные рабочие пространства с блоками
          </p>
        </div>
        <div className="shrink-0">
          <SectionAiButton
            pageKey={boardPageKey(currentBoard.id)}
            pageLabel={currentBoard.name ?? 'Доска'}
          />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-border/60">
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto pb-px scrollbar-none">
          {boards.map((b) => {
            const isActive = b.id === currentBoard.id;
            const isEditing = editingId === b.id;

            return (
              <div
                key={b.id}
                className={`group relative flex shrink-0 items-center gap-1 rounded-t-md px-2.5 py-1.5 text-[13px] transition-colors ${
                  isActive
                    ? 'border-b-2 border-primary bg-background text-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {isEditing ? (
                  <input
                    ref={inputRef}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleRename(b.id, editName)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(b.id, editName);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="h-5 w-24 rounded border border-border bg-background px-1 text-[13px] outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (!isActive) router.push(`/app/boards/${b.id}`);
                    }}
                    onDoubleClick={() => startEdit(b)}
                    className="max-w-[140px] truncate"
                  >
                    {b.pinned && (
                      <Pin className="mr-1 inline h-3 w-3 text-muted-foreground/60" />
                    )}
                    {b.name}
                  </button>
                )}

                {/* Context menu */}
                {isActive && !isEditing && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-44">
                      <DropdownMenuItem onClick={() => startEdit(b)}>
                        <Pencil className="mr-2 h-3.5 w-3.5" />
                        Переименовать
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleTogglePin(b)}>
                        {b.pinned ? (
                          <>
                            <PinOff className="mr-2 h-3.5 w-3.5" />
                            Открепить
                          </>
                        ) : (
                          <>
                            <Pin className="mr-2 h-3.5 w-3.5" />
                            Закрепить в меню
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setDeleteTarget(b)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Удалить
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            );
          })}
        </div>

        <Button
          variant="ghost"
          size="icon-sm"
          className="mb-px shrink-0"
          onClick={handleCreate}
          disabled={creating}
          title="Создать доску"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* BlockGrid */}
      <BlockGrid
        pageKey={boardPageKey(currentBoard.id)}
        tenantId={tenantId}
        workspaceId={workspaceId}
        initialBlocks={initialBlocks}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить доску</AlertDialogTitle>
            <AlertDialogDescription>
              Доска «{deleteTarget?.name}» и все её блоки будут удалены безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
