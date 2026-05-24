// PURPOSE: Page-level period context — единый источник «текущего периода» для
// всех блоков страницы. Конкретный блок может либо слушать глобальный период
// (`null` override), либо переопределить его per-block через `useBlockPeriod`.
//
// Контракт:
//   • `PagePeriodProvider` оборачивает страницу (например `/cashflow`), хранит
//     `{value, setValue}` для period + опциональный default preset.
//   • `usePagePeriod()` — для page-level UI (sticky header сверху страницы).
//     Возвращает `{value, setValue, ...registry}`. Если провайдера нет —
//     fallback на MTD + no-op методы.
//   • `useEffectivePeriod(instanceId, blockOverride?)` — слив page-level и
//     per-block override:
//       - если `blockOverride` указан и !== null → используем его,
//       - иначе → page-level value.
//     Возвращает `{value, source: 'global' | 'override'}`, чтобы UI мог
//     показать lock-иконку для overridden блоков.
//   • Registry (v0.22.5): блоки автоматически регистрируются через
//     `useBlockPeriod` и могут быть массово сброшены к global через
//     `resetAllOverrides()`. Header показывает счётчик overridden блоков.
//   • Persistence (по странице, через localStorage) ключ `page:${pageKey}:period:v1`.

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
import type {
  OzonAnalyticsPeriodPreset,
} from './catalog/unit-ozon-analytics-types';

export type PagePeriodValue = {
  preset: OzonAnalyticsPeriodPreset;
  customFrom: string | null;
  customTo: string | null;
};

const VALID_PRESETS: OzonAnalyticsPeriodPreset[] = [
  'today',
  'yesterday',
  '7d',
  '14d',
  '30d',
  'mtd',
  'custom',
];

const DEFAULT_VALUE: PagePeriodValue = {
  preset: 'mtd',
  customFrom: null,
  customTo: null,
};

/**
 * Registry entry для блока, использующего `useBlockPeriod`. `isOverride`
 * нужен provider'у для счётчика overridden-блоков (`countOverridden`).
 * `reset` — callback от блока: при вызове блок должен переключиться на global.
 */
type BlockRegistryEntry = {
  isOverride: boolean;
  reset: () => void;
};

type PagePeriodCtx = {
  pageKey: string;
  value: PagePeriodValue;
  setValue: (v: PagePeriodValue) => void;
  reset: () => void;
  /** Регистрация блока (idempotent: повторный вызов обновляет entry). */
  registerBlock: (instanceId: string, entry: BlockRegistryEntry) => void;
  unregisterBlock: (instanceId: string) => void;
  /** Количество overridden блоков на странице. Реактивно через subscriber. */
  countOverridden: () => number;
  /** Подписка на изменения registry (для header'а — счётчик / disabled state). */
  subscribeRegistry: (cb: () => void) => () => void;
  /** Сбросить все overrides → блоки переключаются на global. */
  resetAllOverrides: () => void;
};

export const PagePeriodContext = createContext<PagePeriodCtx | null>(null);

function storageKey(pageKey: string): string {
  return `page:${pageKey}:period:v1`;
}

function readStorage(pageKey: string): PagePeriodValue | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(pageKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PagePeriodValue>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!VALID_PRESETS.includes(parsed.preset as OzonAnalyticsPeriodPreset)) return null;
    if (parsed.preset === 'custom' && (!parsed.customFrom || !parsed.customTo)) return null;
    return {
      preset: parsed.preset as OzonAnalyticsPeriodPreset,
      customFrom: parsed.customFrom ?? null,
      customTo: parsed.customTo ?? null,
    };
  } catch {
    return null;
  }
}

function writeStorage(pageKey: string, value: PagePeriodValue): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(pageKey), JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

