// PURPOSE: SVG-overlay показывающий связи между блоками (mindmap-стиль).
// Скрыт по умолчанию; toggle «Связи» делает видимым.
// Smart edge detection: линии идут от ближайших сторон блоков (top/right/bottom/left).
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockInstance } from '@/lib/blocks/types';
import { collectBlockRelationEdges } from '@/lib/blocks/relations';

type Props = {
  blocks: BlockInstance[];
  currentPageKey?: string;
  /** Контейнер grid'а — для позиционирования SVG поверх него и вычисления координат */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Показать связи (toggle button). Если false — ничего не рендерится. */
  highlighted: boolean;
};

type AnchorSide = 'top' | 'right' | 'bottom' | 'left';

type AnchorPoint = { x: number; y: number; side: AnchorSide };

type Edge = { fromId: string; toId: string; label?: string };

type PositionedEdge = Edge & {
  x1: number; y1: number; x2: number; y2: number;
  fromSide: AnchorSide; toSide: AnchorSide;
};

/* ── helpers ── */

function getBlockAnchors(
  rect: DOMRect,
  containerRect: DOMRect
): Record<AnchorSide, AnchorPoint> {
  const l = rect.left - containerRect.left;
  const t = rect.top - containerRect.top;
  const r = l + rect.width;
  const b = t + rect.height;
  const cx = l + rect.width / 2;
  const cy = t + rect.height / 2;
  return {
    top:    { x: cx, y: t, side: 'top' },
    right:  { x: r,  y: cy, side: 'right' },
    bottom: { x: cx, y: b, side: 'bottom' },
    left:   { x: l,  y: cy, side: 'left' },
  };
}

function getBestAnchors(
  fromRect: DOMRect,
  toRect: DOMRect,
  containerRect: DOMRect
): { from: AnchorPoint; to: AnchorPoint } {
  const fa = getBlockAnchors(fromRect, containerRect);
  const ta = getBlockAnchors(toRect, containerRect);

  const dx = (toRect.left + toRect.width / 2) - (fromRect.left + fromRect.width / 2);
  const dy = (toRect.top + toRect.height / 2) - (fromRect.top + fromRect.height / 2);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI); // -180..180

  let fs: AnchorSide;
  let ts: AnchorSide;

  if (angle >= -45 && angle < 45) {
    fs = 'right'; ts = 'left';
  } else if (angle >= 45 && angle < 135) {
    fs = 'bottom'; ts = 'top';
  } else if (angle >= -135 && angle < -45) {
    fs = 'top'; ts = 'bottom';
  } else {
    fs = 'left'; ts = 'right';
  }

  return { from: fa[fs], to: ta[ts] };
}

function buildPath(e: PositionedEdge): string {
  const dist = Math.hypot(e.x2 - e.x1, e.y2 - e.y1);
  const offset = Math.max(30, dist * 0.35);
  let cx1 = e.x1, cy1 = e.y1, cx2 = e.x2, cy2 = e.y2;

  switch (e.fromSide) {
    case 'right':  cx1 = e.x1 + offset; break;
    case 'left':   cx1 = e.x1 - offset; break;
    case 'bottom': cy1 = e.y1 + offset; break;
    case 'top':    cy1 = e.y1 - offset; break;
  }
  switch (e.toSide) {
    case 'right':  cx2 = e.x2 + offset; break;
    case 'left':   cx2 = e.x2 - offset; break;
    case 'bottom': cy2 = e.y2 + offset; break;
    case 'top':    cy2 = e.y2 - offset; break;
  }

  return `M ${e.x1} ${e.y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${e.x2} ${e.y2}`;
}

/* ── component ── */

const STROKE = '#6366f1';
const NODE_FILL = '#4f46e5';

export function BlockRelationsOverlay({ blocks, currentPageKey, containerRef, highlighted }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tick, setTick] = useState(0);
  const edgesRef = useRef<PositionedEdge[]>([]);

  const rawEdges = useMemo<Edge[]>(
    () => collectBlockRelationEdges(blocks, currentPageKey).map(({ fromId, toId, label }) => ({ fromId, toId, label })),
    [blocks, currentPageKey]
  );

  // Пересчитываем координаты только когда overlay видим
  useEffect(() => {
    if (!highlighted || rawEdges.length === 0) return;

    function recalc() {
      const container = containerRef.current;
      if (!container) return;
      const cr = container.getBoundingClientRect();
      if (cr.width === 0 || cr.height === 0) return;

      const next: PositionedEdge[] = [];
      for (const edge of rawEdges) {
        const fromEl = container.querySelector<HTMLElement>(`[data-block-id="${edge.fromId}"]`);
        const toEl = container.querySelector<HTMLElement>(`[data-block-id="${edge.toId}"]`);
        if (!fromEl || !toEl) continue;
        const { from: fa, to: ta } = getBestAnchors(
          fromEl.getBoundingClientRect(),
          toEl.getBoundingClientRect(),
          cr
        );
        next.push({
          ...edge,
          x1: fa.x, y1: fa.y, x2: ta.x, y2: ta.y,
          fromSide: fa.side, toSide: ta.side,
        });
      }
      edgesRef.current = next;
      setTick((t) => t + 1);
    }

    const timer = setTimeout(recalc, 200);
    const ro = new ResizeObserver(recalc);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', recalc);
    window.addEventListener('scroll', recalc, true);
    const interval = setInterval(recalc, 600);
    return () => {
      clearTimeout(timer);
      ro.disconnect();
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', recalc, true);
      clearInterval(interval);
    };
  }, [rawEdges, blocks, containerRef, highlighted]);

  void tick;
  const edges = edgesRef.current;

  // Полностью скрыт когда toggle выключен или связей нет
  if (!highlighted || rawEdges.length === 0) return null;

  return (
    <svg
      ref={svgRef}
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      style={{ overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="rel-arrow"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" fill={STROKE} fillOpacity={0.75} />
        </marker>
      </defs>

      {edges.map((edge, i) => {
        const path = buildPath(edge);
        const midX = (edge.x1 + edge.x2) / 2;
        const midY = (edge.y1 + edge.y2) / 2;
        return (
          <g key={`e-${edge.fromId}-${edge.toId}-${i}`}>
            {/* Bezier curve */}
            <path
              d={path}
              fill="none"
              stroke={STROKE}
              strokeWidth={2}
              strokeOpacity={0.65}
              markerEnd="url(#rel-arrow)"
              className="transition-all duration-300"
            />
            {/* Dot at source anchor */}
            <circle
              cx={edge.x1} cy={edge.y1} r={4}
              fill={NODE_FILL} fillOpacity={0.85}
              stroke="white" strokeWidth={1.5}
            />
            {/* Dot at target anchor */}
            <circle
              cx={edge.x2} cy={edge.y2} r={4}
              fill={NODE_FILL} fillOpacity={0.85}
              stroke="white" strokeWidth={1.5}
            />
            {/* Aggregation label pill */}
            {edge.label && (
              <g>
                <rect
                  x={midX - 24} y={midY - 9}
                  width="48" height="18" rx="9"
                  fill="white"
                  stroke={STROKE} strokeWidth={1} strokeOpacity={0.45}
                />
                <text
                  x={midX} y={midY + 4}
                  textAnchor="middle" fill={STROKE}
                  style={{ fontSize: 10, fontWeight: 600 }}
                >
                  {edge.label}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
