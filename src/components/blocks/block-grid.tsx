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
import { MicroAgentDialog } from '@/components/micro-agent/micro-agent-dialog';
import type { BlockContext, SuggestedAction } from '@/lib/ai/micro-agent/types';
import { collectBlockRelationEdges, collectBlockRelationIds } from '@/lib/blocks/relations';

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

const AI_MUTABLE_BLOCK_TYPES = new Set(['sheet', 'custom.data', 'navigate.card', 'ai.micro-agent']);

function makeId(prefix: string): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const hasCurrency = /₽|руб/i.test(value);
  const normalized = value
    .replace(/\s/g, '')
    .replace(/[₽рруб.]/gi, '')
    .replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return 0;
  return hasCurrency ? Math.round(parsed * 100) : parsed;
}

function normalizeCustomDataConfig(
  raw: Record<string, unknown>,
  current: Record<string, unknown> = {},
): Record<string, unknown> {
  const sourceRows = Array.isArray(raw.rows)
    ? raw.rows
    : Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.data)
        ? raw.data
        : ('label' in raw || 'value' in raw || 'amount' in raw)
          ? [raw]
          : Array.isArray(current.rows)
            ? current.rows
            : [];

  const rows = sourceRows.map((row, index) => {
    if (isRecord(row)) {
      return {
        id: typeof row.id === 'string' ? row.id : makeId('ai_row'),
        label: String(row.label ?? row.name ?? row.title ?? row.category ?? row.description ?? `Строка ${index + 1}`),
        value: toNumber(row.value ?? row.amount ?? row.total ?? row.sum ?? 0),
      };
    }
    return {
      id: makeId('ai_row'),
      label: String(row),
      value: 0,
    };
  });

  const publishMode = ['sum', 'avg', 'count', 'last'].includes(String(raw.publishMode))
    ? raw.publishMode
    : current.publishMode ?? 'sum';
  const format = ['rubles', 'number', 'percent'].includes(String(raw.format))
    ? raw.format
    : current.format ?? 'rubles';

  return {
    ...current,
    ...raw,
    rows,
    publishMode,
    format,
    showKopecks: typeof raw.showKopecks === 'boolean' || raw.showKopecks === null
      ? raw.showKopecks
      : current.showKopecks ?? null,
  };
}

function columnIndex(label: string): number {
  return label
    .toUpperCase()
    .split('')
    .reduce((acc, ch) => acc * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

function normalizeSheetCells(rawCells: unknown, rows: number, cols: number): string[][] {
  const cells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''));
  if (Array.isArray(rawCells)) {
    rawCells.forEach((row, r) => {
      if (!Array.isArray(row)) return;
      row.forEach((cell, c) => {
        if (r < rows && c < cols) cells[r][c] = String(cell ?? '');
      });
    });
    return cells;
  }
  if (isRecord(rawCells)) {
    Object.entries(rawCells).forEach(([addr, value]) => {
      const match = addr.match(/^([A-Z]+)(\d+)$/i);
      if (!match) return;
      const c = columnIndex(match[1]);
      const r = Number.parseInt(match[2], 10) - 1;
      if (r >= 0 && r < rows && c >= 0 && c < cols) cells[r][c] = String(value ?? '');
    });
  }
  return cells;
}

function normalizeSheetConfig(
  raw: Record<string, unknown>,
  current: Record<string, unknown> = {},
): Record<string, unknown> {
  const rawCells = raw.cells;
  const rowCountFromCells = Array.isArray(rawCells) ? rawCells.length : 0;
  const colCountFromCells = Array.isArray(rawCells)
    ? Math.max(1, ...rawCells.map((row) => Array.isArray(row) ? row.length : 0))
    : isRecord(rawCells)
      ? Math.max(1, ...Object.keys(rawCells).map((addr) => {
          const match = addr.match(/^([A-Z]+)(\d+)$/i);
          return match ? columnIndex(match[1]) + 1 : 1;
        }))
      : 0;
  const maxRowFromAddress = isRecord(rawCells)
    ? Math.max(1, ...Object.keys(rawCells).map((addr) => {
        const match = addr.match(/^([A-Z]+)(\d+)$/i);
        return match ? Number.parseInt(match[2], 10) : 1;
      }))
    : 0;
  const requestedRows = Number(raw.rows ?? raw.rowCount ?? current.rows ?? 10);
  const requestedCols = Number(raw.cols ?? raw.colCount ?? current.cols ?? 5);
  const rows = Math.min(
    200,
    Math.max(
      1,
      Number.isFinite(requestedRows) ? requestedRows : 10,
      rowCountFromCells,
      maxRowFromAddress,
    ),
  );
  const cols = Math.min(
    26,
    Math.max(
      1,
      Number.isFinite(requestedCols) ? requestedCols : 5,
      colCountFromCells,
    ),
  );

  return {
    ...current,
    ...raw,
    title: String(raw.title ?? current.title ?? 'Таблица'),
    rows,
    cols,
    cells: normalizeSheetCells(rawCells ?? current.cells, rows, cols),
    colWidths: normalizeNumberArray(raw.colWidths, current.colWidths, cols, 100),
    rowHeights: normalizeNumberArray(raw.rowHeights, current.rowHeights, rows, 28),
    headerCells: normalizeHeaderCells(raw.headerCells ?? current.headerCells, rows),
  };
}

function normalizeNumberArray(
  raw: unknown,
  current: unknown,
  length: number,
  fallback: number,
): number[] {
  const source = Array.isArray(raw) ? raw : Array.isArray(current) ? current : [];
  return Array.from({ length }, (_, index) => {
    const value = Number(source[index]);
    return Number.isFinite(value) ? value : fallback;
  });
}