export function PagePeriodProvider({
  pageKey,
  defaultPreset = 'mtd',
  children,
}: {
  pageKey: string;
  defaultPreset?: OzonAnalyticsPeriodPreset;
  children: ReactNode;
}) {
  const [value, setValueState] = useState<PagePeriodValue>(() => ({
    preset: defaultPreset,
    customFrom: null,
    customTo: null,
  }));

  // Hydrate from localStorage after mount (SSR-safe).
  useEffect(() => {
    const stored = readStorage(pageKey);
    if (stored) setValueState(stored);
  }, [pageKey]);

  const setValue = useCallback(
    (next: PagePeriodValue) => {
      setValueState(next);
      writeStorage(pageKey, next);
    },
    [pageKey],
  );

  const reset = useCallback(() => {
    const fallback: PagePeriodValue = {
      preset: defaultPreset,
      customFrom: null,
      customTo: null,
    };
    setValueState(fallback);
    writeStorage(pageKey, fallback);
  }, [pageKey, defaultPreset]);

  // ── Block registry (v0.22.5) ──
  // Хранится в ref'е, чтобы избежать re-render всего поддерева при
  // регистрации/отрегистрации блоков. Subscriber'ы (header) вызывают
  // forceUpdate через `subscribeRegistry`.
  const registryRef = useRef<Map<string, BlockRegistryEntry>>(new Map());
  const subscribersRef = useRef<Set<() => void>>(new Set());

  const notifyRegistry = useCallback(() => {
    for (const cb of subscribersRef.current) cb();
  }, []);

  const registerBlock = useCallback(
    (instanceId: string, entry: BlockRegistryEntry) => {
      const prev = registryRef.current.get(instanceId);
      const changed =
        !prev || prev.isOverride !== entry.isOverride || prev.reset !== entry.reset;
      registryRef.current.set(instanceId, entry);
      if (changed) notifyRegistry();
    },
    [notifyRegistry],
  );

  const unregisterBlock = useCallback(
    (instanceId: string) => {
      if (registryRef.current.delete(instanceId)) notifyRegistry();
    },
    [notifyRegistry],
  );

  const countOverridden = useCallback(() => {
    let n = 0;
    for (const entry of registryRef.current.values()) {
      if (entry.isOverride) n += 1;
    }
    return n;
  }, []);

  const subscribeRegistry = useCallback((cb: () => void) => {
    subscribersRef.current.add(cb);
    return () => {
      subscribersRef.current.delete(cb);
    };
  }, []);

  const resetAllOverrides = useCallback(() => {
    // Snapshot — на случай если reset() удаляет entry из registry
    // и Map.values() стал бы invalid.
    const entries = Array.from(registryRef.current.values());
    for (const entry of entries) {
      if (entry.isOverride) {
        try {
          entry.reset();
        } catch {
          // ignore — индивидуальный блок мог уже unmount'нуться
        }
      }
    }
  }, []);

  const ctx = useMemo<PagePeriodCtx>(
    () => ({
      pageKey,
      value,
      setValue,
      reset,
      registerBlock,
      unregisterBlock,
      countOverridden,
      subscribeRegistry,
      resetAllOverrides,
    }),
    [
      pageKey,
      value,
      setValue,
      reset,
      registerBlock,
      unregisterBlock,
      countOverridden,
      subscribeRegistry,
      resetAllOverrides,
    ],
  );

  return <PagePeriodContext.Provider value={ctx}>{children}</PagePeriodContext.Provider>;
}

const NOOP = () => {};

export function usePagePeriod(): {
  pageKey: string | null;
  value: PagePeriodValue;
  setValue: (v: PagePeriodValue) => void;
  reset: () => void;
  registerBlock: (instanceId: string, entry: BlockRegistryEntry) => void;
  unregisterBlock: (instanceId: string) => void;
  countOverridden: () => number;
  subscribeRegistry: (cb: () => void) => () => void;
  resetAllOverrides: () => void;
} {
  const ctx = useContext(PagePeriodContext);
  if (!ctx) {
    return {
      pageKey: null,
      value: DEFAULT_VALUE,
      setValue: NOOP,
      reset: NOOP,
      registerBlock: NOOP,
      unregisterBlock: NOOP,
      countOverridden: () => 0,
      subscribeRegistry: () => NOOP,
      resetAllOverrides: NOOP,
    };
  }
  return ctx;
}

/**
 * Effective period for a block.
 *
 * @param instanceId — id блока (для будущих логов / per-block overrides).
 * @param blockOverride — override от `usePersistedPeriodValue` (или null если
 *   блок слушает global).
 *
 * Если override === null → возвращаем page-level. Если override объект — он.
 * `source` показывает откуда взяли период: для UI (lock-иконка).
 */
export function useEffectivePeriod(
  instanceId: string,
  blockOverride: PagePeriodValue | null,
): { value: PagePeriodValue; source: 'global' | 'override' } {
  void instanceId; // зарезервировано для будущих логов
  const page = useContext(PagePeriodContext);

  if (blockOverride) {
    return { value: blockOverride, source: 'override' };
  }
  return {
    value: page?.value ?? DEFAULT_VALUE,
    source: 'global',
  };
}
