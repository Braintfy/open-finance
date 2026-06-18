// PURPOSE: Контракт загрузки блока. Блок один раз сообщает «грузится» через
// useReportBlockLoading(loading); BlockChrome (провайдер) на ПЕРВУЮ загрузку
// показывает overlay-скелет вместо самодельного спиннера. Opt-in: блоки без
// этого хука работают как раньше.
//
// Почему context-publish, а НЕ render-prop: блок уже монтируется как child
// BlockChrome — добавить 1 вызов хука дешевле, чем переписывать сигнатуру блока.
// Хук вызывается безусловно вверху блока (выше density early-returns) →
// rules-of-hooks соблюдены (как useBlockValuePublisher).
//
// НЕ публиковать loading через useBlockValuePublisher (__loading) — это меняет
// shape published-value и триггерит пересчёт в bound-блоках (computed.sum и пр.).
'use client';

import { createContext, useContext, useEffect } from 'react';

/** Сеттер из BlockChrome: блок репортит своё состояние загрузки. */
export type BlockLoadingReporter = (loading: boolean) => void;

export const BlockLoadingReporterContext = createContext<BlockLoadingReporter | null>(null);

export const BlockLoadingReporterProvider = BlockLoadingReporterContext.Provider;

/**
 * Блок сообщает chrome'у, грузится ли он сейчас. Вызывать БЕЗУСЛОВНО вверху
 * Render-компонента (до любых density early-returns).
 */
export function useReportBlockLoading(loading: boolean): void {
  const report = useContext(BlockLoadingReporterContext);
  useEffect(() => {
    report?.(loading);
  }, [report, loading]);
}
