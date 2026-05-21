// PURPOSE: Per-block source override с persistence в localStorage.
// Аналогичен `usePersistedPeriodWithGlobal`, но для filter по
// `transactions.source` (string или null = "Все").
//
// Семантика:
//   - override === undefined → блок слушает page-level source.
//   - override === null      → блок явно «все источники» (игнорирует page).
//   - override === string    → конкретный source ('bank' / 'manual' / ...).
//
// Persistence ключ: `block:${instanceId}:source:v1`.
//   Значение: { mode: 'global' } | { mode: 'override', value: string | null }.

'use client';

import { useCallback, useEffect, useState } from 'react';

type OverrideState = { mode: 'global' } | { mode: 'override'; value: string | null };

export function usePersistedSourceWithGlobal(options: {
  instanceId: string;
  /** Дефолт при первом mount. */
  initial?: { mode: 'global' } | { mode: 'override'; value: string | null };
}): {
  /** undefined → блок слушает global, null/string → override. */
  override: string | null | undefined;
  setOverride: (next: string | null | undefined) => void;
  isOverride: boolean;
} {
  const { instanceId, initial } = options;
  const storageK = `block:${instanceId}:source:v1`;

  const [state, setState] = useState<OverrideState>(initial ?? { mode: 'global' });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageK);
      if (!raw) return;
      const parsed = JSON.parse(raw) as OverrideState | null;
      if (!parsed || typeof parsed !== 'object') return;
      if (parsed.mode === 'global') {
        setState({ mode: 'global' });
        return;
      }
      if (parsed.mode === 'override') {
        const v = parsed.value;
        if (v === null || typeof v === 'string') {
          setState({ mode: 'override', value: v });
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const setOverride = useCallback(
    (next: string | null | undefined) => {
      const nextState: OverrideState =
        next === undefined ? { mode: 'global' } : { mode: 'override', value: next };
      setState(nextState);
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(storageK, JSON.stringify(nextState));
        } catch {
          // ignore
        }
      }
    },
    [storageK],
  );

  const override = state.mode === 'global' ? undefined : state.value;

  return {
    override,
    setOverride,
    isOverride: state.mode === 'override',
  };
}
