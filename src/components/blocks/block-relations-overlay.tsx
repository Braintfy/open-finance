// PURPOSE: SVG-overlay показывающий связи между блоками (mindmap-стиль).
// Полупрозрачный по умолчанию, кнопка-toggle делает его акцентным.
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockInstance } from '@/lib/blocks/types';

type Props = {
  blocks: BlockInstance[];
  /** Контейнер grid'а — для позиционирования SVG поверх него и вычисления координат */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Подсветить связи (toggle button). По умолчанию — полупрозрачно (не мешает). */
  highlighted: boolean;
};

type Edge = {
  fromId: string;
  toId: string;
  /** Подсказка для tooltip */
  label?: string;
};

export function BlockRelationsOverlay({ blocks, containerRef, highlighted }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [edges, setEdges] = useState<
    Array<Edge & { x1: number; y1: number; x2: number; y2: number }>
  >([]);

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

  // Пересчитываем координаты при resize / scroll / изменении layout
  useEffect(() => {
    function recalc() {
      const container = containerRef.current;
      const svg = svgRef.current;
      if (!container || !svg) return;
      const containerRect = container.getBoundingClientRect();
      const next: Array<Edge & { x1: number; y1: number; x2: number; y2: number }> = [];
      for (const edge of rawEdges) {
        const fromEl = container.querySelector<HTMLElement>(`[data-block-id="${edge.fromId}"]`);
        const toEl = container.querySelector<HTMLElement>(`[data-block-id="${edge.toId}"]`);
        if (!fromEl || !toEl) continue;
        const fromRect = fromEl.getBoundingClientRect();
        const toRect = toEl.getBoundingClientRect();
        // Используем центры блоков
        const x1 = fromRect.left + fromRect.width / 2 - containerRect.left;
        const y1 = fromRect.top + fromRect.height / 2 - containerRect.top;
        const x2 = toRect.left + toRect.width / 2 - containerRect.left;
        const y2 = toRect.top + toRect.height / 2 - containerRect.top;
        next.push({ ...edge, x1, y1, x2, y2 });
      }
      setEdges(next);
    }

    recalc();
    const ro = new ResizeObserver(recalc);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', recalc);
    window.addEventListener('scroll', recalc, true);
    // Также пересчитываем при ре-рендере — RGL анимирует позиции
    const interval = setInterval(recalc, 300);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', recalc);
      window.removeEventListener('scroll', recalc, true);
      clearInterval(interval);
    };
  }, [rawEdges, containerRef]);

  if (edges.length === 0) return null;

  // FIX: CSS-переменные `var(--primary)` НЕ работают в SVG-атрибутах stroke/fill —
  // только в style. Используем явный hex/rgb. По умолчанию — синий (Tailwind blue-500),
  // в highlighted — насыщенный indigo (более акцентный).
  const STROKE_COLOR = highlighted ? '#4f46e5' : '#3b82f6';
  const strokeOpacity = highlighted ? 0.9 : 0.35;
  const strokeWidth = highlighted ? 2.5 : 1.8;
  const labelOpacity = highlighted ? 1 : 0.5;

  return (
    <svg
      ref={svgRef}
      className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      style={{ overflow: 'visible' }}
      aria-hidden="true"
    >
      <defs>
        <marker
          id={`block-arrow-${highlighted ? 'hl' : 'dim'}`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="5"
          markerHeight="5"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill={STROKE_COLOR} fillOpacity={strokeOpacity} />
        </marker>
      </defs>
      {edges.map((edge, i) => {
        // Bezier curve между центрами блоков для красоты
        const dx = edge.x2 - edge.x1;
        const dy = edge.y2 - edge.y1;
        // control points смещены вертикально для естественной кривизны
        const cx1 = edge.x1 + dx * 0.5;
        const cy1 = edge.y1 + Math.abs(dy) * 0.3 + 30;
        const cx2 = edge.x2 - dx * 0.5;
        const cy2 = edge.y2 - Math.abs(dy) * 0.3 - 30;
        const path = `M ${edge.x1} ${edge.y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${edge.x2} ${edge.y2}`;
        const midX = (edge.x1 + edge.x2) / 2;
        const midY = (edge.y1 + edge.y2) / 2 + 10;
        return (
          <g key={`${edge.fromId}-${edge.toId}-${i}`}>
            <path
              d={path}
              fill="none"
              stroke={STROKE_COLOR}
              strokeWidth={strokeWidth}
              strokeOpacity={strokeOpacity}
              strokeDasharray={highlighted ? '0' : '5 4'}
              markerEnd={`url(#block-arrow-${highlighted ? 'hl' : 'dim'})`}
              className="transition-all duration-300"
            />
            {highlighted && edge.label && (
              <g style={{ opacity: labelOpacity }} className="transition-opacity duration-300">
                <rect
                  x={midX - 22}
                  y={midY - 9}
                  width="44"
                  height="18"
                  rx="9"
                  fill="white"
                  stroke={STROKE_COLOR}
                  strokeOpacity={0.5}
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
    </svg>
  );
}
