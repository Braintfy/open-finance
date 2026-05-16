// PURPOSE: SVG-overlay показывающий связи между блоками (mindmap-стиль).
// Скрыт по умолчанию; toggle «Связи» делает видимым.
// Smart edge detection: линии идут от ближайших сторон блоков (top/right/bottom/left).
//
// Cross-page треугольнички:
//   ▶ (outward) — данные ИЗ этого блока используются на другой странице
//   ◀ (inward)  — этот блок ПОЛУЧАЕТ данные с другой страницы
// Кликабельные: открывают popover со списком конкретных блоков-целей.
'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { BlockInstance } from '@/lib/blocks/types';
import { collectBlockRelationEdges } from '@/lib/blocks/relations';
import {
  pageHref,
  useCrossPageRelations,
  type CrossPageLink,
} from '@/lib/blocks/use-cross-page-relations';

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

/** Bounding-box каждого блока, чтобы расставить треугольнички по углам. */
type BlockBox = {
  blockId: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
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
/** Размер треугольника-маркера cross-page связи (квадратный bbox). */
const TRI_SIZE = 14;
/** Радиус edge-anchor circle (см. <circle r={4} /> ниже). Должен быть в синке. */
const ANCHOR_R = 4;
/** Минимальный gap между низом anchor-кружочка и верхом треугольника. */
const ANCHOR_TRI_GAP = 6;

export function BlockRelationsOverlay({ blocks, currentPageKey, containerRef, highlighted }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [tick, setTick] = useState(0);
  const edgesRef = useRef<PositionedEdge[]>([]);
  const boxesRef = useRef<BlockBox[]>([]);
  /** Открытый popover: ключ blockId+direction, чтобы был открыт максимум один. */
  const [openPopover, setOpenPopover] = useState<string | null>(null);

  const rawEdges = useMemo<Edge[]>(
    () => collectBlockRelationEdges(blocks, currentPageKey).map(({ fromId, toId, label }) => ({ fromId, toId, label })),
    [blocks, currentPageKey]
  );

  // Cross-page связи блоков на текущей странице (incoming/outgoing).
  // Грузим только когда overlay видим — экономит сеть.
  const { relations: crossRelations } = useCrossPageRelations(currentPageKey ?? '', highlighted);

  // Пересчитываем координаты только когда overlay видим
  useEffect(() => {
    if (!highlighted) return;

    function recalc() {
      const container = containerRef.current;
      if (!container) return;
      const cr = container.getBoundingClientRect();
      if (cr.width === 0 || cr.height === 0) return;

      // Edges
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

      // Boxes — для треугольничков. Берём ВСЕ блоки на странице (не только
      // те, что в edges), потому что cross-page связи могут быть и без локальных.
      const boxes: BlockBox[] = [];
      for (const block of blocks) {
        const el = container.querySelector<HTMLElement>(`[data-block-id="${block.id}"]`);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        boxes.push({
          blockId: block.id,
          left: rect.left - cr.left,
          top: rect.top - cr.top,
          right: rect.left - cr.left + rect.width,
          bottom: rect.top - cr.top + rect.height,
        });
      }
      boxesRef.current = boxes;

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
  const boxes = boxesRef.current;

  // Закрываем popover при клике вне
  useEffect(() => {
    if (!openPopover) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-cross-rel-popover]')) return;
      if (target?.closest('[data-cross-rel-trigger]')) return;
      setOpenPopover(null);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openPopover]);

  const hasAnythingToShow =
    rawEdges.length > 0 ||
    Object.values(crossRelations).some(
      (r) => r.incoming.length > 0 || r.outgoing.length > 0,
    );

  if (!highlighted || !hasAnythingToShow) return null;

  return (
    <>
      {/* SVG-слой: edges + триугольники как графика */}
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
              <path
                d={path}
                fill="none"
                stroke={STROKE}
                strokeWidth={2}
                strokeOpacity={0.65}
                markerEnd="url(#rel-arrow)"
                className="transition-all duration-300"
              />
              <circle
                cx={edge.x1} cy={edge.y1} r={4}
                fill={NODE_FILL} fillOpacity={0.85}
                stroke="white" strokeWidth={1.5}
              />
              <circle
                cx={edge.x2} cy={edge.y2} r={4}
                fill={NODE_FILL} fillOpacity={0.85}
                stroke="white" strokeWidth={1.5}
              />
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

      {/*
        HTML-overlay для треугольничков: позволяет нативный hover/click и popover
        в стиле сайта (тёмная тема, ring, shadow). SVG здесь не годится —
        нет border-radius, focus-visible, etc.
      */}
      <div className="pointer-events-none absolute inset-0 z-20 h-full w-full">
        {boxes.map((box) => {
          const rel = crossRelations[box.blockId];
          if (!rel || (rel.incoming.length === 0 && rel.outgoing.length === 0)) {
            return null;
          }
          const incomingKey = `in:${box.blockId}`;
          const outgoingKey = `out:${box.blockId}`;

          // Anchor-кружочки (edge-точки локальных связей) рисуются в SVG в
          // вертикальном центре левого/правого ребра блока (cx = box.left/right,
          // cy = anchorCenterY). Треугольник — отдельный «второй узел» сразу
          // ПОД кружочком, на той же вертикальной оси (= край блока), чтобы
          // визуально читался как продолжение того же anchor-ряда.
          //   triTop  = anchorCenterY + ANCHOR_R + ANCHOR_TRI_GAP
          //   triLeft = edgeX - TRI_SIZE/2  (центр треугольника на ребре блока)
          const anchorCenterY = (box.top + box.bottom) / 2;
          let triTop = anchorCenterY + ANCHOR_R + ANCHOR_TRI_GAP;
          // Защита от вылета за нижнюю границу для совсем маленьких блоков.
          const maxTriTop = box.bottom - TRI_SIZE / 2 - 2;
          if (triTop > maxTriTop) triTop = maxTriTop;
          return (
            <div key={`tri-${box.blockId}`}>
              {/* Incoming — на левом ребре блока (под кружочком), apex ▶ внутрь */}
              {rel.incoming.length > 0 && (
                <CrossPageTriangle
                  direction="incoming"
                  count={rel.incoming.length}
                  links={rel.incoming}
                  open={openPopover === incomingKey}
                  onToggle={() =>
                    setOpenPopover((prev) => (prev === incomingKey ? null : incomingKey))
                  }
                  style={{
                    left: box.left - TRI_SIZE / 2,
                    top: triTop,
                  }}
                />
              )}
              {/* Outgoing — на правом ребре блока (под кружочком), apex ▶ наружу */}
              {rel.outgoing.length > 0 && (
                <CrossPageTriangle
                  direction="outgoing"
                  count={rel.outgoing.length}
                  links={rel.outgoing}
                  open={openPopover === outgoingKey}
                  onToggle={() =>
                    setOpenPopover((prev) => (prev === outgoingKey ? null : outgoingKey))
                  }
                  style={{
                    left: box.right - TRI_SIZE / 2,
                    top: triTop,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* ── Cross-page triangle (HTML/SVG hybrid) ── */

function CrossPageTriangle({
  direction,
  count,
  links,
  open,
  onToggle,
  style,
}: {
  direction: 'incoming' | 'outgoing';
  count: number;
  links: CrossPageLink[];
  open: boolean;
  onToggle: () => void;
  style: React.CSSProperties;
}) {
  // Сами треугольники-кнопки получают pointer-events-auto, остальной overlay — нет.
  const tooltip =
    direction === 'incoming'
      ? `Получает данные из ${count} блок(а/ов) на других страницах. Клик — список.`
      : `Используется в ${count} блок(е/ах) на других страницах. Клик — список.`;

  return (
    <div className="pointer-events-auto absolute" style={style}>
      <button
        type="button"
        data-cross-rel-trigger
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        title={tooltip}
        aria-label={tooltip}
        className="group relative flex items-center"
      >
        <svg
          width={TRI_SIZE}
          height={TRI_SIZE}
          viewBox="0 0 14 14"
          className={
            'drop-shadow-sm transition-transform group-hover:scale-110 ' +
            (open ? 'scale-110' : '')
          }
        >
          {/*
            Оба треугольника — ▶ (apex смотрит вправо).
            Incoming сидит на LEFT-edge блока: apex ▶ = ВНУТРЬ блока (вправо).
            Outgoing сидит на RIGHT-edge блока: apex ▶ = НАРУЖУ блока (вправо, в соседнюю страницу).
            Цвет: incoming — emerald (приходящее), outgoing — indigo (уходящее).
          */}
          <polygon
            points="2,2 2,12 12,7"
            fill={direction === 'incoming' ? '#10b981' : '#6366f1'}
            stroke="white"
            strokeWidth={1}
          />
        </svg>
        {count > 1 && (
          <span
            className={
              'absolute -right-2 -top-1.5 flex h-3.5 min-w-[14px] items-center justify-center rounded-full px-0.5 text-[8px] font-bold text-white shadow ' +
              (direction === 'incoming' ? 'bg-emerald-500' : 'bg-indigo-500')
            }
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div
          data-cross-rel-popover
          className="pointer-events-auto absolute left-0 top-full z-30 mt-1 w-64 rounded-lg border border-border bg-popover p-2 text-xs text-popover-foreground shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            {direction === 'incoming' ? (
              <>
                <span className="text-emerald-500">◀</span> Входящие
              </>
            ) : (
              <>
                <span className="text-indigo-500">▶</span> Исходящие
              </>
            )}
            <span className="text-muted-foreground/70">·</span>
            <span className="text-muted-foreground/70">{count}</span>
          </div>
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {links.map((link, i) => (
              <Link
                key={`${link.pageKey}:${link.blockId}:${i}`}
                href={pageHref(link.pageKey)}
                className="flex items-start justify-between gap-2 rounded-md p-1.5 transition hover:bg-accent"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{link.label}</div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    {direction === 'incoming' ? '←' : '→'} {link.pageLabel}
                  </div>
                </div>
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
