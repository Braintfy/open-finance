// PURPOSE: Page-level source filter context для cashflow-страницы.
// Аналог `PagePeriodContext` но для filter по `transactions.source`
// (`'bank' | 'manual' | 'inbox' | 'ozon' | 'wb' | undefined`).
//
// Контракт:
//   - `PageSourceProvider({pageKey, children})` — оборачивает страницу,
//     хранит выбранный source (string | null = все).
//   - `usePageSource()` — для header UI (SourceFilterChips).
//   - `useEffectiveSource(instanceId, blockOverride)` — для блоков:
//     если blockOverride !== undefined → возвращает override,
//     иначе page-level value. Возвращает `{value, source: 'global' | 'override'}`.
//   - Persistence: localStorage[`page:${pageKey}:source:v1`] = JSON({source: string | null}).

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

export type PageSourceValue = string | null; // null = все источники

type PageSourceCtx = {
  pageKey: string;
  value: PageSourceValue;
  setValue: (v: PageSourceValue) => void;
};

const PageSourceContext = createContext<PageSourceCtx | null>(null);

function storageKey(pageKey: string): string {
  return `page:${pageKey}:source:v1`;
}

function readStorage(pageKey: string): PageSourceValue | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey(pageKey));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { source: PageSourceValue } | null;
    if (!parsed || typeof parsed !== 'object') return undefined;
    if (parsed.source === null || typeof parsed.source === 'string') {
      return parsed.source;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function writeStorage(pageKey: string, value: PageSourceValue): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(pageKey), JSON.stringify({ source: value }));
  } catch {
    // ignore quota errors
  }
}

export function PageSourceProvider({
  pageKey,
  defaultValue = null,
  children,
}: {
  pageKey: string;
  defaultValue?: PageSourceValue;
  children: ReactNode;
}) {
  const [value, setValueState] = useState<PageSourceValue>(defaultValue);

  useEffect(() => {
    const stored = readStorage(pageKey);
    if (stored !== undefined) setValueState(stored);
  }, [pageKey]);

  const setValue = useCallback(
    (next: PageSourceValue) => {
      setValueState(next);
      writeStorage(pageKey, next);
    },
    [pageKey],
  );

  const ctx = useMemo<PageSourceCtx>(
    () => ({ pageKey, value, setValue }),
    [pageKey, value, setValue],
  );

  return <PageSourceContext.Provider value={ctx}>{children}</PageSourceContext.Provider>;
}

export function usePageSource(): {
  pageKey: string | null;
  value: PageSourceValue;
  setValue: (v: PageSourceValue) => void;
} {
  const ctx = useContext(PageSourceContext);
  if (!ctx) {
    return { pageKey: null, value: null, setValue: () => {} };
  }
  return ctx;
}

/**
 * Effective source для блока.
 *
 * @param instanceId — id блока (для будущих per-block логов).
 * @param blockOverride — `undefined` → блок слушает global, иначе override
 *   (`null` = override "Все", string = конкретный source).
 */
export function useEffectiveSource(
  instanceId: string,
  blockOverride: PageSourceValue | undefined,
): { value: PageSourceValue; source: 'global' | 'override' } {
  void instanceId;
  const page = useContext(PageSourceContext);

  if (blockOverride !== undefined) {
    return { value: blockOverride, source: 'override' };
  }
  return { value: page?.value ?? null, source: 'global' };
}
