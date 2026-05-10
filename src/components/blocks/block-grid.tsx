// PURPOSE: BlockGrid — react-grid-layout обёртка с edit mode, settings dialog, persist API
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Responsive, WidthProvider, type Layout } from 'react-grid-layout';
import { Plus, Pencil, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BlockInstance } from '@/lib/blocks/types';
import { getBlockDef, sanitizeBlocks } from '@/lib/blocks/registry';
import { BlockChrome } from './block-chrome';
import { AddBlockDialog, type AddBlockResult } from './add-block-dialog';
import { BlockSettingsDialog } from './block-settings-dialog';

import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import './block-grid.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

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

  const scheduleSave = useCallback(
    (next: BlockInstance[]) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        setSaving(true);
        try {
          await fetch(`/api/blocks/layout/${pageKey}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blocks: next }),
          });
        } catch (e) {
          console.error('save layout failed', e);
        } finally {
          setSaving(false);
        }
      }, 800);
    },
    [pageKey]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const layouts = useMemo(() => {
    const lg = blocks.map((b) => ({
      i: b.id,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      minW: getBlockDef(b.type)?.minSize.w ?? 2,
      minH: getBlockDef(b.type)?.minSize.h ?? 2,
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

  const settingsBlock = blocks.find((b) => b.id === settingsId) ?? null;
  const settingsDef = settingsBlock ? getBlockDef(settingsBlock.type) : null;

  const grid = (
    <ResponsiveGridLayout
      className="layout"
      layouts={layouts}
      breakpoints={BREAKPOINTS}
      cols={COLS}
      rowHeight={60}
      isDraggable={editMode}
      isResizable={editMode}
      onLayoutChange={onLayoutChange}
      draggableHandle=".block-drag-handle"
      margin={[16, 16]}
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
              <Render
                instance={b}
                tenantId={tenantId}
                onConfigChange={(cfg) => onConfigChange(b.id, cfg)}
              />
            </BlockChrome>
          </div>
        );
      })}
    </ResponsiveGridLayout>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {saving && <span>Сохранение…</span>}
          {editMode && <span className="text-amber-600">Режим редактирования</span>}
        </div>
        <div className="flex gap-2">
          {editMode && (
            <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
              <Plus className="h-4 w-4" /> Добавить блок
            </Button>
          )}
          <Button
            variant={editMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? (
              <>
                <Check className="h-4 w-4" /> Готово
              </>
            ) : (
              <>
                <Pencil className="h-4 w-4" /> Настроить
              </>
            )}
          </Button>
        </div>
      </div>

      {children ? children(grid) : grid}

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
