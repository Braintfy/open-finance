// PURPOSE: BlockGrid — react-grid-layout обёртка с edit mode, settings dialog, persist API
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout';
import { Plus, Pencil, Check, RotateCcw, Network } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import type { BlockInstance } from '@/lib/blocks/types';
import { getBlockDef, sanitizeBlocks } from '@/lib/blocks/registry';
import { BlockChrome } from './block-chrome';
import { AddBlockDialog, type AddBlockResult } from './add-block-dialog';
import { BlockSettingsDialog } from './block-settings-dialog';
import { BlockSizeProvider } from './block-size';
import { BlockValuesProvider } from '@/lib/blocks/values';
import { BlockRelationsOverlay } from './block-relations-overlay';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './block-grid.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

function EmptyState({ onAdd, onReset }: { onAdd: () => void; onReset: () => void }) {
  return (
    <div className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/30 p-10 text-center">
      <div className="mb-1 text-sm font-semibold">Пусто</div>
      <p className="mb-4 max-w-sm text-xs text-muted-foreground">
        На этой странице нет блоков. Добавьте свои или восстановите исходную раскладку.
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onReset}>
          <RotateCcw /> Вернуть по умолчанию
        </Button>
        <Button size="sm" onClick={onAdd}>
          <Plus /> Добавить блок
        </Button>
      </div>
    </div>
  );
}

const COLS = { lg: 12, md: 12, sm: 6, xs: 4, xxs: 2 };
const BREAKPOINTS = { lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 };

type Props = {
  pageKey: string;
  tenantId: string;
  initialBlocks: BlockInstance[];
  /** Обёртка для контекста данных страницы (например CashflowDataProvider) */
  children?: (rendered: React.ReactNode) => React.ReactNode;
};

