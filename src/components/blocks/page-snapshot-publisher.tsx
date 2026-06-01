// PURPOSE: Невидимый bridge-компонент. Монтируется ВНУТРИ BlockValuesProvider
// (в BlockGrid), собирает снапшот блоков страницы (config + live-значения +
// __aiContext) и публикует его во внешний page-snapshot store по pageKey,
// откуда его читает модалка «AI Анализ» (живёт вне провайдера).
'use client';

import { useContext, useEffect, useRef } from 'react';
import { BlockValuesContext } from '@/lib/blocks/values';
import { getBlockDef } from '@/lib/blocks/registry';
import { setPageSnapshot } from '@/lib/blocks/page-snapshot';
import type { BlockInstance } from '@/lib/blocks/types';
import type { SectionBlockSnapshot } from '@/lib/ai/section-insights';

export function PageSnapshotPublisher({
  pageKey,
  blocks,
}: {
  pageKey: string;
  blocks: BlockInstance[];
}) {
  const api = useContext(BlockValuesContext);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!api) return;

    const rebuild = () => {
      const values = api.get().values;
      const snapshot: SectionBlockSnapshot[] = blocks.map((b) => {
        const def = getBlockDef(b.type);
        const title = b.appearance?.title ?? def?.displayName ?? b.type;
        const output = values.get(b.id);

        let aiContext: string | null = null;
        let cleanOutput: Record<string, number | string | null> | undefined;
        if (output) {
          const acc: Record<string, number | string | null> = {};
          for (const [k, v] of Object.entries(output)) {
            if (k === '__aiContext') {
              aiContext = typeof v === 'string' ? v : null;
              continue;
            }
            if (k.startsWith('__')) continue;
            acc[k] = v;
          }
          if (Object.keys(acc).length > 0) cleanOutput = acc;
        }

        const config =
          b.config && Object.keys(b.config).length > 0
            ? (b.config as Record<string, unknown>)
            : undefined;

        const sources = b.dependencies?.sources?.map((s) => s.blockId);

        return {
          blockId: b.id,
          type: b.type,
          title,
          config,
          output: cleanOutput,
          aiContext,
          sources: sources && sources.length ? sources : undefined,
        };
      });
      setPageSnapshot(pageKey, snapshot);
    };

    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(rebuild, 150);
    };

    rebuild();
    const unsub = api.subscribe(schedule);
    return () => {
      unsub();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [api, pageKey, blocks]);

  return null;
}
