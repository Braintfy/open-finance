// PURPOSE: Хук для определения cross-page связей блоков на текущей странице.
// Делает один lightweight-запрос к /api/blocks/relations и возвращает map:
//   blockId → { incoming: CrossPageLink[], outgoing: CrossPageLink[] }
// Где:
//  - incoming = блоки на ДРУГИХ страницах ИЗ которых данные приходят в этот блок
//    (т.е. этот блок ссылается на них через @ref или dependencies.sources)
//  - outgoing = блоки на ДРУГИХ страницах КОТОРЫЕ ссылаются на этот блок
//    (т.е. данные ИЗ этого блока используются на другой странице)
'use client';

import { useEffect, useMemo, useState } from 'react';

export type CrossPageLink = {
  pageKey: string;
  pageLabel: string;
  blockId: string;
  /** Тип блока (для иконки призрачной карточки на карте). */
  type: string;
  /** Title или typeLabel блока на той странице */
  label: string;
  /** Имя поля (для группировки/диагностики; в UI обычно не показывается) */
  field: string;
};

export type CrossPageRelations = Record<
  string,
  { incoming: CrossPageLink[]; outgoing: CrossPageLink[] }
>;

type RelationsResponse = {
  ok: boolean;
  pages?: Array<{
    pageKey: string;
    pageLabel: string;
    blocks: Array<{
      blockId: string;
      type: string;
      typeLabel: string;
      label: string;
      outgoing: Array<{ pageKey: string; blockId: string; field: string }>;
    }>;
  }>;
};

/**
 * Internal cache: ключ — currentPageKey, значение — последний computed map.
 * При повторном маунте overlay'а используется уже загруженный snapshot,
 * а свежий fetch обновит data в фоне (stale-while-revalidate).
 */
const cache = new Map<string, CrossPageRelations>();

export function useCrossPageRelations(
  currentPageKey: string,
  /** Если false — fetch не делается (overlay скрыт). Экономит сеть. */
  enabled: boolean,
): { relations: CrossPageRelations; loading: boolean } {
  const [data, setData] = useState<RelationsResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/blocks/relations', { cache: 'no-store' })
      .then((r) => r.json() as Promise<RelationsResponse>)
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch(() => {
        if (cancelled) return;
        setData({ ok: false });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const relations = useMemo<CrossPageRelations>(() => {
    if (!data?.ok || !data.pages) return cache.get(currentPageKey) ?? {};

    // Карта (pageKey, blockId) → label для popover'ов
    const labelByKey = new Map<string, { pageLabel: string; label: string; type: string }>();
    for (const p of data.pages) {
      for (const b of p.blocks) {
        labelByKey.set(`${p.pageKey}:${b.blockId}`, {
          pageLabel: p.pageLabel,
          label: b.label,
          type: b.type,
        });
      }
    }

    const result: CrossPageRelations = {};
    const ensure = (id: string) => {
      if (!result[id]) result[id] = { incoming: [], outgoing: [] };
      return result[id];
    };

    // Текущая страница: блоки с их исходящими связями → каждая ссылка на ДРУГУЮ
    // страницу = incoming для этого блока.
    const currentPage = data.pages.find((p) => p.pageKey === currentPageKey);
    if (currentPage) {
      for (const block of currentPage.blocks) {
        const bucket = ensure(block.blockId);
        const seen = new Set<string>();
        for (const out of block.outgoing) {
          if (out.pageKey === currentPageKey) continue;
          const key = `${out.pageKey}:${out.blockId}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const meta = labelByKey.get(key);
          bucket.incoming.push({
            pageKey: out.pageKey,
            pageLabel: meta?.pageLabel ?? out.pageKey,
            blockId: out.blockId,
            type: meta?.type ?? 'unknown',
            label: meta?.label ?? `Блок ${out.blockId.slice(0, 8)}`,
            field: out.field,
          });
        }
      }
    }

    // Все остальные страницы: их блоки, ссылающиеся НА блоки текущей страницы
    // → outgoing для соответствующих блоков текущей страницы.
    for (const page of data.pages) {
      if (page.pageKey === currentPageKey) continue;
      for (const block of page.blocks) {
        for (const out of block.outgoing) {
          if (out.pageKey !== currentPageKey) continue;
          const bucket = ensure(out.blockId);
          // Дедуп по target page+blockId (чтобы один внешний блок с N ссылками
          // показывался один раз в списке).
          if (
            bucket.outgoing.some(
              (o) => o.pageKey === page.pageKey && o.blockId === block.blockId,
            )
          ) {
            continue;
          }
          bucket.outgoing.push({
            pageKey: page.pageKey,
            pageLabel: page.pageLabel,
            blockId: block.blockId,
            type: block.type,
            label: block.label,
            field: out.field,
          });
        }
      }
    }

    cache.set(currentPageKey, result);
    return result;
  }, [data, currentPageKey]);

  return { relations, loading };
}

/** href по pageKey для кликабельных ссылок в popover. Best-effort. */
export function pageHref(pageKey: string): string {
  if (pageKey === 'dashboard') return '/app/dashboard';
  if (pageKey === 'cashflow') return '/app/cashflow';
  if (pageKey === 'inbox') return '/app/inbox';
  if (pageKey === 'taxes') return '/app/taxes';
  if (pageKey === 'deadlines') return '/app/deadlines';
  if (pageKey === 'settings') return '/app/settings';
  if (pageKey.startsWith('unit-economics-')) {
    const slug = pageKey.replace('unit-economics-', '');
    return `/app/unit-economics/${slug}`;
  }
  if (pageKey.startsWith('board-')) return `/app/boards/${pageKey.replace('board-', '')}`;
  return '#';
}
