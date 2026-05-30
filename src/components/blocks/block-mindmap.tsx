// PURPOSE: Режим «Карта связей» — node-editor (React Flow) поверх блоков страницы.
// Блоки = перетаскиваемые узлы (гибрид compact/expanded), связи = bezier-нити.
// Раскладка узлов хранится отдельно в block.mindmap и не сбивает грид.
'use client';

import { useCallback, useEffect, useMemo } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from '@xyflow/react';
import type { BlockInstance } from '@/lib/blocks/types';
import { collectBlockRelationEdges, type BlockRelationEdge } from '@/lib/blocks/relations';
import { useCrossPageRelations } from '@/lib/blocks/use-cross-page-relations';
import { blockMindmapPosition, isBlockCollapsed } from '@/lib/blocks/mindmap-layout';
import {
  BlockNode,
  MindmapContext,
  type BlockFlowNode,
  type BlockNodeData,
  type MindmapHandlers,
} from './block-node';

import '@xyflow/react/dist/style.css';
import './block-mindmap.css';

const nodeTypes = { blockNode: BlockNode };

const STROKE = '#6366f1';
const DATA_SOURCE_STROKE = '#10b981';
const FORMULA_STROKE = '#8b5cf6';

function edgeColor(kind: BlockRelationEdge['kind']): string {
  if (kind === 'data-source') return DATA_SOURCE_STROKE;
  if (kind === 'formula') return FORMULA_STROKE;
  return STROKE;
}

export type BlockMindmapProps = {
  blocks: BlockInstance[];
  pageKey: string;
  tenantId: string;
  /** Сохранить новую позицию узла (после drag). */
  onMindmapMove: (id: string, position: { x: number; y: number }) => void;
  /** Свернуть/развернуть узел. */
  onToggleCollapse: (id: string) => void;
  onConfigChange: (id: string, config: Record<string, unknown>) => void;
  onOpenSettings: (id: string) => void;
  onOpenAi: (id: string) => void;
};

function BlockMindmapInner({
  blocks,
  pageKey,
  tenantId,
  onMindmapMove,
  onToggleCollapse,
  onConfigChange,
  onOpenSettings,
  onOpenAi,
}: BlockMindmapProps) {
  // Cross-page связи (для бейджей на узлах). Грузим только в режиме карты.
  const { relations: cross } = useCrossPageRelations(pageKey, true);

  const buildNode = useCallback(
    (block: BlockInstance, position: { x: number; y: number }): BlockFlowNode => {
      const data: BlockNodeData = {
        block,
        collapsed: isBlockCollapsed(block),
        cross: cross[block.id],
      };
      return {
        id: block.id,
        type: 'blockNode',
        position,
        data,
        dragHandle: '.block-node-drag-handle',
      };
    },
    [cross],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<BlockFlowNode>(
    blocks.map((b) => buildNode(b, blockMindmapPosition(b))),
  );

  // Синхронизация data при изменении блоков (config/collapse/cross),
  // СОХРАНЯЯ живую позицию узла (drag не должен прыгать).
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return blocks.map((b) => {
        const existing = prevById.get(b.id);
        const position = existing ? existing.position : blockMindmapPosition(b);
        const node = buildNode(b, position);
        return existing ? { ...node, selected: existing.selected } : node;
      });
    });
  }, [blocks, buildNode, setNodes]);

  const initialEdges = useMemo<Edge[]>(() => {
    const ids = new Set(blocks.map((b) => b.id));
    return collectBlockRelationEdges(blocks, pageKey)
      .filter((e) => ids.has(e.fromId) && ids.has(e.toId))
      .map((e, i) => {
        const color = edgeColor(e.kind);
        return {
          id: `${e.kind}:${e.fromId}->${e.toId}:${i}`,
          source: e.fromId,
          target: e.toId,
          sourceHandle: 'out',
          targetHandle: 'in',
          type: 'default',
          animated: e.kind === 'data-source',
          label: e.label,
          labelStyle: { fill: color, fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
          labelBgPadding: [4, 2] as [number, number],
          labelBgBorderRadius: 6,
          style: { stroke: color, strokeWidth: e.kind === 'data-source' ? 2.5 : 2 },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        } satisfies Edge;
      });
  }, [blocks, pageKey]);

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges);
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  const onNodeDragStop = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      onMindmapMove(node.id, {
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
      });
    },
    [onMindmapMove],
  );

  const handlers = useMemo<MindmapHandlers>(
    () => ({ tenantId, onToggleCollapse, onConfigChange, onOpenSettings, onOpenAi }),
    [tenantId, onToggleCollapse, onConfigChange, onOpenSettings, onOpenAi],
  );

  return (
    <MindmapContext.Provider value={handlers}>
      <div className="block-mindmap-root w-full overflow-hidden rounded-xl border border-slate-800">
        <ReactFlow<BlockFlowNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          nodesConnectable={false}
          connectOnClick={false}
          elementsSelectable
          nodesDraggable
          minZoom={0.2}
          maxZoom={1.75}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
          panOnScroll
          selectionOnDrag={false}
          proOptions={{ hideAttribution: false }}
          style={{ background: '#0b1220' }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="#334155" />
          <Controls className="block-mindmap-controls" />
          <MiniMap
            pannable
            zoomable
            nodeColor={() => '#6366f1'}
            nodeStrokeColor="#1e293b"
            maskColor="rgba(2, 6, 23, 0.6)"
            style={{ backgroundColor: '#0f172a' }}
          />
        </ReactFlow>
      </div>
    </MindmapContext.Provider>
  );
}

export function BlockMindmap(props: BlockMindmapProps) {
  return (
    <ReactFlowProvider>
      <BlockMindmapInner {...props} />
    </ReactFlowProvider>
  );
}

export default BlockMindmap;