function normalizeHeaderCells(raw: unknown, rows: number): Array<Record<string, unknown>> {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [
      { id: makeId('ai_header'), label: 'Название', value: 'Таблица', width: 200 },
      { id: makeId('ai_header'), label: 'Итого', value: `=SUM(A1:A${rows})`, width: 150 },
    ];
  }

  return raw.map((cell, index) => {
    const source = isRecord(cell) ? cell : {};
    const width = Number(source.width);
    return {
      id: typeof source.id === 'string' ? source.id : makeId('ai_header'),
      label: String(source.label ?? `Поле ${index + 1}`),
      value: String(source.value ?? ''),
      ...(Number.isFinite(width) ? { width } : {}),
    };
  });
}

function inferBlockTypeFromAiConfig(raw: Record<string, unknown>): string {
  if ('cells' in raw || 'cols' in raw || 'colCount' in raw) return 'sheet';
  return 'custom.data';
}

function normalizeAiConfigForBlock(
  blockType: string,
  raw: Record<string, unknown>,
  current: Record<string, unknown> = {},
): Record<string, unknown> {
  if (blockType === 'sheet') return normalizeSheetConfig(raw, current);
  if (blockType === 'custom.data') return normalizeCustomDataConfig(raw, current);
  return { ...current, ...raw };
}

function shouldCreateInsteadOfUpdate(blockType: string, payload: Record<string, unknown>): boolean {
  if (!AI_MUTABLE_BLOCK_TYPES.has(blockType)) return true;
  if (blockType !== 'ai.micro-agent') return false;
  return Object.keys(payload).some(
    (key) => !['blockPrompt', 'model', 'lastResult', 'lastActionType'].includes(key),
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
  const [aiBlockId, setAiBlockId] = useState<string | null>(null);
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
    () => collectBlockRelationEdges(blocks, pageKey).length > 0,
    [blocks, pageKey]
  );
  /** Set ID блоков, участвующих в связях (source или target) — для микро-иконки */
  const participatingIds = useMemo(() => {
    return collectBlockRelationIds(blocks, pageKey);
  }, [blocks, pageKey]);
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
    const id = makeId('b');
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

  function applyAiConfigToBlock(id: string, blockType: string, payload: Record<string, unknown>) {
    setBlocks((prev) => {
      const next = prev.map((b) => {
        if (b.id !== id) return b;
        return {
          ...b,
          config: normalizeAiConfigForBlock(blockType, payload, b.config ?? {}),
        };
      });
      scheduleSave(next);
      return next;
    });
  }

  function createBlockFromAi(blockType: string, rawConfig: Record<string, unknown>) {
    const fallbackType = inferBlockTypeFromAiConfig(rawConfig);
    const def = getBlockDef(blockType) ?? getBlockDef(fallbackType);
    if (!def) return;

    setBlocks((prev) => {
      const maxY = prev.reduce((m, b) => Math.max(m, b.y + b.h), 0);
      const config = normalizeAiConfigForBlock(
        def.type,
        rawConfig,
        def.defaultConfig?.() ?? {},
      );
      const newBlock: BlockInstance = {
        id: makeId('ai_block'),
        type: def.type,
        x: 0,
        y: maxY,
        w: def.defaultSize.w,
        h: def.defaultSize.h,
        config,
        appearance: typeof config.title === 'string' ? { title: config.title } : undefined,
      };
      const next = [...prev, newBlock];
      scheduleSave(next);
      return next;
    });
  }

  function applyAiAction(action: SuggestedAction) {
    if (!aiBlockId) return;
    const target = blocks.find((b) => b.id === aiBlockId);
    if (!target) return;

    if (action.type === 'update_block') {
      if (shouldCreateInsteadOfUpdate(target.type, action.payload)) {
        createBlockFromAi(inferBlockTypeFromAiConfig(action.payload), action.payload);
        return;
      }
      applyAiConfigToBlock(target.id, target.type, action.payload);
      return;
    }

    if (action.type === 'create_block') {
      createBlockFromAi(action.payload.blockType, action.payload.config);
    }
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
        isResizable={true}
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
            <div key={b.id} data-block-id={b.id} className={editMode ? 'block-edit-mode' : undefined}>
              <BlockChrome
                editMode={editMode}
                appearance={b.appearance}
                block={b}
                currentPageKey={pageKey}
                hasRelations={participatingIds.has(b.id)}
                onRemove={() => onRemoveBlock(b.id)}
                onOpenSettings={() => setSettingsId(b.id)}
                onOpenAi={() => setAiBlockId(b.id)}
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
        currentPageKey={pageKey}
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
          allBlocks={blocks}
          onChange={(patch) => updateBlock(settingsBlock.id, patch)}
        />
      )}

      {/* AI Micro-Agent Dialog */}
      <MicroAgentDialog
        open={aiBlockId !== null}
        onOpenChange={(o) => { if (!o) setAiBlockId(null); }}
        blockContext={aiBlockId ? {
          blockId: aiBlockId,
          blockType: blocks.find((b) => b.id === aiBlockId)?.type,
          blockTitle: blocks.find((b) => b.id === aiBlockId)?.appearance?.title ?? getBlockDef(blocks.find((b) => b.id === aiBlockId)?.type ?? '')?.displayName,
          blockData: blocks.find((b) => b.id === aiBlockId)?.config as Record<string, unknown> | undefined,
          pageKey,
        } satisfies BlockContext : undefined}
        onApply={applyAiAction}
      />

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
