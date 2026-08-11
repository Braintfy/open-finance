// PURPOSE: Клиентский UI страницы «Маркетплейсы → Ozon» — один BlockGrid
// со всеми Ozon-блоками (KPI, графики, таблицы, AI инсайты).

'use client';

import { BarChart3 } from 'lucide-react';
import { BlockGrid } from '@/components/blocks/block-grid';
import type { BlockInstance } from '@/lib/blocks/types';
import { SyncAllButton } from '@/components/marketplaces/sync-all-button';
import { SectionAiButton } from '@/components/blocks/section-ai-button';

export function MarketplacesOzonClient({
  tenantId,
  workspaceId,
  blocks,
}: {
  tenantId: string;
  /** Активный кабинет — ключ ремоунта грида при переключении. */
  workspaceId?: string;
  blocks: BlockInstance[];
}) {
  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              Аналитика
            </h1>
            <p className="text-xs text-muted-foreground">
              KPI, динамика, рекламная аналитика и инсайты по магазинам Ozon.
              Настройки магазинов — в Настройках → Интеграции.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <SectionAiButton pageKey="marketplaces-ozon-dashboard" pageLabel="Аналитика Ozon" />
          <SyncAllButton />
        </div>
      </div>
      <BlockGrid
        key={`${workspaceId ?? 'default'}:marketplaces-ozon-dashboard`}
        pageKey="marketplaces-ozon-dashboard"
        initialBlocks={blocks}
        tenantId={tenantId}
        workspaceId={workspaceId}
      />
    </div>
  );
}
