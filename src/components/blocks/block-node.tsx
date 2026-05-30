// PURPOSE: Custom React Flow node для режима «Карта связей». Гибридная карточка:
// свёрнута (компактный живой блок) ↔ раскрыта (полноразмерный интерактивный блок).
// Тащится только за шапку (.block-node-drag-handle); сокеты слева (in) / справа (out).
'use client';

import Link from 'next/link';
import { createContext, useContext, useState, type CSSProperties } from 'react';
import {
  Box,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { BlockInstance } from '@/lib/blocks/types';
import { getBlockDef } from '@/lib/blocks/registry';
import { resolveIcon } from '@/lib/blocks/icon-resolver';
import { BlockSizeProvider } from './block-size';
import {
  pageHref,
  type CrossPageLink,
} from '@/lib/blocks/use-cross-page-relations';

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
  cross?: { incoming: CrossPageLink[]; outgoing: CrossPageLink[] };
};

export type BlockFlowNode = Node<BlockNodeData, 'blockNode'>;

/* ── helpers ── */

function bodyDimensions(block: BlockInstance, collapsed: boolean): { w: number; h: number } {
  if (collapsed) return { w: 224, h: 92 };
  return {
    w: Math.min(560, Math.max(300, (block.w ?? 4) * 64)),
    h: Math.min(460, Math.max(200, (block.h ?? 3) * 46)),
  };
}

/* ── component ── */

export function BlockNode({ data }: NodeProps<BlockFlowNode>) {
  const handlers = useContext(MindmapContext);
  const { block, collapsed, cross } = data;
  const def = getBlockDef(block.type);

  const title = block.appearance?.title ?? def?.displayName ?? block.type;
  const accent =
    block.appearance?.accentColor ?? block.appearance?.borderColor ?? '#6366f1';
  const Icon = resolveIcon(block.appearance?.icon ?? def?.iconName, Box);
  const { w: bodyW, h: bodyH } = bodyDimensions(block, collapsed);

  const hasCross =
    !!cross && (cross.incoming.length > 0 || cross.outgoing.length > 0);

  const cardStyle: CSSProperties & Record<string, string | number> = { width: bodyW };
  cardStyle['--bn-accent'] = accent;

  return (
    <div
      className="block-node group relative rounded-xl border border-slate-200 bg-white shadow-md ring-1 ring-black/5"
      style={cardStyle}
    >
      {/* Сокеты */}
      <Handle type="target" position={Position.Left} id="in" className="block-node-handle" />
      <Handle type="source" position={Position.Right} id="out" className="block-node-handle" />

      {/* Шапка — drag handle */}
      <header className="block-node-drag-handle flex cursor-move items-center gap-1.5 rounded-t-xl border-b border-slate-100 bg-slate-50/80 px-2.5 py-1.5">
        <span
          aria-hidden
          className="h-3.5 w-1 shrink-0 rounded-full"
          style={{ background: accent }}
        />
        <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800" title={title}>
          {title}
        </span>

        <div className="nodrag flex shrink-0 items-center gap-0.5">
          {hasCross && cross && <CrossPills cross={cross} />}
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
                title={collapsed ? 'Развернуть блок' : 'Свернуть блок'}
                onClick={(e) => {
                  e.stopPropagation();
                  handlers.onToggleCollapse(block.id);
                }}
              >
                {collapsed ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </button>
            </>
          )}
        </div>
      </header>

      {/* Тело — живой блок */}
      <div className="overflow-hidden rounded-b-xl" style={{ height: bodyH }}>
        {def ? (
          <div
            className={
              collapsed
                ? 'pointer-events-none h-full w-full'
                : 'nodrag nowheel h-full w-full overflow-auto'
            }
            style={{ height: bodyH }}
          >
            <BlockSizeProvider minContent={def.minContentSize}>
              <def.Render
                instance={block}
                tenantId={handlers?.tenantId ?? ''}
                onConfigChange={
                  handlers
                    ? (cfg) => handlers.onConfigChange(block.id, cfg)
                    : undefined
                }
              />
            </BlockSizeProvider>
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center p-3 text-center text-[11px] text-slate-400">
            Неизвестный тип блока
            <br />
            {block.type}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── cross-page pills + popover ── */

function CrossPills({
  cross,
}: {
  cross: NonNullable<BlockNodeData['cross']>;
}) {
  const [open, setOpen] = useState<null | 'in' | 'out'>(null);

  return (
    <div className="relative flex items-center gap-0.5">
      {cross.incoming.length > 0 && (
        <button
          type="button"
          className="flex h-5 items-center gap-0.5 rounded-full bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700 transition hover:bg-emerald-200"
          title={`Получает данные из ${cross.incoming.length} блок(а/ов) на других страницах`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((p) => (p === 'in' ? null : 'in'));
          }}
        >
          ◀ {cross.incoming.length}
        </button>
      )}
      {cross.outgoing.length > 0 && (
        <button
          type="button"
          className="flex h-5 items-center gap-0.5 rounded-full bg-indigo-100 px-1.5 text-[10px] font-bold text-indigo-700 transition hover:bg-indigo-200"
          title={`Используется в ${cross.outgoing.length} блок(е/ах) на других страницах`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen((p) => (p === 'out' ? null : 'out'));
          }}
        >
          ▶ {cross.outgoing.length}
        </button>
      )}

      {open && (
        <div
          className="absolute right-0 top-full z-50 mt-1 w-60 rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-700 shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            {open === 'in' ? 'Входящие связи' : 'Исходящие связи'}
          </div>
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {(open === 'in' ? cross.incoming : cross.outgoing).map((link, i) => (
              <Link
                key={`${link.pageKey}:${link.blockId}:${i}`}
                href={pageHref(link.pageKey)}
                className="flex items-start justify-between gap-2 rounded-md p-1.5 transition hover:bg-slate-100"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{link.label}</div>
                  <div className="truncate text-[10px] text-slate-400">
                    {open === 'in' ? '←' : '→'} {link.pageLabel}
                  </div>
                </div>
                <ExternalLink className="h-3 w-3 shrink-0 text-slate-400" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export const blockNodeTypes = { blockNode: BlockNode };
