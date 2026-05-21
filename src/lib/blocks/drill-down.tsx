// PURPOSE: DrillDown utility — клик по агрегату (KPI/категория/бар) фокусирует
// список транзакций по фильтру.
//
// Семантика:
//   • DrillDownProvider оборачивает страницу (внутри BlockValuesProvider).
//   • useDrillDown() → {focus, setFocus, scrollToBlock}.
//     focus: {blockType, filter, blockId?} — текущий drill-target.
//   • Любой блок-источник (StatIncome, TopCategories, и т.д.) при клике вызывает
//     `setFocus({blockType: 'cashflow.transactions', filter: {type: 'income'}})`.
//   • Подписанный блок (например, cashflow.transactions) видит `focus.filter`,
//     применяет его и подсвечивает себя через `data-drill-active`.
//   • Если на текущей странице нет блока такого типа — используем
//     `drillDownUrl()` чтобы сформировать URL `/cashflow#block-{id}?drill[...]=...`.

'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type DrillDownFilter = {
  type?: 'income' | 'expense';
  categoryName?: string;
  counterparty?: string;
  /** transactions.source ('bank' / 'manual' / 'inbox' / 'ozon' / 'wb'). */
  source?: string;
  /** Период drill-target (override page period for receiver only). */
  from?: string;
  to?: string;
};

export type DrillDownFocus = {
  /** Целевой тип блока — например 'cashflow.transactions'. */
  blockType: string;
  filter: DrillDownFilter;
  /** Опциональный id конкретного блока — если несколько того же типа на странице. */
  blockId?: string;
};

type DrillDownCtx = {
  focus: DrillDownFocus | null;
  setFocus: (next: DrillDownFocus | null) => void;
  /** Прокручивает к блоку и подсвечивает его на 2 секунды (data-drill-active). */
  scrollToBlock: (instanceId: string) => void;
};

const DrillDownContext = createContext<DrillDownCtx | null>(null);

export function DrillDownProvider({ children }: { children: ReactNode }) {
  const [focus, setFocusState] = useState<DrillDownFocus | null>(null);

  const scrollToBlock = useCallback((instanceId: string) => {
    if (typeof window === 'undefined') return;
    const el = document.querySelector(`[data-block-id="${instanceId}"]`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.setAttribute('data-drill-active', '1');
    window.setTimeout(() => {
      el.removeAttribute('data-drill-active');
    }, 2000);
  }, []);

  const setFocus = useCallback(
    (next: DrillDownFocus | null) => {
      setFocusState(next);
      if (next && typeof window !== 'undefined') {
        // Найти подходящий target block на странице.
        const target = document.querySelector(
          next.blockId
            ? `[data-block-id="${next.blockId}"]`
            : `[data-block-type="${next.blockType}"]`,
        );
        if (target instanceof HTMLElement) {
          const blockId = target.getAttribute('data-block-id');
          if (blockId) scrollToBlock(blockId);
        }
      }
    },
    [scrollToBlock],
  );

  const ctx = useMemo<DrillDownCtx>(
    () => ({ focus, setFocus, scrollToBlock }),
    [focus, setFocus, scrollToBlock],
  );

  return <DrillDownContext.Provider value={ctx}>{children}</DrillDownContext.Provider>;
}

export function useDrillDown(): DrillDownCtx {
  const ctx = useContext(DrillDownContext);
  if (!ctx) {
    return {
      focus: null,
      setFocus: () => {},
      scrollToBlock: () => {},
    };
  }
  return ctx;
}

/**
 * Формирует URL с drill-фильтрами для перехода на другую страницу.
 *
 * @example drillDownUrl('/cashflow', 'cashflow.transactions', {type: 'income'})
 *   → '/cashflow?drill_block_type=cashflow.transactions&drill_type=income'
 */
export function drillDownUrl(
  pageHref: string,
  blockType: string,
  filter: DrillDownFilter,
): string {
  const params = new URLSearchParams();
  params.set('drill_block_type', blockType);
  if (filter.type) params.set('drill_type', filter.type);
  if (filter.categoryName) params.set('drill_category', filter.categoryName);
  if (filter.counterparty) params.set('drill_counterparty', filter.counterparty);
  if (filter.source) params.set('drill_source', filter.source);
  if (filter.from) params.set('drill_from', filter.from);
  if (filter.to) params.set('drill_to', filter.to);
  return `${pageHref}?${params.toString()}`;
}

/**
 * Парсит URL searchParams в DrillDownFocus (для consumer pages).
 * Используется в PagePeriodProvider или на page-level чтобы хайдратнуть focus
 * после navigate с другой страницы.
 */
export function parseDrillDownFromSearchParams(
  sp: URLSearchParams,
): DrillDownFocus | null {
  const blockType = sp.get('drill_block_type');
  if (!blockType) return null;
  const filter: DrillDownFilter = {};
  const type = sp.get('drill_type');
  if (type === 'income' || type === 'expense') filter.type = type;
  const categoryName = sp.get('drill_category');
  if (categoryName) filter.categoryName = categoryName;
  const counterparty = sp.get('drill_counterparty');
  if (counterparty) filter.counterparty = counterparty;
  const source = sp.get('drill_source');
  if (source) filter.source = source;
  const from = sp.get('drill_from');
  if (from) filter.from = from;
  const to = sp.get('drill_to');
  if (to) filter.to = to;
  return { blockType, filter };
}
