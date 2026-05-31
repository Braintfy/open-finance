// PURPOSE: Режим «Карта связей» — node-editor (React Flow) поверх блоков страницы.
// Блоки = перетаскиваемые узлы (гибрид compact/expanded), связи = bezier-нити.
// Раскладка узлов хранится отдельно в block.mindmap и не сбивает грид.
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Background,
  BackgroundVariant,
  ControlButton,
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
import { Magnet } from 'lucide-react';
import type { BlockInstance } from '@/lib/blocks/types';
import { collectBlockRelationEdges, type BlockRelationEdge } from '@/lib/blocks/relations';
import { useCrossPageRelations, type CrossPageLink } from '@/lib/blocks/use-cross-page-relations';
import {
  MINDMAP_SNAP,
  blockMindmapPosition,
  computeInitialPositions,
  isBlockCollapsed,
} from '@/lib/blocks/mindmap-layout';
import { getMapPreviewSize } from './map-previews';
import {
  BlockNode,
  MindmapContext,
  type BlockFlowNode,
  type BlockNodeData,
  type MindmapHandlers,
} from './block-node';
import { GhostNode, type GhostFlowNode } from './ghost-node';

import '@xyflow/react/dist/style.css';
import './block-mindmap.css';

const nodeTypes = { blockNode: BlockNode, ghostNode: GhostNode };

const STROKE = '#6366f1';
const DATA_SOURCE_STROKE = '#10b981';
const FORMULA_STROKE = '#8b5cf6';
const GHOST_STROKE = '#94a3b8';

function edgeColor(kind: BlockRelationEdge['kind']): string {
  if (kind === 'data-source') return DATA_SOURCE_STROKE;
  if (kind === 'formula') return FORMULA_STROKE;
  return STROKE;
}

/** Размер превью-узла блока (для компактной раскладки и позиций соседей). */
const sizeOf = (block: BlockInstance) => getMapPreviewSize(block.type);

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
  // Cross-page связи — для призрачных карточек соседей. Грузим только в режиме карты.
  const { relations: cross } = useCrossPageRelations(pageKey, true);
  const [snap, setSnap] = useState(true);

  const buildNode = useCallback(
    (block: BlockInstance, position: { x: number; y: number }): BlockFlowNode => {
      const data: BlockNodeData = {
        block,
        collapsed: isBlockCollapsed(block),
      };
      return {
        id: block.id,
        type: 'blockNode',
        position,
        data,
        dragHandle: '.block-node-drag-handle',
      };
    },
    [],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(
    (() => {
      const positions = computeInitialPositions(blocks, sizeOf);
      return blocks.map((b) => buildNode(b, positions.get(b.id) ?? blockMindmapPosition(b)));
    })(),
  );

  // Синхронизация data при изменении блоков (config/collapse),
  // СОХРАНЯЯ живую позицию узла (drag не должен прыгать).
  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      const positions = computeInitialPositions(blocks, sizeOf);
      return blocks.map((b) => {
        const existing = prevById.get(b.id);
        const position = existing ? existing.position : positions.get(b.id) ?? blockMindmapPosition(b);
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

  // Призрачные карточки соседей из других разделов + пунктирные связи к ним.
  const { ghostNodes, ghostEdges } = useMemo(() => {
    const positions = computeInitialPositions(blocks, sizeOf);
    let maxX = 0;
    let minY = 0;
    let first = true;
    for (const b of blocks) {
      const p = positions.get(b.id) ?? blockMindmapPosition(b);
      const s = sizeOf(b);
      if (first) {
        minY = p.y;
        first = false;
      }
      maxX = Math.max(maxX, p.x + s.w);
      minY = Math.min(minY, p.y);
    }
    const colX = maxX + 160;

    const ghosts = new Map<string, GhostFlowNode>();
    const edgeList: Edge[] = [];
    const seenEdge = new Set<string>();

    const ghostId = (link: CrossPageLink) => `ghost:${link.pageKey}:${link.blockId}`;
    const ensureGhost = (link: CrossPageLink) => {
      const id = ghostId(link);
      if (!ghosts.has(id)) {
        ghosts.set(id, {
          id,
          type: 'ghostNode',
          position: { x: colX, y: minY + ghosts.size * 132 },
          draggable: false,
          selectable: false,
          connectable: false,
          data: {
            blockType: link.type,
            label: link.label,
            pageKey: link.pageKey,
            pageLabel: link.pageLabel,
          },
        });
      }
      return id;
    };
    const addGhostEdge = (source: string, target: string) => {
      const key = `${source}->${target}`;
      if (seenEdge.has(key)) return;
      seenEdge.add(key);
      edgeList.push({
        id: `ghost:${key}`,
        source,
        target,
        sourceHandle: 'out',
        targetHandle: 'in',
        type: 'default',
        style: { stroke: GHOST_STROKE, strokeWidth: 1.5, strokeDasharray: '5 4' },
        markerEnd: { type: MarkerType.ArrowClosed, color: GHOST_STROKE, width: 14, height: 14 },
      });
    };

    for (const b of blocks) {
      const rel = cross[b.id];
      if (!rel) continue;
      for (const link of rel.incoming) addGhostEdge(ensureGhost(link), b.id);
      for (const link of rel.outgoing) addGhostEdge(b.id, ensureGhost(link));
    }

    return { ghostNodes: Array.from(ghosts.values()), ghostEdges: edgeList };
  }, [blocks, cross]);

  const allNodes = useMemo<Node[]>(() => [...nodes, ...ghostNodes], [nodes, ghostNodes]);
  const allEdges = useMemo<Edge[]>(() => [...edges, ...ghostEdges], [edges, ghostEdges]);

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
        <ReactFlow
          nodes={allNodes}
          edges={allEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          nodesConnectable={false}
          connectOnClick={false}
          elementsSelectable
          nodesDraggable
          snapToGrid={snap}
          snapGrid={[MINDMAP_SNAP, MINDMAP_SNAP]}
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
          <Controls className="block-mindmap-controls">
            <ControlButton
              onClick={() => setSnap((s) => !s)}
              title={snap ? 'Выключить привязку к сетке' : 'Включить привязку к сетке'}
              className={snap ? 'block-mindmap-snap-active' : undefined}
            >
              <Magnet />
            </ControlButton>
          </Controls>
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
