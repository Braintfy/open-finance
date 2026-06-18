// PURPOSE: Клиентский UI раздела «Юнит-экономика» с CRUD-вкладками.
// v0.22.0: вкладки динамические (rename / create / clone / delete) через
// /api/unit-economics/tabs. Default-вкладки (Ozon, Ozon мульти, Яндекс,
// Мой магазин) seed'ятся при первом визите. Custom — любой набор блоков.
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calculator,
  Table as TableIcon,
  Layers,
  Store,
  Plus,
  Pencil,
  Copy,
  Trash2,
  X,
  Check,
  MoreHorizontal,
} from 'lucide-react';
import { BlockGrid } from '@/components/blocks/block-grid';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { BlockInstance } from '@/lib/blocks/types';
import { cn } from '@/lib/utils';
import { SectionAiButton } from '@/components/blocks/section-ai-button';

export type ClientTab = {
  id: string;
  pageKey: string;
  label: string;
  icon: string | null;
  order: number;
  kind: 'default' | 'custom';
  defaultKey: string | null;
  blocks: BlockInstance[];
};

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Calculator,
  Table: TableIcon,
  Layers,
  Store,
};

function iconFor(name: string | null): React.ComponentType<{ className?: string }> {
  return (name && ICON_MAP[name]) || Store;
}

/**
 * Резолвит `?tab=<slug>` в id вкладки. Slug может быть `defaultKey`
 * (для built-in) или `pageKey` (для custom). Возвращает undefined,
 * если параметр пустой / нет совпадений.
 */
function resolveTab(tabs: ClientTab[], param: string | null): string | undefined {
  if (!param) return undefined;
  return (
    tabs.find((t) => t.defaultKey === param)?.id ??
    tabs.find((t) => t.pageKey === param)?.id
  );
}

function tabParamFor(tab: ClientTab): string {
  return tab.defaultKey ?? tab.pageKey;
}

/**
 * Пишет `?tab=...` в URL через `history.replaceState` (без full navigation).
 * Не использует `useSearchParams`/router.push — иначе нужен Suspense
 * (см. `MEMORY.md` L220). Тот же паттерн в `admin/ai/local-models/page.tsx`.
 */
function syncTabToUrl(tab: ClientTab | undefined) {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (tab) url.searchParams.set('tab', tabParamFor(tab));
  else url.searchParams.delete('tab');
  window.history.replaceState(null, '', url);
}

