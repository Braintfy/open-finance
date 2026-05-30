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
