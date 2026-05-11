// PURPOSE: SVG-overlay показывающий связи между блоками (mindmap-стиль).
// Видимый по умолчанию с мягкой прозрачностью; toggle делает акцентным.
// Узлы (кружки) + линии + лейблы агрегации + треугольник внешних связей.
'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { BlockInstance } from '@/lib/blocks/types';
import { getBlockDef } from '@/lib/blocks/registry';

type Props = {
  blocks: BlockInstance[];
  /** Контейнер grid'а — для позиционирования SVG поверх него и вычисления координат */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Подсветить связи (toggle button). По умолчанию — мягко видно. */
  highlighted: boolean;
};

type Edge = {
  fromId: string;
  toId: string;
  label?: string;
};

type NodePos = {
  id: string;
  cx: number;
  cy: number;
  label: string;
  /** Количество внешних (cross-page) связей */
  externalCount: number;
  externalPages: string[];
};

export function BlockRelationsOverlay({ blocks, containerRef, highlighted }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [edges, setEdges] = useState<
    Array<Edge & { x1: number; y1: number; x2: number; y2: number }>
  >([]);
  const [nodes, setNodes] = useState<NodePos[]>([]);

  // Извлекаем граф зависимостей из блоков
  const rawEdges = useMemo<Edge[]>(() => {
    const list: Edge[] = [];
    for (const b of blocks) {
      const deps = b.dependencies;
      if (!deps || deps.sources.length === 0) continue;
      for (const src of deps.sources) {
        list.push({
          fromId: src.blockId,
          toId: b.id,
          label: deps.aggregation,
        });
      }
    }
    return list;
  }, [blocks]);

  // Блоки, участвующие в связях
  const participatingIds = useMemo(() => {
    const set = new Set<string>();
    for (const e of rawEdges) {
      set.add(e.fromId);
      set.add(e.toId);
    }
    return set;
  }, [rawEdges]);

  // Внешние связи (cross-page)
  const externalMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const b of blocks) {
      if (!b.dependencies) continue;
      const extPages: string[] = [];
      for (const src of b.dependencies.sources) {
        if (src.pageKey) extPages.push(src.pageKey);
      }
      if (extPages.length > 0) map.set(b.id, extPages);
    }
    return map;
  }, [blocks]);

  // Пересчитываем координаты при resize / scroll / изменении layout
  useEffect(() => {
    function recalc() {
      const container = containerRef.current;
      const svg = svgRef.current;
      if (!container || !svg) return;
      const containerRect = container.getBoundingClientRect();

      // Edges
      const nextEdges: Array<Edge & { x1: number; y1: number; x2: number; y2: number }> = [];
      for (const edge of rawEdges) {
        const fromEl = container.querySelector<HTMLElement>(`[data-block-id="${edge.fromId}"]`);
        const toEl = container.querySelector<HTMLElement>(`[data-block-id="${edge.toId}"]`);
        if (!fromEl || !toEl) continue;
        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        // Используем точку на краю блока (bottom-center → top-center)
        const x1 = fromRect.left + fromRect.width / 2 - containerRect.left;
        const y1 = fromRect.bottom - containerRect.top;
        const x2 = toRect.left + toRect.width / 2 - containerRect.left;
        const y2 = toRect.top - containerRect.top;
        nextEdges.push({ ...edge, x1, y1, x2, y2 });
      }
      setEdges(nextEdges);

      // Nodes — все блоки участвующие в связях
      const nextNodes: NodePos[] = [];
      for (const id of participatingIds) {
        const el = container.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const block = blocks.find((b) => b.id === id);
        const def = block ? getBlockDef(block.type) : undefined;
        const label = block?.appearance?.title ?? def?.displayName ?? id.slice(0, 8);
        const extPages = externalMap.get(id) ?? [];
        nextNodes.push({
          id,
          cx: rect.left + rect.width / 2 - containerRect.left,
          cy: rect.bottom - containerRect.top,
          label,
          externalCount: extPages.length,
          externalPages: extPages,
        });
      }
      setNodes(nextNodes);
    }

    recalc();
    const ro = new ResizeObserver(recalc);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', recalc);
    window.addEventListener('scroll', recalc, true);
    const interval = setInterval(recalc, 400);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', recalc, true);
      clearInterval(interval);
    };
  }, [rawEdges, participatingIds, externalMap, blocks, containerRef]);

  if (edges.length === 0 && nodes.length === 0) return null;

  // FIX: CSS-переменные НЕ работают в SVG-атрибутах — только inline hex.
  const STROKE_COLOR = highlighted ? '#4f46e5' : '#6366f1';
  const strokeOpacity = highlighted ? 0.85 : 0.5;
  const strokeWidth = highlighted ? 2.5 : 2;
  const NODE_FILL = highlighted ? '#4f46e5' : '#6366f1';
  const nodeRadius = highlighted ? 5 : 4;

  return (
    <>
      <svg
        ref={svgRef}
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        style={{ overflow: 'visible' }}
        aria-hidden="true"
      >
        <defs>
          <marker
            id={`rel-arrow-${highlighted ? 'hl' : 'dim'}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 1 L 10 5 L 0 9 z" fill={STROKE_COLOR} fillOpacity={strokeOpacity} />
          </marker>
        </defs>

        {/* Edges — bezier curves */}
        {edges.map((edge, i) => {
          const dy = edge.y2 - edge.y1;
          const cpOffset = Math.max(30, Math.abs(dy) * 0.4);
          const path = `M ${edge.x1} ${edge.y1} C ${edge.x1} ${edge.y1 + cpOffset}, ${edge.x2} ${edge.y2 - cpOffset}, ${edge.x2} ${edge.y2}`;
          const midX = (edge.x1 + edge.x2) / 2;
          const midY = (edge.y1 + edge.y2) / 2;
          return (
            <g key={`e-${edge.fromId}-${edge.toId}-${i}`}>
              <path
                d={path}
                fill="none"
                stroke={STROKE_COLOR}
                strokeWidth={strokeWidth}
                strokeOpacity={strokeOpacity}
                markerEnd={`url(#rel-arrow-${highlighted ? 'hl' : 'dim'})`}
                className="transition-all duration-300"
              />
              {highlighted && edge.label && (
                <g className="transition-opacity duration-300">
                  <rect
                    x={midX - 24}
                    y={midY - 9}
                    width="48"
                    height="18"
                    rx="9"
                    fill="white"
                    stroke={STROKE_COLOR}
                    strokeWidth={1}
                    strokeOpacity={0.6}
                  />
                  <text
                    x={midX}
                    y={midY + 4}
                    textAnchor="middle"
                    fill={STROKE_COLOR}
                    style={{ fontSize: 10, fontWeight: 600 }}
                  >
                    {edge.label}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Nodes — dot circles at block edges */}
        {nodes.map((n) => (
          <g key={`n-${n.id}`}>
            <circle
              cx={n.cx}
              cy={n.cy}
              r={nodeRadius}
              fill={NODE_FILL}
              fillOpacity={strokeOpacity}
              stroke="white"
              strokeWidth={1.5}
              className="transition-all duration-300"
            />
          </g>
        ))}
      </svg>

      {/* HTML-based external link triangles (need pointer-events for hover) */}
      {nodes
        .filter((n) => n.externalCount > 0)
        .map((n) => (
          <ExternalLinkIndicator key={`ext-${n.id}`} node={n} highlighted={highlighted} />
        ))}
    </>
  );
}

function ExternalLinkIndicator({
  node,
  highlighted,
}: {
  node: NodePos;
  highlighted: boolean;
}) {
  const [hover, setHover] = useState(false);
  const color = highlighted ? '#4f46e5' : '#6366f1';
  const opacity = highlighted ? 0.9 : 0.6;

  const style: CSSProperties = {
    position: 'absolute',
    left: node.cx + 8,
    top: node.cy - 6,
    zIndex: 20,
  };

  return (
    <div style={style}>
      <div
        className="relative cursor-pointer"
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
      >
        {/* Triangle indicator */}
        <svg width="14" height="12" viewBox="0 0 14 12" style={{ opacity }}>
          <path d="M 7 0 L 14 12 L 0 12 Z" fill={color} />
          <text
            x="7"
            y="10"
            textAnchor="middle"
            fill="white"
            style={{ fontSize: 7, fontWeight: 700 }}
          >
            {node.externalCount}
          </text>
        </svg>

        {/* Hover tooltip */}
        {hover && (
          <div className="absolute left-4 top-0 z-50 min-w-[140px] rounded-md border border-border/60 bg-background p-2 shadow-lg">
            <div className="mb-1 text-[10px] font-semibold text-foreground">
              Внешние связи
            </div>
            <div className="text-[10px] text-muted-foreground">
              Блок: <span className="font-medium text-foreground">{node.label}</span>
            </div>
            <div className="mt-1 space-y-0.5">
              {node.externalPages.map((page, i) => (
                <div key={i} className="flex items-center gap-1 text-[10px]">
                  <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-muted-foreground">Страница:</span>
                  <span className="font-medium text-foreground">{page}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
