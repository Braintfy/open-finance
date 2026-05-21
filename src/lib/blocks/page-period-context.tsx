// PURPOSE: Page-level period context — единый источник «текущего периода» для
// всех блоков страницы. Конкретный блок может либо слушать глобальный период
// (`null` override), либо переопределить его per-block через `usePersistedPeriodValue`.
//
// Контракт:
//   • `PagePeriodProvider` оборачивает страницу (например `/cashflow`), хранит
//     `{value, setValue}` для period + опциональный default preset.
//   • `usePagePeriod()` — для page-level UI (sticky header сверху страницы).
//     Возвращает `{value, setValue}`. Если провайдера нет — fallback на MTD.
//   • `useEffectivePeriod(instanceId, blockOverride?)` — слив page-level и
//     per-block override:
//       - если `blockOverride` указан и !== null → используем его,
//       - иначе → page-level value.
//     Возвращает `{value, source: 'global' | 'override'}`, чтобы UI мог
//     показать lock-иконку для overridden блоков.
//   • Persistence (по странице, через localStorage) ключ `page:${pageKey}:period:v1`.

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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

type PagePeriodCtx = {
  pageKey: string;
  value: PagePeriodValue;
  setValue: (v: PagePeriodValue) => void;
  reset: () => void;
};

const PagePeriodContext = createContext<PagePeriodCtx | null>(null);

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

  const ctx = useMemo<PagePeriodCtx>(
    () => ({ pageKey, value, setValue, reset }),
    [pageKey, value, setValue, reset],
  );

  return <PagePeriodContext.Provider value={ctx}>{children}</PagePeriodContext.Provider>;
}

export function usePagePeriod(): {
  pageKey: string | null;
  value: PagePeriodValue;
  setValue: (v: PagePeriodValue) => void;
  reset: () => void;
} {
  const ctx = useContext(PagePeriodContext);
  if (!ctx) {
    return {
      pageKey: null,
      value: DEFAULT_VALUE,
      setValue: () => {},
      reset: () => {},
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
