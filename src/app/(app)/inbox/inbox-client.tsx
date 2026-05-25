// PURPOSE: Client shell for /inbox with project-standard header and BlockGrid.
'use client';

import { BlockGrid } from '@/components/blocks/block-grid';
import { SectionAiButton } from '@/components/blocks/section-ai-button';
import type { BlockInstance } from '@/lib/blocks/types';

export function InboxClient({
  tenantId,
  initialBlocks,
}: {
  tenantId: string;
  initialBlocks: BlockInstance[];
}) {
  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">Входящие</h1>
          <p className="text-xs text-muted-foreground">Почта и каналы для AI-секретаря</p>
        </div>
        <div className="shrink-0">
          <SectionAiButton pageKey="inbox" pageLabel="Входящие" />
        </div>
      </div>

      <BlockGrid pageKey="inbox" tenantId={tenantId} initialBlocks={initialBlocks} />
    </div>
  );
}
