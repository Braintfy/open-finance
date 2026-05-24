// PURPOSE: Унифицированный hook для управления периодом блока.
// Обёртка над `usePersistedPeriodWithGlobal` + `useEffectivePeriod` с единым
// API. Поддерживает:
//   - Глобальный режим (override = null) — блок наследует page-level period
//     от `PagePeriodProvider` через `useEffectivePeriod`.
//   - Override-режим — блок имеет свой период, сохранённый в localStorage
//     (`block:${instanceId}:period:v2`).
//   - Sync с config (optional `onConfigChange`) — для блоков, где период
//     хранится в layout config (т.е. виден другим пользователям дашборда).
//   - Авто-регистрация в `PagePeriodContext.registerBlock` для счётчика
//     overridden блоков и массового сброса (`resetAllOverrides`) из header'а.
//
// Использование:
//   const { period, source, override, setOverride, resetToGlobal, isOverride } =
//     useBlockPeriod({
//       instanceId: instance.id,
//       configOverride: cfg.periodOverride,                  // seed из config
//       onConfigChange: (next) => onConfigChange?.({ ...cfg, periodOverride: next }),
//       defaultMode: 'global',                                // дефолт: global
//     });
//
// Тогда:
//   - `period` — итоговый effective (PagePeriodValue) для fetch / UI.
//   - `source === 'override'` → блок имеет свой период (показать lock-badge).
//   - `setOverride({ preset, customFrom, customTo })` → перейти в override-mode.
//   - `resetToGlobal()` → вернуться к page-level period.

'use client';

import { useCallback, useEffect, useMemo } from 'react';
import type { OzonAnalyticsPeriodPreset } from './catalog/unit-ozon-analytics-types';
import {
  usePagePeriod,
  useEffectivePeriod,
  type PagePeriodValue,
} from './page-period-context';
import { usePersistedPeriodWithGlobal } from './use-persisted-period';

export type PeriodOverride = {
  preset: OzonAnalyticsPeriodPreset;
  customFrom: string | null;
  customTo: string | null;
};

export type UseBlockPeriodOptions = {
  instanceId: string;
  /** Seed из layout config (если блок хранит периoдов конфиг). */
  configOverride?: PeriodOverride | null;
  /** Callback при изменении override — синхронизируется обратно в config. */
  onConfigChange?: (next: PeriodOverride | null) => void;
  /**
   * Дефолтное поведение при первом mount.
   *   - 'global' (default): блок начинает в global-режиме.
   *   - 'override': блок начинает в override-режиме с `defaultOverride`.
   */
  defaultMode?: 'global' | 'override';
  /** Если defaultMode='override' — этот override используется как initial. */
  defaultOverride?: PeriodOverride;
};

export type UseBlockPeriodResult = {
  /** Effective period: либо override блока, либо global page period. */
  period: PagePeriodValue;
  /** Откуда взят effective period (для UI lock-badge). */
  source: 'global' | 'override';
  /** Текущий override (null = global mode). */
  override: PeriodOverride | null;
  /** Переключить блок в override-режим со значением `next`. null → global. */
  setOverride: (next: PeriodOverride | null) => void;
  /** Shortcut: setOverride(null). */
  resetToGlobal: () => void;
  /** Удобный shortcut: `override !== null`. */
  isOverride: boolean;
};

export function useBlockPeriod(
  options: UseBlockPeriodOptions,
): UseBlockPeriodResult {
  const {
    instanceId,
    configOverride,
    onConfigChange,
    defaultMode = 'global',
    defaultOverride,
  } = options;

  // ── 1. Хранилище localStorage с override-mode ──
  const initial = useMemo(() => {
    // Приоритет: configOverride (из layout) > defaultOverride (программный) >
    // defaultMode (флаг 'global'/'override').
    if (configOverride) {
      return {
        mode: 'override' as const,
        preset: configOverride.preset,
        customFrom: configOverride.customFrom,
        customTo: configOverride.customTo,
      };
    }
    if (defaultMode === 'override' && defaultOverride) {
      return {
        mode: 'override' as const,
        preset: defaultOverride.preset,
        customFrom: defaultOverride.customFrom,
        customTo: defaultOverride.customTo,
      };
    }
    return { mode: 'global' as const };
  }, [configOverride, defaultMode, defaultOverride]);

  const { override, setOverride: setOverrideLocal } = usePersistedPeriodWithGlobal({
    instanceId,
    initial,
  });

  // ── 2. Effective period (merge с global) ──
  const { value: period, source } = useEffectivePeriod(instanceId, override);

  // ── 3. Sync to config (если задан onConfigChange) ──
  // Стабильная callback-обёртка, чтобы не пересоздавать setOverride при каждом
  // ре-рендере родителя.
  const setOverride = useCallback(
    (next: PeriodOverride | null) => {
      setOverrideLocal(next);
      if (onConfigChange) {
        onConfigChange(next);
      }
    },
    [setOverrideLocal, onConfigChange],
  );

  const resetToGlobal = useCallback(() => {
    setOverride(null);
  }, [setOverride]);

  // ── 4. Регистрация в PagePeriodContext (для счётчика / mass-reset) ──
  const { registerBlock, unregisterBlock } = usePagePeriod();
  const isOverride = override !== null;

  useEffect(() => {
    registerBlock(instanceId, {
      isOverride,
      reset: resetToGlobal,
    });
    return () => {
      unregisterBlock(instanceId);
    };
  }, [instanceId, isOverride, resetToGlobal, registerBlock, unregisterBlock]);

  return {
    period,
    source,
    override,
    setOverride,
    resetToGlobal,
    isOverride,
  };
}
