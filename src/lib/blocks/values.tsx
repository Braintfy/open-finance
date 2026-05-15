// PURPOSE: Block Values Registry — реактивный store для значений блоков.
// Каждый блок может ПУБЛИКОВАТЬ свои output-значения (KPI value, list count, etc),
// а computed-блоки (sum/formula/AI) ПОДПИСЫВАЮТСЯ на них и реактивно пересчитываются.
//
// Архитектура:
// - BlockValuesProvider — context на уровне страницы
// - useBlockValuePublisher(blockId, fields) — блок-источник публикует свои значения
// - useBlockValue(ref) — блок-потребитель читает значение по ссылке
// - useBlockDependencyResult(deps) — computed-блок получает агрегированный результат
'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { BlockDependencies, BlockRef } from './types';

/** Опубликованные значения одного блока. Ключ — field name, значение — number/string/null */
export type BlockOutput = Record<string, number | string | null>;

type Store = {
  /** blockId → output fields */
  values: Map<string, BlockOutput>;
  /** Версия для триггера ре-рендера подписчиков (увеличивается на любое изменение) */
  version: number;
};

type StoreApi = {
  get: () => Store;
  publish: (blockId: string, output: BlockOutput) => void;
  unpublish: (blockId: string) => void;
  subscribe: (listener: () => void) => () => void;
};

export const BlockValuesContext = createContext<StoreApi | null>(null);

/**
 * Провайдер реактивного store для значений блоков на странице.
 * Оборачивайте корень страницы (внутри BlockGrid).
 */
export function BlockValuesProvider({ children }: { children: ReactNode }) {
  const storeRef = useRef<Store>({ values: new Map(), version: 0 });
  const listenersRef = useRef<Set<() => void>>(new Set());

  const api = useMemo<StoreApi>(
    () => ({
      get: () => storeRef.current,
      publish: (blockId, output) => {
        const prev = storeRef.current.values.get(blockId);
        // Skip if values unchanged (shallow compare) — избегаем лишних ре-рендеров
        if (prev && shallowEqual(prev, output)) return;
        storeRef.current.values.set(blockId, output);
        storeRef.current.version += 1;
        listenersRef.current.forEach((l) => l());
      },
      unpublish: (blockId) => {
        if (!storeRef.current.values.has(blockId)) return;
        storeRef.current.values.delete(blockId);
        storeRef.current.version += 1;
        listenersRef.current.forEach((l) => l());
      },
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
    }),
    []
  );

  return <BlockValuesContext.Provider value={api}>{children}</BlockValuesContext.Provider>;
}

function shallowEqual(a: BlockOutput, b: BlockOutput): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}

/**
 * Хук для блока-источника: публикует свои output-значения в store.
 * При размонтировании автоматически удаляет публикацию.
 *
 * Использование:
 * ```tsx
 * useBlockValuePublisher(instance.id, { value: summary.incomeTotal });
 * ```
 */
export function useBlockValuePublisher(blockId: string, output: BlockOutput): void {
  const api = useContext(BlockValuesContext);
  // Стабильная сериализация для сравнения зависимостей
  const outputKey = JSON.stringify(output);
  useEffect(() => {
    if (!api) return; // нет провайдера — silent noop (для блоков вне страницы)
    api.publish(blockId, output);
    return () => {
      api.unpublish(blockId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, blockId, outputKey]);
}

/**
 * Хук для подписки на одно значение по BlockRef.
 * Возвращает текущее значение или null если источник не публикует.
 */
export function useBlockValue(ref: BlockRef): number | string | null {
  const api = useContext(BlockValuesContext);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!api) return;
    return api.subscribe(() => setTick((t) => t + 1));
  }, [api]);

  // FIX: tick — это явный re-render trigger, а не просто счётчик.
  // Без этого useMemo не пересчитывается на изменения store.
  void tick;
  if (!api) return null;
  const output = api.get().values.get(ref.blockId);
  if (!output) return null;
  const field = ref.field ?? 'value';
  return output[field] ?? null;
}

/**
 * Хук для computed-блока: возвращает агрегированный результат на основе всех зависимостей.
 * Реактивно пересчитывается при изменении любого источника.
 */
export function useBlockDependencyResult(
  deps: BlockDependencies | undefined
): { value: number | null; sourceValues: Array<number | null>; missing: number } {
  const api = useContext(BlockValuesContext);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!api) return;
    return api.subscribe(() => setTick((t) => t + 1));
  }, [api]);

  return useMemo(() => {
    if (!deps || deps.sources.length === 0 || !api) {
      return { value: null, sourceValues: [], missing: 0 };
    }
    const store = api.get();
    const sourceValues: Array<number | null> = deps.sources.map((src) => {
      const output = store.values.get(src.blockId);
      if (!output) return null;
      const field = src.field ?? 'value';
      const v = output[field];
      if (typeof v === 'number') return v;
      if (typeof v === 'string') {
        const parsed = parseFloat(v);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    });
    const numeric = sourceValues.filter((v): v is number => v !== null);
    const missing = sourceValues.length - numeric.length;
    let value: number | null = null;
    switch (deps.aggregation) {
      case 'sum':
        value = numeric.reduce((s, n) => s + n, 0);
        break;
      case 'avg':
        value = numeric.length > 0 ? numeric.reduce((s, n) => s + n, 0) / numeric.length : null;
        break;
      case 'min':
        value = numeric.length > 0 ? Math.min(...numeric) : null;
        break;
      case 'max':
        value = numeric.length > 0 ? Math.max(...numeric) : null;
        break;
      case 'count':
        value = numeric.length;
        break;
      case 'formula':
      case 'ai':
        // Заглушка — реальная реализация в следующем этапе (Этап 9 PLAN)
        value = numeric.reduce((s, n) => s + n, 0);
        break;
    }
    return { value, sourceValues, missing };
    // FIX: tick — реактивный trigger, обязателен для пересчёта на store-changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, deps, JSON.stringify(deps), tick]);
}

/**
 * Парсит строку `__labels` формата `"key=Label,key2=Label2"` в map.
 * Convention для блоков, публикующих много полей с техническими именами
 * (totalProfitMonth, avgMargin, …) — чтобы picker показывал человеческие
 * названия вместо ключей.
 */
function parseLabelsString(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  const result: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const [k, ...rest] = pair.split('=');
    if (!k || rest.length === 0) continue;
    const key = k.trim();
    const value = rest.join('=').trim();
    if (key && value) result[key] = value;
  }
  return result;
}

/**
 * Хук для UI: получить список всех опубликованных блоков
 * (для BlockReferencePicker — подсказывает доступные источники).
 *
 * `labels` — map fieldName → человекочитаемый label, собранный из
 * `__labels` convention блока-источника. Picker должен использовать его
 * через `labels[field] ?? defaultLabel(field)`.
 */
export function useAvailableBlockSources(): Array<{
  blockId: string;
  fields: string[];
  labels: Record<string, string>;
}> {
  const api = useContext(BlockValuesContext);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!api) return;
    return api.subscribe(() => setTick((t) => t + 1));
  }, [api]);

  if (!api) return [];
  return Array.from(api.get().values.entries()).map(([blockId, output]) => ({
    blockId,
    fields: Object.keys(output).filter((field) => !field.startsWith('__')),
    labels: parseLabelsString(output.__labels),
  }));
}
