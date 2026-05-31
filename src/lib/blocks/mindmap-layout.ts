// PURPOSE: Хелперы раскладки узлов в режиме «Карта связей» (mindmap).
// Лёгкий модуль без зависимости от React Flow — импортируется и в block-grid
// (для toggle-collapse без потери позиции), и в block-mindmap (для сидирования).
import type { BlockInstance } from './types';

/** Шаг сетки при выводе стартовой позиции узла из грид-координат. */
export const MINDMAP_COL_STEP = 180;
export const MINDMAP_ROW_STEP = 70;

/** Стартовая позиция узла на canvas, выведенная из грид-координат блока. */
export function initialMindmapPosition(block: BlockInstance): { x: number; y: number } {
  return {
    x: (block.x ?? 0) * MINDMAP_COL_STEP,
    y: (block.y ?? 0) * MINDMAP_ROW_STEP,
  };
}

/** Текущая позиция узла: сохранённая mindmap-раскладка или выведенная из грида. */
export function blockMindmapPosition(block: BlockInstance): { x: number; y: number } {
  return block.mindmap
    ? { x: block.mindmap.x, y: block.mindmap.y }
    : initialMindmapPosition(block);
}

/** Свёрнут ли узел по умолчанию (компактная карточка). */
export function isBlockCollapsed(block: BlockInstance): boolean {
  return block.mindmap?.collapsed ?? true;
}

/** Шаг привязки к сетке на canvas карты (px). */
export const MINDMAP_SNAP = 16;

/** Округляет координату к шагу snap-сетки. */
export function snapTo(value: number, step: number = MINDMAP_SNAP): number {
  return Math.round(value / step) * step;
}

type NodeSize = { w: number; h: number };

/**
 * Компактная раскладка узлов рядами около (0,0). Детерминированно, без
 * зависимостей. Порядок сохраняет грубую раскладку грида (сорт по y,x).
 *  - cols = clamp(ceil(sqrt(N)), 3, 6) — в пределах ~5–10 «клеток» по ширине.
 *  - высота ряда = max высота узла в ряду; шаг с учётом size + gap.
 *  - все позиции выровнены по snap-сетке.
 */
export function computeCompactLayout(
  blocks: BlockInstance[],
  sizeOf: (block: BlockInstance) => NodeSize,
  opts?: { snap?: number; gap?: number; startX?: number; startY?: number },
): Map<string, { x: number; y: number }> {
  const snap = opts?.snap ?? MINDMAP_SNAP;
  const gap = opts?.gap ?? 32;
  const startX = opts?.startX ?? 0;
  const startY = opts?.startY ?? 0;

  const positions = new Map<string, { x: number; y: number }>();
  if (blocks.length === 0) return positions;

  const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(blocks.length))));
  const sorted = [...blocks].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));

  const rows: BlockInstance[][] = [];
  for (let i = 0; i < sorted.length; i += cols) {
    rows.push(sorted.slice(i, i + cols));
  }

  let y = startY;
  for (const row of rows) {
    let x = startX;
    let rowMaxH = 0;
    for (const block of row) {
      const size = sizeOf(block);
      positions.set(block.id, { x: snapTo(x, snap), y: snapTo(y, snap) });
      x += size.w + gap;
      rowMaxH = Math.max(rowMaxH, size.h);
    }
    y += rowMaxH + gap;
  }

  return positions;
}

/**
 * Начальные позиции при входе на карту: для блоков с сохранённым `mindmap`
 * берём их позиции, остальные компактно допаковываем (ниже bounding-box
 * сохранённых, либо от origin если сохранённых нет).
 */
export function computeInitialPositions(
  blocks: BlockInstance[],
  sizeOf: (block: BlockInstance) => NodeSize,
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  const saved = blocks.filter((b) => b.mindmap);
  const unsaved = blocks.filter((b) => !b.mindmap);

  for (const b of saved) {
    result.set(b.id, { x: b.mindmap!.x, y: b.mindmap!.y });
  }

  if (unsaved.length > 0) {
    let startY = 0;
    if (saved.length > 0) {
      startY =
        Math.max(...saved.map((b) => b.mindmap!.y + sizeOf(b).h)) + 48;
    }
    const packed = computeCompactLayout(unsaved, sizeOf, { startY });
    for (const [id, pos] of packed) result.set(id, pos);
  }

  return result;
}