export function BlockGrid({ pageKey, tenantId, initialBlocks, children }: Props) {
  const [blocks, setBlocks] = useState<BlockInstance[]>(() => sanitizeBlocks(initialBlocks));
  const [editMode, setEditMode] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** Mindmap-overlay: связи между блоками. Выкл/Вкл через кнопку. */
  const [showRelations, setShowRelations] = useState(false);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  /**
   * SAFEGUARD против критического бага «блоки исчезают»: если хоть раз были
   * не-пустые blocks, мы НЕ позволяем сохранять [] без явного намерения user'а
   * (Reset / поочерёдное удаление через X). Защита от race condition в RGL,
   * где onLayoutChange может прислать [] во время mount/unmount.
   */
  const hadBlocksRef = useRef<boolean>((initialBlocks?.length ?? 0) > 0);
  const explicitClearRef = useRef<boolean>(false);
  /** Есть ли хотя бы одна связь между блоками — для показа toggle кнопки */
  const hasRelations = useMemo(
    () => blocks.some((b) => b.dependencies && b.dependencies.sources.length > 0),
    [blocks]
  );
  /** Map blockId → label для BlockReferencePicker в settings dialog */
  const blockLabels = useMemo(() => {
    const m: Record<string, string> = {};
    for (const b of blocks) {
      const def = getBlockDef(b.type);
      m[b.id] = b.appearance?.title ?? def?.displayName ?? b.id;
    }
    return m;
  }, [blocks]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBlocks = useRef<BlockInstance[] | null>(null);

  const doSave = useCallback(
    async (data: BlockInstance[]) => {
      // CRITICAL SAFEGUARD: не сохраняем [] если у user'а БЫЛИ блоки
      // и он не нажимал явно Reset / Remove. Это защита от race в RGL/state.
      if (data.length === 0 && hadBlocksRef.current && !explicitClearRef.current) {
        console.warn(
          '[BlockGrid] Refused to save empty blocks (likely race condition). ' +
            'User had blocks and did not explicitly clear them.'
        );
        return;
      }
      // После явного очищения — сбрасываем флаг (следующий save должен идти как обычно)
      if (data.length === 0 && explicitClearRef.current) {
        hadBlocksRef.current = false;
        explicitClearRef.current = false;
      } else if (data.length > 0) {
        hadBlocksRef.current = true;
      }

      setSaving(true);
      try {
        const res = await fetch(`/api/blocks/layout/${pageKey}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: data }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.error('[BlockGrid] save layout failed:', res.status, text);
        }
        // Очищаем pending только если он всё ещё указывает на эти же данные.
        // Если пока летел fetch, пользователь сделал новые изменения — pendingBlocks
        // уже указывает на них и НЕ должен быть обнулён (иначе flushSave потеряет их).
        if (pendingBlocks.current === data) {
          pendingBlocks.current = null;
        }
      } catch (e) {
        console.error('save layout failed', e);
      } finally {
        setSaving(false);
      }
    },
    [pageKey]
  );

  const scheduleSave = useCallback(
    (next: BlockInstance[]) => {
      pendingBlocks.current = next;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      // 300ms — очень короткий debounce для минимизации race condition с unload
      saveTimer.current = setTimeout(() => {
        doSave(next);
      }, 300);
    },
    [doSave]
  );

  // Гарантированный флаш на unload — sendBeacon копирует данные в OS-level очередь и доставит их даже после закрытия вкладки
  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const data = pendingBlocks.current;
    if (!data) return;
    // CRITICAL SAFEGUARD: см. doSave — не сохраняем [] без явного намерения
    if (data.length === 0 && hadBlocksRef.current && !explicitClearRef.current) {
      console.warn('[BlockGrid] flushSave refused empty save (race condition guard)');
      pendingBlocks.current = null;
      return;
    }
    pendingBlocks.current = null;
    const url = `/api/blocks/layout/${pageKey}`;
    const payload = JSON.stringify({ blocks: data });
    // sendBeacon — гарантированная доставка (поддерживает только POST), API имеет POST handler
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        const blob = new Blob([payload], { type: 'application/json' });
        const ok = navigator.sendBeacon(url, blob);
        if (ok) return;
      } catch {
        // fallthrough
      }
    }
    // Fallback — fetch с keepalive
    fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }, [pageKey]);

  useEffect(() => {
    const handleBeforeUnload = () => flushSave();
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushSave();
    };
  }, [flushSave]);

  const layouts = useMemo(() => {
    const lg = blocks.map((b) => ({
      i: b.id,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      // По умолчанию разрешаем 1x1 — блоки могут override через minSize
      minW: getBlockDef(b.type)?.minSize.w ?? 1,
      minH: getBlockDef(b.type)?.minSize.h ?? 1,
    }));
    return { lg, md: lg };
  }, [blocks]);

  function onLayoutChange(layout: Layout[]) {
    setBlocks((prev) => {
      // SAFETY: если RGL прислал пустой layout, а блоки есть — игнорируем (баг RGL во время mount)
      if (layout.length === 0 && prev.length > 0) return prev;

      const byId = new Map(layout.map((l) => [l.i, l]));
      let changed = false;
      const next = prev.map((b) => {
        const l = byId.get(b.id);
        if (!l) return b;
        if (l.x === b.x && l.y === b.y && l.w === b.w && l.h === b.h) return b;
        changed = true;
        return { ...b, x: l.x, y: l.y, w: l.w, h: l.h };
      });
      // Сохраняем только если действительно что-то изменилось — иначе бесконечные ре-рендеры
      if (!changed) return prev;
      scheduleSave(next);
      return next;
    });
  }

  function onAddBlock(result: AddBlockResult) {
    const def = getBlockDef(result.type);
    if (!def) return;
    const id =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `b_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const maxY = blocks.reduce((m, b) => Math.max(m, b.y + b.h), 0);
    const newBlock: BlockInstance = {
      id,
      type: result.type,
      x: 0,
      y: maxY,
      w: result.size.w,
      h: result.size.h,
      config: result.config,
      appearance: result.appearance,
    };
    setBlocks((prev) => {
      const next = [...prev, newBlock];
      scheduleSave(next);
      return next;
    });
    setShowAdd(false);
  }

  function onRemoveBlock(id: string) {
    setBlocks((prev) => {
      const next = prev.filter((b) => b.id !== id);
      // Если user удалил ПОСЛЕДНИЙ блок — это явное намерение очистить страницу
      if (next.length === 0 && prev.length > 0) {
        explicitClearRef.current = true;
      }
      scheduleSave(next);
      return next;
    });
  }

  function onConfigChange(id: string, config: Record<string, unknown>) {
    updateBlock(id, { config });
  }

  function updateBlock(id: string, patch: Partial<BlockInstance>) {
    setBlocks((prev) => {
      const next = prev.map((b) => (b.id === id ? { ...b, ...patch } : b));
      scheduleSave(next);
      return next;
    });
  }

  async function performReset() {
    setShowResetConfirm(false);
    // Отменяем любой pending save — он бы перезаписал дефолты
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pendingBlocks.current = null;
    setSaving(true);
    try {
      const res = await fetch(`/api/blocks/layout/${pageKey}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        const next = sanitizeBlocks(data.blocks ?? []);
        // Reset = явное намерение, но он возвращает дефолтный набор (обычно НЕ пустой)
        hadBlocksRef.current = next.length > 0;
        explicitClearRef.current = false;
        setBlocks(next);
      }
    } finally {
      setSaving(false);
    }
  }

  function resetToDefaults() {
    setShowResetConfirm(true);
  }

  const settingsBlock = blocks.find((b) => b.id === settingsId) ?? null;
  const settingsDef = settingsBlock ? getBlockDef(settingsBlock.type) : null;

  const grid = (
    <div ref={gridContainerRef} className="relative">
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={BREAKPOINTS}
        cols={COLS}
        rowHeight={40}
        isDraggable={true}
        isResizable={editMode}
        onLayoutChange={onLayoutChange}
        draggableHandle=".block-drag-handle"
        margin={[10, 10]}
        containerPadding={[0, 0]}
      >
        {blocks.map((b) => {
          const def = getBlockDef(b.type);
          if (!def) return null;
          const Render = def.Render;
          return (
            <div key={b.id} data-block-id={b.id}>
              <BlockChrome
                editMode={editMode}
                appearance={b.appearance}
                block={b}
                currentPageKey={pageKey}
                onRemove={() => onRemoveBlock(b.id)}
                onOpenSettings={() => setSettingsId(b.id)}
              >
                <BlockSizeProvider minContent={def.minContentSize}>
                  <Render
                    instance={b}
                    tenantId={tenantId}
                    onConfigChange={(cfg) => onConfigChange(b.id, cfg)}
                  />
                </BlockSizeProvider>
              </BlockChrome>
            </div>
          );
        })}
      </ResponsiveGridLayout>
      <BlockRelationsOverlay
        blocks={blocks}
        containerRef={gridContainerRef}
        highlighted={showRelations}
      />
    </div>
  );

  return (
    <BlockValuesProvider>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {saving && <span>Сохранение…</span>}
          {editMode && (
            <span className="inline-flex h-5 items-center rounded-full bg-amber-50 px-2 font-medium text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-950 dark:text-amber-400 dark:ring-amber-800">
              Редактирование
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          {hasRelations && (
            <Button
              variant={showRelations ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setShowRelations((v) => !v)}
              title={showRelations ? 'Скрыть связи' : 'Показать связи между блоками'}
            >
              <Network /> Связи
            </Button>
          )}
          {editMode && (
            <>
              <Button variant="ghost" size="sm" onClick={resetToDefaults}>
                <RotateCcw /> Сбросить
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
                <Plus /> Добавить
              </Button>
            </>
          )}
          <Button
            variant={editMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              if (editMode) flushSave();
              setEditMode((v) => !v);
            }}
          >
            {editMode ? (
              <>
                <Check /> Готово
              </>
            ) : (
              <>
                <Pencil /> Настроить
              </>
            )}
          </Button>
        </div>
      </div>

      {blocks.length === 0 ? (
        <EmptyState
          onAdd={() => {
            setEditMode(true);
            setShowAdd(true);
          }}
          onReset={resetToDefaults}
        />
      ) : children ? (
        children(grid)
      ) : (
        grid
      )}

      <AddBlockDialog
        open={showAdd}
        pageKey={pageKey}
        existingTypes={blocks.map((b) => b.type)}
        onAdd={onAddBlock}
        onClose={() => setShowAdd(false)}
      />

      {settingsBlock && settingsDef && (
        <BlockSettingsDialog
          open={settingsId !== null}
          onClose={() => setSettingsId(null)}
          def={settingsDef}
          instance={settingsBlock}
          blockLabels={blockLabels}
          onChange={(patch) => updateBlock(settingsBlock.id, patch)}
        />
      )}

      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Сбросить раскладку к исходной?</AlertDialogTitle>
            <AlertDialogDescription>
              Все пользовательские блоки и настройки этой страницы будут удалены и
              заменены дефолтным набором. Действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={performReset}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Сбросить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </div>
    </BlockValuesProvider>
  );
}