export function UnitEconomicsClient({
  tenantId,
  initialTabs,
}: {
  tenantId: string;
  initialTabs: ClientTab[];
}) {
  const [tabs, setTabs] = useState<ClientTab[]>(initialTabs);
  // SSR-safe initial: тот же дефолт что и на сервере. URL читаем
  // в useEffect ниже, чтобы избежать hydration mismatch (v0.24.5).
  // initialTabs стабилен между SSR/CSR (приходит пропом).
  const ssrDefaultId =
    initialTabs.find((t) => t.defaultKey === 'ozon-multi')?.id ??
    initialTabs[0]?.id ??
    '';
  const [active, setActive] = useState<string>(ssrDefaultId);

  // Восстанавливаем выбранную вкладку из `?tab=` на клиенте после mount.
  // НЕ в useState-инициализаторе — иначе SSR (без window) и CSR (c window)
  // разойдутся и React пожалуется на hydration mismatch (см. MEMORY.md).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fromUrl = resolveTab(
      initialTabs,
      new URLSearchParams(window.location.search).get('tab'),
    );
    if (fromUrl && fromUrl !== ssrDefaultId) {
      setActive(fromUrl);
    }
    // initialTabs приходит из RSC и стабилен в рамках одной страницы;
    // ssrDefaultId детерминирован от initialTabs — зависимостей хватает.
  }, [initialTabs, ssrDefaultId]);

  /**
   * Wrapper над `setActive` который дополнительно синкает выбор в URL,
   * чтобы reload страницы оставался на выбранной вкладке.
   */
  const selectTab = useCallback(
    (id: string) => {
      setActive(id);
      syncTabToUrl(tabs.find((t) => t.id === id));
    },
    [tabs],
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirmFor, setDeleteConfirmFor] = useState<ClientTab | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);

  const activeTab = useMemo(() => tabs.find((t) => t.id === active), [tabs, active]);

  const renameTab = useCallback(async (id: string, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) {
      setEditingId(null);
      return;
    }
    const prev = tabs;
    setTabs((cur) => cur.map((t) => (t.id === id ? { ...t, label: trimmed } : t)));
    setEditingId(null);
    try {
      const res = await fetch(`/api/unit-economics/tabs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: trimmed }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? 'rename failed');
    } catch {
      setTabs(prev);
    }
  }, [tabs]);

  const createTab = useCallback(
    async (label: string, cloneFromPageKey?: string) => {
      const res = await fetch('/api/unit-economics/tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label, cloneFromPageKey }),
      });
      const data = await res.json();
      if (!data.ok) return;
      // Загрузим (пустой или склонированный) layout — клиент сам подтянет
      // через BlockGrid (тот всё равно вызовет load), нам достаточно положить
      // запись с пустыми blocks. Если клон — blocks подгрузятся при mount.
      const newTab: ClientTab = {
        id: data.tab.id,
        pageKey: data.tab.pageKey,
        label: data.tab.label,
        icon: data.tab.icon,
        order: data.tab.order,
        kind: data.tab.kind,
        defaultKey: data.tab.defaultKey,
        blocks: [],
      };
      setTabs((cur) => [...cur, newTab].sort((a, b) => a.order - b.order));
      setActive(newTab.id);
      syncTabToUrl(newTab);
      setShowCreate(false);
    },
    [],
  );

  const deleteTab = useCallback(async (id: string) => {
    const target = tabs.find((t) => t.id === id);
    if (!target) return;
    const res = await fetch(`/api/unit-economics/tabs/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!data.ok) return;
    setTabs((cur) => cur.filter((t) => t.id !== id));
    if (active === id) {
      const fallback = tabs.find((t) => t.id !== id);
      if (fallback) {
        setActive(fallback.id);
        syncTabToUrl(fallback);
      } else {
        syncTabToUrl(undefined);
      }
    }
    setDeleteConfirmFor(null);
  }, [tabs, active]);

  function startRename(tab: ClientTab) {
    setEditingId(tab.id);
    setEditingValue(tab.label);
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">Юнит-экономика</h1>
          <p className="text-xs text-muted-foreground">
            Маржа, P&amp;L и окупаемость товаров на маркетплейсах
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {activeTab && (
            <SectionAiButton pageKey={activeTab.pageKey} pageLabel="Юнит-экономика" />
          )}
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
            <Plus /> Новая вкладка
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-border/40 pb-0">
        {tabs.map((tab) => {
          const Icon = iconFor(tab.icon);
          const isActive = active === tab.id;
          const isEditing = editingId === tab.id;
          return (
            <div
              key={tab.id}
              className={cn(
                'group flex items-center gap-1 rounded-t-md border-b-2 px-2 py-1.5 transition-colors',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <button
                type="button"
                onClick={() => !isEditing && selectTab(tab.id)}
                onDoubleClick={() => startRename(tab)}
                className="flex items-center gap-2 text-[13px]"
                title="Двойной клик — переименовать"
              >
                <Icon className="h-3.5 w-3.5" />
                {isEditing ? (
                  <input
                    ref={editInputRef}
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={() => renameTab(tab.id, editingValue)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') renameTab(tab.id, editingValue);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="h-6 w-32 rounded border border-border/60 bg-background px-1.5 text-[13px] outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : (
                  <span className={isActive ? 'font-semibold' : 'font-medium'}>{tab.label}</span>
                )}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-accent hover:text-foreground"
                    aria-label="Меню вкладки"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3 w-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem onClick={() => startRename(tab)}>
                    <Pencil className="mr-2 h-3.5 w-3.5" /> Переименовать
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      createTab(`${tab.label} (копия)`, tab.pageKey)
                    }
                  >
                    <Copy className="mr-2 h-3.5 w-3.5" /> Дублировать
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => setDeleteConfirmFor(tab)}
                    className="text-red-600 focus:text-red-700"
                  >
                    <Trash2 className="mr-2 h-3.5 w-3.5" /> Удалить
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
        {tabs.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Нет вкладок. Создайте первую через «Новая вкладка».
          </p>
        )}
      </div>

      {activeTab && (
        <BlockGrid
          key={activeTab.pageKey}
          pageKey={activeTab.pageKey}
          tenantId={tenantId}
          initialBlocks={activeTab.blocks}
        />
      )}

      <CreateTabDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        existingTabs={tabs}
        onCreate={createTab}
      />

      <AlertDialog
        open={deleteConfirmFor !== null}
        onOpenChange={(o) => !o && setDeleteConfirmFor(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Удалить вкладку «{deleteConfirmFor?.label}»?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirmFor?.kind === 'default'
                ? 'Дефолтная вкладка будет скрыта (можно восстановить через «Сбросить»). Layout сохранится.'
                : 'Кастомная вкладка и все её блоки будут удалены безвозвратно.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmFor && deleteTab(deleteConfirmFor.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteConfirmFor?.kind === 'default' ? 'Скрыть' : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateTabDialog({
  open,
  onClose,
  existingTabs,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  existingTabs: ClientTab[];
  onCreate: (label: string, cloneFromPageKey?: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [cloneFrom, setCloneFrom] = useState<string>('');

  function reset() {
    setLabel('');
    setCloneFrom('');
  }

  function submit() {
    if (!label.trim()) return;
    onCreate(label.trim(), cloneFrom || undefined);
    reset();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Новая вкладка</DialogTitle>
          <DialogDescription>
            Создайте пустую вкладку или скопируйте существующую (вместе с блоками).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="tab-label">Название</Label>
            <Input
              id="tab-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Например: Wildberries или Мой ассортимент"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && label.trim()) submit();
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tab-clone">Скопировать из (опционально)</Label>
            <select
              id="tab-clone"
              value={cloneFrom}
              onChange={(e) => setCloneFrom(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="">— Пустая вкладка —</option>
              {existingTabs.map((t) => (
                <option key={t.id} value={t.pageKey}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => { reset(); onClose(); }}>
            <X /> Отмена
          </Button>
          <Button onClick={submit} disabled={!label.trim()}>
            <Check /> Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
