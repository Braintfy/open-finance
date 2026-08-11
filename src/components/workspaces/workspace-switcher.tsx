// PURPOSE: Переключатель кабинетов (воркспейсов) в шапке приложения.
// Список кабинетов, переименование (Dialog), создание (пустой / клон текущего /
// из шаблона), удаление (AlertDialog). Смена активного = POST /api/workspace/active
// (httpOnly-кука + users.settings) → router.refresh(), после чего RSC перечитывают
// раскладки уже из нового кабинета, а BlockGrid ремоунтится по key={workspaceId+pageKey}.
//
// Серверные ошибки (нельзя удалить последний/default) показываем текстом из ответа.
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronsUpDown, Copy, Layers, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { cn } from '@/lib/utils';

export type WorkspaceSwitcherItem = {
  id: string;
  name: string;
  isDefault: boolean;
};

export type WorkspaceTemplateOption = {
  id: string;
  label: string;
  description: string;
};

type CreateMode = 'template' | 'clone';

export function WorkspaceSwitcher({
  workspaces,
  activeId,
  templates,
}: {
  workspaces: WorkspaceSwitcherItem[];
  activeId: string;
  templates: WorkspaceTemplateOption[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [renameFor, setRenameFor] = useState<WorkspaceSwitcherItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleteFor, setDeleteFor] = useState<WorkspaceSwitcherItem | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createMode, setCreateMode] = useState<CreateMode>('template');
  const [createTemplate, setCreateTemplate] = useState<string>(
    templates[0]?.id ?? 'seller-ozon',
  );

  const active = workspaces.find((w) => w.id === activeId) ?? workspaces[0];
  const locked = busy || pending;

  async function readError(res: Response): Promise<string> {
    try {
      const data = (await res.json()) as { error?: string };
      return data.error || 'Не удалось выполнить действие';
    } catch {
      return 'Не удалось выполнить действие';
    }
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function switchTo(id: string) {
    // Осознанно НЕ проверяем `locked`: switchTo вызывается и из submitCreate,
    // где busy уже true (переключиться в только что созданный кабинет надо).
    // От двойных кликов защищает disabled на триггере.
    if (id === activeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workspace/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: id }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      refresh();
    } catch {
      setError('Сеть недоступна');
    } finally {
      setBusy(false);
    }
  }

  async function submitRename() {
    const target = renameFor;
    const name = renameValue.trim();
    if (!target || !name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${target.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      setRenameFor(null);
      refresh();
    } catch {
      setError('Сеть недоступна');
    } finally {
      setBusy(false);
    }
  }

  async function submitCreate() {
    const name = createName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          createMode === 'clone'
            ? { name, cloneFromWorkspaceId: activeId }
            : { name, template: createTemplate },
        ),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const data = (await res.json()) as { workspace?: { id: string } };
      setShowCreate(false);
      setCreateName('');
      // Сразу переключаемся в созданный кабинет (внутри — refresh()).
      if (data.workspace?.id) {
        await switchTo(data.workspace.id);
      } else {
        refresh();
      }
    } catch {
      setError('Сеть недоступна');
    } finally {
      setBusy(false);
    }
  }

  async function submitDelete() {
    const target = deleteFor;
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${target.id}`, { method: 'DELETE' });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      setDeleteFor(null);
      refresh();
    } catch {
      setError('Сеть недоступна');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 max-w-[220px] gap-1.5 px-2 text-xs font-medium"
            disabled={locked}
          >
            <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{active?.name ?? 'Кабинет'}</span>
            <ChevronsUpDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Кабинеты
          </DropdownMenuLabel>
          {workspaces.map((w) => (
            <DropdownMenuItem
              key={w.id}
              className="gap-2"
              onSelect={(e) => {
                e.preventDefault();
                void switchTo(w.id);
              }}
            >
              <Check
                className={cn(
                  'h-3.5 w-3.5 shrink-0',
                  w.id === activeId ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span className="min-w-0 flex-1 truncate">{w.name}</span>
              <span
                role="button"
                tabIndex={0}
                aria-label={`Переименовать ${w.name}`}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setRenameValue(w.name);
                  setRenameFor(w);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    setRenameValue(w.name);
                    setRenameFor(w);
                  }
                }}
              >
                <Pencil className="h-3 w-3" />
              </span>
              {!w.isDefault && workspaces.length > 1 && (
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Удалить ${w.name}`}
                  className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteFor(w);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteFor(w);
                    }
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </span>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="gap-2"
            onSelect={(e) => {
              e.preventDefault();
              setCreateMode('template');
              setCreateName('');
              setShowCreate(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            Новый кабинет
          </DropdownMenuItem>
          <DropdownMenuItem
            className="gap-2"
            onSelect={(e) => {
              e.preventDefault();
              setCreateMode('clone');
              setCreateName(active ? `${active.name} (копия)` : 'Копия');
              setShowCreate(true);
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            Копия текущего
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && (
        <span className="truncate text-[11px] text-destructive" role="alert">
          {error}
        </span>
      )}

      {/* Переименование */}
      <Dialog
        open={renameFor !== null}
        onOpenChange={(open) => {
          if (!open) setRenameFor(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Переименовать кабинет</DialogTitle>
            <DialogDescription>
              Имя видно только вам — раскладки страниц не меняются.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="workspace-rename">Название</Label>
            <Input
              id="workspace-rename"
              value={renameValue}
              maxLength={120}
              autoFocus
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setRenameFor(null)}>
              Отмена
            </Button>
            <Button
              size="sm"
              disabled={locked || !renameValue.trim()}
              onClick={() => void submitRename()}
            >
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Создание */}
      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          if (!open) setShowCreate(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Новый кабинет</DialogTitle>
            <DialogDescription>
              Отдельный набор страниц и вкладок. Сайдбар и доски общие для всех кабинетов.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="workspace-name">Название</Label>
              <Input
                id="workspace-name"
                value={createName}
                maxLength={120}
                autoFocus
                placeholder="Например: Ozon основной"
                onChange={(e) => setCreateName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitCreate();
                }}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Наполнение</Label>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant={createMode === 'clone' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCreateMode('clone')}
                >
                  Копия текущего
                </Button>
                {templates.map((t) => (
                  <Button
                    key={t.id}
                    type="button"
                    variant={
                      createMode === 'template' && createTemplate === t.id
                        ? 'default'
                        : 'outline'
                    }
                    size="sm"
                    onClick={() => {
                      setCreateMode('template');
                      setCreateTemplate(t.id);
                    }}
                  >
                    {t.label}
                  </Button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {createMode === 'clone'
                  ? 'Копируются все страницы текущего кабинета вместе с блоками.'
                  : (templates.find((t) => t.id === createTemplate)?.description ?? '')}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>
              Отмена
            </Button>
            <Button
              size="sm"
              disabled={locked || !createName.trim()}
              onClick={() => void submitCreate()}
            >
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Удаление */}
      <AlertDialog
        open={deleteFor !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteFor(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить кабинет «{deleteFor?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              Удалятся все раскладки страниц и вкладки юнит-экономики этого кабинета.
              Доски и настройки сайдбара — общие, они сохранятся. Действие необратимо.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteFor(null)}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void submitDelete();
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
