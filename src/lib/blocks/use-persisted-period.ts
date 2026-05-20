// PURPOSE: Сохраняет выбранный пользователем период блока в localStorage,
// чтобы после refresh / перехода между страницами он не сбрасывался на
// дефолт из `instance.config.periodPreset`. Каждый блок изолирован по
// `instance.id` (один и тот же тип блока на дашборде имеет независимые
// периоды).
//
// Семантика:
//   - При первом mount: читаем localStorage по ключу `block:${instanceId}:period`.
//     Если запись есть и валидна — используем её (overrides initial из config).
//     Если нет — используем initial из config.
//   - При любом изменении (setPreset / setCustomFrom / setCustomTo) — пишем в localStorage.
//   - При смене аккаунта/instance.id (что бывает крайне редко) — забываем prev state.
//
// НЕ синхронизируется с `instance.config` (через onConfigChange) сознательно:
//   1. Период — это UX preference конкретного пользователя в его браузере,
//      а config — общий для всех пользователей дашборда.
//   2. Каждое изменение config приводит к round-trip к серверу — для частых
//      кликов «7д/14д/30д» это излишний шум.
//
// Если в будущем понадобится sync с config — можно добавить опцию `syncToConfig`.

'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  OzonAnalyticsPeriodPreset,
  OzonQueryPeriod,
} from './catalog/unit-ozon-analytics-types';

type PersistedPeriod = {
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

function storageKey(instanceId: string): string {
  return `block:${instanceId}:period:v1`;
}

function readFromStorage(instanceId: string): PersistedPeriod | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey(instanceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedPeriod>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!VALID_PRESETS.includes(parsed.preset as OzonAnalyticsPeriodPreset)) {
      return null;
    }
    // custom без дат — недействителен, fallback на default
    if (
      parsed.preset === 'custom' &&
      (!parsed.customFrom || !parsed.customTo)
    ) {
      return null;
    }
    return {
      preset: parsed.preset as OzonAnalyticsPeriodPreset,
      customFrom: parsed.customFrom ?? null,
      customTo: parsed.customTo ?? null,
    };
  } catch {
    return null;
  }
}

function writeToStorage(instanceId: string, value: PersistedPeriod): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(instanceId), JSON.stringify(value));
  } catch {
    // Ignore quota / private-mode errors — UX preference, не критичная.
  }
}

/**
 * Возвращает state-tuple для периода с автоматической persistence в localStorage.
 *
 * @example
 * const { preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo } =
 *   usePersistedPeriod({
 *     instanceId: instance.id,
 *     initial: {
 *       preset: config.periodPreset,
 *       customFrom: config.customFrom,
 *       customTo: config.customTo,
 *     },
 *   });
 */
export function usePersistedPeriod(options: {
  instanceId: string;
  initial: {
    preset: OzonAnalyticsPeriodPreset;
    customFrom: string | null;
    customTo: string | null;
  };
}): {
  preset: OzonAnalyticsPeriodPreset;
  setPreset: (next: OzonAnalyticsPeriodPreset) => void;
  customFrom: string | null;
  setCustomFrom: (next: string | null) => void;
  customTo: string | null;
  setCustomTo: (next: string | null) => void;
} {
  const { instanceId, initial } = options;

  // SSR-safe init: на сервере вернёт initial, на клиенте useEffect ниже
  // подтянет localStorage и сделает setState. Это лучше, чем читать
  // localStorage в lazy initializer — избегает hydration mismatch.
  const [preset, setPresetState] = useState<OzonAnalyticsPeriodPreset>(
    initial.preset,
  );
  const [customFrom, setCustomFromState] = useState<string | null>(
    initial.customFrom,
  );
  const [customTo, setCustomToState] = useState<string | null>(initial.customTo);

  // Восстановление из localStorage один раз после mount.
  // Если instanceId меняется (редко) — сбросим к initial и попробуем снова.
  useEffect(() => {
    const stored = readFromStorage(instanceId);
    if (stored) {
      setPresetState(stored.preset);
      setCustomFromState(stored.customFrom);
      setCustomToState(stored.customTo);
    } else {
      setPresetState(initial.preset);
      setCustomFromState(initial.customFrom);
      setCustomToState(initial.customTo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const setPreset = useCallback(
    (next: OzonAnalyticsPeriodPreset) => {
      setPresetState(next);
      writeToStorage(instanceId, {
        preset: next,
        customFrom,
        customTo,
      });
    },
    [instanceId, customFrom, customTo],
  );

  const setCustomFrom = useCallback(
    (next: string | null) => {
      setCustomFromState(next);
      writeToStorage(instanceId, {
        preset,
        customFrom: next,
        customTo,
      });
    },
    [instanceId, preset, customTo],
  );

  const setCustomTo = useCallback(
    (next: string | null) => {
      setCustomToState(next);
      writeToStorage(instanceId, {
        preset,
        customFrom,
        customTo: next,
      });
    },
    [instanceId, preset, customFrom],
  );

  return { preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo };
}

/**
 * Вариант для блоков, использующих `PeriodValue` из PeriodPicker
 * (объектная форма preset/customFrom/customTo).
 *
 * Сохраняет ту же запись в localStorage что и `usePersistedPeriod`, чтобы
 * UX preference был общий для всех Ozon-блоков по конкретному instance.id.
 */
export function usePersistedPeriodValue(options: {
  instanceId: string;
  initial: {
    preset: OzonAnalyticsPeriodPreset;
    customFrom: string | null;
    customTo: string | null;
  };
}): {
  value: { preset: OzonAnalyticsPeriodPreset; customFrom: string | null; customTo: string | null };
  setValue: (next: {
    preset: OzonAnalyticsPeriodPreset;
    customFrom?: string | null;
    customTo?: string | null;
  }) => void;
} {
  const { preset, setPreset, customFrom, setCustomFrom, customTo, setCustomTo } =
    usePersistedPeriod(options);

  const setValue = useCallback(
    (next: {
      preset: OzonAnalyticsPeriodPreset;
      customFrom?: string | null;
      customTo?: string | null;
    }) => {
      // Записываем все три поля сразу, чтобы localStorage не остался в
      // частичном состоянии (preset=custom без дат).
      const nextFrom = next.customFrom ?? null;
      const nextTo = next.customTo ?? null;
      setPresetAndDates(options.instanceId, next.preset, nextFrom, nextTo);
      setPreset(next.preset);
      setCustomFrom(nextFrom);
      setCustomTo(nextTo);
    },
    [options.instanceId, setPreset, setCustomFrom, setCustomTo],
  );

  return {
    value: { preset, customFrom, customTo },
    setValue,
  };
}

// Helper: атомарная запись всех трёх полей сразу. Используется из setValue,
// чтобы избежать race condition между тремя последовательными writeToStorage.
function setPresetAndDates(
  instanceId: string,
  preset: OzonAnalyticsPeriodPreset,
  customFrom: string | null,
  customTo: string | null,
): void {
  writeToStorage(instanceId, { preset, customFrom, customTo });
}

export type { OzonQueryPeriod };
