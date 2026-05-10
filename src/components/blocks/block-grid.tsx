// PURPOSE: BlockGrid — react-grid-layout обёртка с edit mode, settings dialog, persist API
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout';
import { Plus, Pencil, Check, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BlockInstance } from '@/lib/blocks/types';
import { getBlockDef, sanitizeBlocks } from '@/lib/blocks/registry';
import { BlockChrome } from './block-chrome';
import { AddBlockDialog, type AddBlockResult } from './add-block-dialog';
import { BlockSettingsDialog } from './block-settings-dialog';
import { BlockSizeProvider } from './block-size';

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
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBlocks = useRef<BlockInstance[] | null>(null);
  const blocksRef = useRef<BlockInstance[]>(blocks);
  blocksRef.current = blocks;

  const doSave = useCallback(
    async (data: BlockInstance[]) => {
      setSaving(true);
      try {
        await fetch(`/api/blocks/layout/${pageKey}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blocks: data }),
        });
        pendingBlocks.current = null;
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
      saveTimer.current = setTimeout(() => {
        doSave(next);
      }, 800);
    },
    [doSave]
  );

  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    const data = pendingBlocks.current;
    if (data) {
      pendingBlocks.current = null;
      fetch(`/api/blocks/layout/${pageKey}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blocks: data }),
        keepalive: true,
      }).catch(() => {});
    }
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
    if (!editMode) return;
    setBlocks((prev) => {
      const byId = new Map(layout.map((l) => [l.i, l]));
      const next = prev.map((b) => {
        const l = byId.get(b.id);
        return l ? { ...b, x: l.x, y: l.y, w: l.w, h: l.h } : b;
      });
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

  async function resetToDefaults() {
    if (
      !confirm(
        'Сбросить раскладку к исходной? Все пользовательские блоки и настройки будут удалены.'
      )
    ) {
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/blocks/layout/${pageKey}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        setBlocks(sanitizeBlocks(data.blocks ?? []));
      }
    } finally {
      setSaving(false);
    }
  }

  const settingsBlock = blocks.find((b) => b.id === settingsId) ?? null;
  const settingsDef = settingsBlock ? getBlockDef(settingsBlock.type) : null;

  const grid = (
    <ResponsiveGridLayout
      className="layout"
      layouts={layouts}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      rowHeight={40}
      isDraggable={editMode}
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
          <div key={b.id}>
            <BlockChrome
              editMode={editMode}
              appearance={b.appearance}
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
  );

  return (
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
          onChange={(patch) => updateBlock(settingsBlock.id, patch)}
        />
      )}
    </div>
  );
}
