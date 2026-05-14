// PURPOSE: Хук для unit-economics блоков — собирает плоскую мапу
// live block values { 'blockId.field' | 'pageKey:blockId.field' -> value }
// и подгружает источники с других страниц через /api/blocks/sources.
'use client';

import { useContext, useEffect, useMemo, useState } from 'react';
import { BlockValuesContext } from '@/lib/blocks/values';

export type SourceField = {
  name: string;
  label: string;
  value: number | string | null;
  format?: 'money' | 'number' | 'text';
};

export type SourceBlock = {
  blockId: string;
  pageKey: string;
  pageLabel: string;
  type?: string;
  typeLabel: string;
  category: string;
  label: string;
  fields: SourceField[];
};

export type SourcePage = {
  pageKey: string;
  pageLabel: string;
  blocks: SourceBlock[];
};

export function useAllBlockValuesFlat(): Record<string, number | string | null> {
  const api = useContext(BlockValuesContext);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!api) return;
    return api.subscribe(() => setTick((t) => t + 1));
  }, [api]);
  return useMemo(() => {
    if (!api) return {};
    const result: Record<string, number | string | null> = {};
    for (const [blockId, output] of api.get().values.entries()) {
      for (const [field, value] of Object.entries(output)) {
        const key = field === 'value' ? blockId : `${blockId}.${field}`;
        result[key] = value;
      }
    }
    return result;
    // tick — обязательная reactive trigger зависимость для пересборки на изменения store
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, tick]);
}

export function useRemoteBlockSources(open: boolean): {
  pages: SourcePage[];
  loading: boolean;
} {
  const [pages, setPages] = useState<SourcePage[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    fetch('/api/blocks/sources')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.ok && Array.isArray(data.pages)) setPages(data.pages);
      })
      .catch(() => {
        if (!cancelled) setPages([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);
  return { pages, loading };
}
