// PURPOSE: Утилиты и константы для source binding (привязка cashflow KPI/chart/
// top-categories/kpi.grid к блоку `cashflow.transactions`).
//
// Что здесь:
//   - `BOUND_BLOCK_TYPES`            — какие типы блоков поддерживают binding.
//   - `getSourceBinding`             — извлечь binding из config блока (с дефолтом).
//   - `applySourceBindingMigration`  — idempotent auto-bind для legacy блоков
//                                      (в `sanitizeBlocks` при загрузке layout).
//   - `collectSourceBindingEdges`    — для `relations.ts` (mindmap edges с
//                                      kind='data-source').
//
// Этот модуль НЕ импортирует React/UI — его можно использовать на сервере
// (sanitizeBlocks вызывается в queries.ts/sources route) и в unit-тестах.

import type { BlockInstance, SourceBinding } from './types';

/**
 * Типы блоков, которые поддерживают source binding. Все они — потребители
 * cashflow данных. `cashflow.transactions` сам является «источником» и в
 * этот список не входит.
 */
export const BOUND_BLOCK_TYPES = [
  'stat.income',
  'stat.expense',
  'stat.balance',
  'stat.custom',
  'cashflow.top-categories',
  'chart.cashflow',
  'kpi.grid',
] as const;

export type BoundBlockType = (typeof BOUND_BLOCK_TYPES)[number];

export function isBoundBlockType(type: string): type is BoundBlockType {
  return (BOUND_BLOCK_TYPES as readonly string[]).includes(type);
}

/** Дефолтный binding для новых блоков (пока юзер не выбрал источник). */
export const DEFAULT_SOURCE_BINDING: SourceBinding = { mode: 'empty' };

/** Sentinel для `cashflow.transactions` — он сам источник, не bound. */
export const TX_BLOCK_TYPE = 'cashflow.transactions';

/**
 * Безопасно извлекает `sourceBinding` из конфига блока. Возвращает `undefined`,
 * если поля нет (для отличия «миграция ещё не применилась» от явно `{empty}`).
 */
export function readSourceBinding(
  config: Record<string, unknown> | undefined,
): SourceBinding | undefined {
  const raw = config?.sourceBinding;
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.mode === 'empty') return { mode: 'empty' };
  if (obj.mode === 'global') return { mode: 'global' };
  if (obj.mode === 'block' && typeof obj.blockId === 'string' && obj.blockId) {
    const pageKey = typeof obj.pageKey === 'string' ? obj.pageKey : undefined;
    return pageKey ? { mode: 'block', blockId: obj.blockId, pageKey } : { mode: 'block', blockId: obj.blockId };
  }
  return undefined;
}

/**
 * Idempotent миграция для legacy блоков:
 *   - Если у `BOUND_BLOCK_TYPES` блока нет `sourceBinding` в конфиге —
 *     auto-bind к первому `cashflow.transactions` блоку на той же странице.
 *   - Если такого блока нет — `{mode: 'empty'}` (на дашборде / новых страницах).
 *
 * Возвращает новый массив (без мутации входа). Блоки без изменений возвращаются
 * как есть. Блоки с уже выставленным bindingом не трогаем (даже если bound к
 * удалённому блоку — это случай handles в render-логике).
 *
 * Также для каждого `kpi.grid` блока — если у него нет `defaultSourceBinding`
 * в конфиге, тоже auto-bind по тому же правилу. Per-cell `sourceBindingOverride`
 * не трогаем — они нужны только когда пользователь явно их задал.
 */
export function applySourceBindingMigration(blocks: BlockInstance[]): BlockInstance[] {
  const firstTxBlock = blocks.find((b) => b.type === TX_BLOCK_TYPE);
  const autoBinding: SourceBinding = firstTxBlock
    ? { mode: 'block', blockId: firstTxBlock.id }
    : { mode: 'empty' };

  return blocks.map((block) => {
    if (!isBoundBlockType(block.type)) return block;
    const cfg = (block.config ?? {}) as Record<string, unknown>;
    const hasBinding = readSourceBinding(cfg) !== undefined;
    const hasGridDefault =
      block.type === 'kpi.grid'
        ? readSourceBindingField(cfg, 'defaultSourceBinding') !== undefined
        : true;
    if (hasBinding && hasGridDefault) return block;

    const nextCfg: Record<string, unknown> = { ...cfg };
    if (!hasBinding) nextCfg.sourceBinding = autoBinding;
    if (block.type === 'kpi.grid' && !hasGridDefault) {
      nextCfg.defaultSourceBinding = autoBinding;
    }
    return { ...block, config: nextCfg };
  });
}

/**
 * Извлечь произвольное поле «SourceBinding-формы» по имени (для
 * `kpi.grid.defaultSourceBinding` и `cell.sourceBindingOverride`).
 */
export function readSourceBindingField(
  config: Record<string, unknown> | undefined,
  field: string,
): SourceBinding | undefined {
  const raw = config?.[field];
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (obj.mode === 'empty') return { mode: 'empty' };
  if (obj.mode === 'global') return { mode: 'global' };
  if (obj.mode === 'block' && typeof obj.blockId === 'string' && obj.blockId) {
    const pageKey = typeof obj.pageKey === 'string' ? obj.pageKey : undefined;
    return pageKey ? { mode: 'block', blockId: obj.blockId, pageKey } : { mode: 'block', blockId: obj.blockId };
  }
  return undefined;
}

/**
 * Собирает edges типа `data-source` для mindmap. Сканирует:
 *   - `block.config.sourceBinding`         для всех BOUND_BLOCK_TYPES
 *   - `block.config.defaultSourceBinding`  для kpi.grid (block-level)
 *   - `cell.sourceBindingOverride`         для каждой ячейки kpi.grid
 *
 * Возвращает массив `{ fromId, toId, pageKey? }` где `fromId` — целевой
 * `cashflow.transactions` блок, `toId` — потребитель. `pageKey` — если binding
 * cross-page (отличается от currentPageKey).
 */
export function collectSourceBindingEdges(
  blocks: BlockInstance[],
  currentPageKey?: string,
): Array<{ fromId: string; toId: string; pageKey?: string }> {
  const edges: Array<{ fromId: string; toId: string; pageKey?: string }> = [];
  const seen = new Set<string>();

  function push(fromId: string | undefined, toId: string, pageKey?: string) {
    if (!fromId || fromId === toId) return;
    const isCross = !!pageKey && pageKey !== currentPageKey;
    const key = `${fromId}->${toId}|${isCross ? pageKey : ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ fromId, toId, pageKey: isCross ? pageKey : undefined });
  }

  for (const block of blocks) {
    if (!isBoundBlockType(block.type)) continue;
    const cfg = (block.config ?? {}) as Record<string, unknown>;
    const binding = readSourceBinding(cfg);
    if (binding?.mode === 'block') {
      push(binding.blockId, block.id, binding.pageKey);
    }
    if (block.type === 'kpi.grid') {
      const def = readSourceBindingField(cfg, 'defaultSourceBinding');
      if (def?.mode === 'block') push(def.blockId, block.id, def.pageKey);
      const cells = Array.isArray(cfg.cells) ? (cfg.cells as Array<Record<string, unknown>>) : [];
      for (const cell of cells) {
        const cellBinding = readSourceBindingField(cell, 'sourceBindingOverride');
        if (cellBinding?.mode === 'block') {
          push(cellBinding.blockId, block.id, cellBinding.pageKey);
        }
      }
    }
  }
  return edges;
}
