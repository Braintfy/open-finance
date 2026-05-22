// PURPOSE: Hook для bound консьюмеров cashflow данных. Резолвит `SourceBinding`
// в эффективные фильтры:
//   - `empty`  → null (рендер отдаёт placeholder).
//   - `global` → null (фильтры берутся из page-level period/source — это
//                делает консьюмер через useEffectivePeriod/useEffectiveSource).
//   - `block`  → парсит `__txFilters` из BlockValues store целевого блока.
//                Cross-page fallback — пробует cross-page source через
//                `useAvailableBlockSources()` (если блок не на этой странице,
//                его __txFilters локально недоступны).
//
// Возвращает: BoundFilters | null.
// null означает «binding не block-mode» (consumer-decision что делать).

'use client';

import { useContext, useEffect, useState } from 'react';
import { BlockValuesContext } from './values';
import type { SourceBinding } from './types';
import type { PeriodPreset } from '@/lib/blocks/period-resolver';

export type BoundFilters = {
  /** Может быть null = «период страницы». */
  period: {
    preset: PeriodPreset;
    customFrom: string | null;
    customTo: string | null;
  } | null;
  /** null = «не фильтровать», 'income'|'expense' иначе. */
  type: 'income' | 'expense' | null;
  /** undefined = page-source, null = «все источники» явно, string = конкретный. */
  source: string | null | undefined;
  /** null = «не фильтровать», string = подстрока (ilike). */
  counterparty: string | null;
  /** null = «не фильтровать», string = точное имя. */
  categoryName: string | null;
};

/**
 * Парсит сериализованный `__txFilters` строкой в `BoundFilters`. Безопасен
 * к несовместимости формата — возвращает null, если строка не парсится.
 */
export function parseTxFilters(raw: string | number | null | undefined): BoundFilters | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const period = obj.period as Record<string, unknown> | null | undefined;
    const out: BoundFilters = {
      period: null,
      type: null,
      source: undefined,
      counterparty: null,
      categoryName: null,
    };
    if (period && typeof period === 'object' && typeof period.preset === 'string') {
      out.period = {
        preset: period.preset as PeriodPreset,
        customFrom: typeof period.customFrom === 'string' ? period.customFrom : null,
        customTo: typeof period.customTo === 'string' ? period.customTo : null,
      };
    }
    if (obj.type === 'income' || obj.type === 'expense') out.type = obj.type;
    if (obj.source === null) out.source = null;
    else if (typeof obj.source === 'string') out.source = obj.source;
    else out.source = undefined;
    if (typeof obj.counterparty === 'string' && obj.counterparty) out.counterparty = obj.counterparty;
    if (typeof obj.categoryName === 'string' && obj.categoryName) out.categoryName = obj.categoryName;
    return out;
  } catch {
    return null;
  }
}

/**
 * Хук для bound консьюмеров.
 *
 * - Подписывается на BlockValues store и реактивно реагирует на изменения
 *   `__txFilters` целевого блока.
 * - Для cross-page bindings — fallback к null (mid-term `/api/blocks/sources`
 *   расширение в Phase 6 даст серверный fetch фильтров; пока возвращаем null
 *   и UI рендерит «источник не найден» в placeholder).
 *
 * Возвращает:
 *   - `null`             — binding не block-mode (consumer должен сам решить).
 *   - `BoundFilters`     — успешно резолвили.
 *   - `'missing'`        — binding указывает на блок, который не найден локально
 *                          (либо удалён, либо cross-page; consumer показывает hint).
 */
export type BoundResolveResult =
  | null
  | { kind: 'filters'; filters: BoundFilters }
  | { kind: 'missing'; pageKey?: string; blockId: string };

export function useBoundTxFilters(binding: SourceBinding | undefined): BoundResolveResult {
  const api = useContext(BlockValuesContext);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!api) return;
    return api.subscribe(() => setTick((t) => t + 1));
  }, [api]);

  void tick;
  if (!binding || binding.mode !== 'block') return null;
  if (!api) {
    return { kind: 'missing', blockId: binding.blockId, pageKey: binding.pageKey };
  }
  const output = api.get().values.get(binding.blockId);
  if (!output) {
    return { kind: 'missing', blockId: binding.blockId, pageKey: binding.pageKey };
  }
  const raw = output.__txFilters;
  const filters = parseTxFilters(raw as string | undefined);
  if (!filters) {
    return { kind: 'missing', blockId: binding.blockId, pageKey: binding.pageKey };
  }
  return { kind: 'filters', filters };
}
