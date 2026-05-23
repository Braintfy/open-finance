// PURPOSE: Helper для определения нужна ли странице панель «Период и источник».
// Используется в BlockGrid: дефолтная видимость = есть ли на странице bound-блоки
// с `sourceBinding.mode === 'global'` (или cashflow.transactions без override'а).
// Пользователь может перекрыть дефолт через localStorage (toggle в edit toolbar).

'use client';

import { useEffect, useMemo, useState } from 'react';
import type { BlockInstance } from './types';
import {
  BOUND_BLOCK_TYPES,
  TX_BLOCK_TYPE,
  isBoundBlockType,
  readSourceBinding,
} from './source-binding';

void BOUND_BLOCK_TYPES; // referenced for tree-shaking; isBoundBlockType wraps the set

/**
 * Есть ли на странице хотя бы один блок, чей вид зависит от page-level
 * period/source. Это:
 *  - bound-блок (stat.*, chart.cashflow, top-categories, kpi.grid) с
 *    `sourceBinding.mode === 'global'` (или без sourceBinding вообще — legacy).
 *  - `cashflow.transactions` без явного `defaultPeriodOverride` — он
 *    показывает список по page-периоду.
 */
export function pageHasGlobalBoundBlocks(blocks: BlockInstance[]): boolean {
  for (const b of blocks) {
    if (b.type === TX_BLOCK_TYPE) {
      const cfg = (b.config ?? {}) as Record<string, unknown>;
      // Если defaultPeriodOverride задан — tx-блок самодостаточен, не нужен page-period.
      const hasPeriodOverride =
        'defaultPeriodOverride' in cfg &&
        cfg.defaultPeriodOverride !== undefined &&
        cfg.defaultPeriodOverride !== null;
      if (!hasPeriodOverride) return true;
      continue;
    }
    if (!isBoundBlockType(b.type)) continue;
    const binding = readSourceBinding(b.config);
    if (!binding || binding.mode === 'global') return true;
  }
  return false;
}

function storageKey(pageKey: string): string {
  return `page:${pageKey}:periodHeaderHidden:v1`;
}

function readUserOverride(pageKey: string): '1' | '0' | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(pageKey));
    return raw === '1' || raw === '0' ? (raw as '1' | '0') : null;
  } catch {
    return null;
  }
}

/**
 * Resolved visibility: 'shown' (panel expanded) vs 'collapsed' (узкая полоска).
 * User override через localStorage перебивает дефолт.
 * Возвращает также `toggle(next: boolean)` для записи в localStorage.
 */
export function usePagePeriodHeaderVisibility(
  pageKey: string,
  blocks: BlockInstance[],
): { collapsed: boolean; toggle: (next: boolean) => void } {
  const dataDefault = useMemo(() => !pageHasGlobalBoundBlocks(blocks), [blocks]);

  // SSR-safe: на сервере читаем только из данных. На клиенте — после mount
  // подтягиваем localStorage override.
  const [overrideHidden, setOverrideHidden] = useState<'1' | '0' | null>(null);
  useEffect(() => {
    setOverrideHidden(readUserOverride(pageKey));
  }, [pageKey]);

  const collapsed =
    overrideHidden === '1' ? true : overrideHidden === '0' ? false : dataDefault;

  function toggle(nextCollapsed: boolean) {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey(pageKey), nextCollapsed ? '1' : '0');
    } catch {
      // ignore
    }
    setOverrideHidden(nextCollapsed ? '1' : '0');
  }

  return { collapsed, toggle };
}
