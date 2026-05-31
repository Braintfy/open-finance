// PURPOSE: Custom React Flow node для режима «Карта связей». Гибридная карточка:
// свёрнута (компактный живой блок) ↔ раскрыта (полноразмерный интерактивный блок).
// Тащится только за шапку (.block-node-drag-handle); сокеты слева (in) / справа (out).
'use client';

import { createContext, useContext, type CSSProperties } from 'react';
import { Box, ChevronDown, ChevronUp, Settings2, Sparkles } from 'lucide-react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { BlockDef, BlockInstance } from '@/lib/blocks/types';
import { getBlockDef } from '@/lib/blocks/registry';
import { resolveIcon } from '@/lib/blocks/icon-resolver';
import { BlockSizeProvider } from './block-size';
import { getMapExpandedSize, getMapPreview, mapPreviewNeedsLiveData } from './map-previews';

/* ── shared handlers via context (стабильны, не дёргают rebuild узлов) ── */

export type MindmapHandlers = {
  tenantId: string;
  onToggleCollapse: (id: string) => void;
  onConfigChange: (id: string, config: Record<string, unknown>) => void;
  onOpenSettings: (id: string) => void;
  onOpenAi: (id: string) => void;
};

export const MindmapContext = createContext<MindmapHandlers | null>(null);

/* ── node data / типы ── */

export type BlockNodeData = {
  block: BlockInstance;
  collapsed: boolean;
};

export type BlockFlowNode = Node<BlockNodeData, 'blockNode'>;

/* ── helpers ── */

function nodeSize(
  block: BlockInstance,
  def: BlockDef | undefined,
  collapsed: boolean,
): { w: number; h: number } {
  return collapsed ? getMapPreview(block.type).previewSize : getMapExpandedSize(def, block.type);
}

/**
 * Скрытый offscreen-mount живого блока — только чтобы он опубликовал значения
 * в BlockValues store (для метрики в превью). Не виден, не кликается.
 */
function HiddenPublisher({
  block,
  def,
  tenantId,
}: {
  block: BlockInstance;
  def: BlockDef;
  tenantId: string;
}) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-[-99999px] top-0 overflow-hidden opacity-0"
      style={{ width: 300, height: 200 }}
    >
      <BlockSizeProvider minContent={def.minContentSize}>
        <def.Render instance={block} tenantId={tenantId} />
      </BlockSizeProvider>
    </div>
  );
}

/* ── component ── */

export function BlockNode({ data }: NodeProps<BlockFlowNode>) {
  const handlers = useContext(MindmapContext);
  const { block, collapsed } = data;
  const def = getBlockDef(block.type);

  const title = block.appearance?.title ?? def?.displayName ?? block.type;
  const accent =
    block.appearance?.accentColor ?? block.appearance?.borderColor ?? '#6366f1';
  const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
  const { w: bodyW, h: bodyH } = nodeSize(block, def, collapsed);

  const cardStyle: CSSProperties & Record<string, string | number> = { width: bodyW };
  cardStyle['--bn-accent'] = accent;

  const PreviewComp = getMapPreview(block.type).Preview;
  const needsLiveData = mapPreviewNeedsLiveData(block.type);

  return (
    <div
      className="block-node group relative rounded-xl border border-slate-200 bg-white shadow-md ring-1 ring-black/5"
      style={cardStyle}
    >
      <Handle type="target" position={Position.Left} id="in" className="block-node-handle" />
      <Handle type="source" position={Position.Right} id="out" className="block-node-handle" />

      <header className="block-node-drag-handle flex cursor-move items-center gap-1.5 rounded-t-xl border-b border-slate-100 bg-slate-50/80 px-2.5 py-1.5">
        <span aria-hidden className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: accent }} />
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800" title={title}>
          {title}
        </span>

        <div className="nodrag flex shrink-0 items-center gap-0.5">
          {handlers && (
            <>
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-md text-primary transition hover:bg-slate-200/70"
                title="ИИ Микроагент"
                onClick={(e) => {
                  e.stopPropagation();
                  handlers.onOpenAi(block.id);
                }}
              >
                <Sparkles className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200/70"
                title="Настройки блока"
                onClick={(e) => {
                  e.stopPropagation();
                  handlers.onOpenSettings(block.id);
                }}
              >
                <Settings2 className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-200/70"
                title={collapsed ? 'Развернуть блок' : 'Свернуть в превью'}
                onClick={(e) => {
                  e.stopPropagation();
                  handlers.onToggleCollapse(block.id);
                }}
              >
                {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
              </button>
            </>
          )}
        </div>
      </header>

      <div className="relative overflow-hidden rounded-b-xl" style={{ height: bodyH }}>
        {!def ? (
          <div className="flex h-full w-full items-center justify-center p-3 text-center text-[11px] text-slate-400">
            Неизвестный тип блока
            <br />
            {block.type}
          </div>
        ) : collapsed ? (
          <>
            <PreviewComp block={block} />
            {needsLiveData && (
              <HiddenPublisher block={block} def={def} tenantId={handlers?.tenantId ?? ''} />
            )}
          </>
        ) : (
          <div className="nodrag nowheel h-full w-full overflow-auto" style={{ height: bodyH }}>
            <BlockSizeProvider minContent={def.minContentSize}>
              <def.Render
                instance={block}
                tenantId={handlers?.tenantId ?? ''}
                onConfigChange={
                  handlers ? (cfg) => handlers.onConfigChange(block.id, cfg) : undefined
                }
              />
            </BlockSizeProvider>
          </div>
        )}
      </div>
    </div>
  );
}

export const blockNodeTypes = { blockNode: BlockNode };
