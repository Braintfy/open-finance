// PURPOSE: Клиентский UI раздела «Юнит-экономика» — три вкладки
// (Ozon · Ozon мульти · Яндекс Маркет), каждая со своим BlockGrid.
'use client';

import { useState } from 'react';
import { Calculator, Table as TableIcon, Layers } from 'lucide-react';
import { BlockGrid } from '@/components/blocks/block-grid';
import type { BlockInstance } from '@/lib/blocks/types';
import { cn } from '@/lib/utils';

type TabKey = 'ozon' | 'ozon-multi' | 'yandex';

const TABS: Array<{
  key: TabKey;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  pageKey: string;
}> = [
  {
    key: 'ozon',
    label: 'Ozon',
    description: 'FBO / FBS · одиночный товар',
    icon: Calculator,
    pageKey: 'unit-economics-ozon',
  },
  {
    key: 'ozon-multi',
    label: 'Ozon мульти-артикул',
    description: 'Таблица товаров с расчётом и привязками',
    icon: TableIcon,
    pageKey: 'unit-economics-ozon-multi',
  },
  {
    key: 'yandex',
    label: 'Яндекс Маркет',
    description: 'FBY / FBS / DBS / Express',
    icon: Layers,
    pageKey: 'unit-economics-yandex',
  },
];

export function UnitEconomicsClient({
  tenantId,
  ozonBlocks,
  multiBlocks,
  yandexBlocks,
}: {
  tenantId: string;
  ozonBlocks: BlockInstance[];
  multiBlocks: BlockInstance[];
  yandexBlocks: BlockInstance[];
}) {
  const [active, setActive] = useState<TabKey>('ozon-multi');
  const blocksByTab: Record<TabKey, BlockInstance[]> = {
    ozon: ozonBlocks,
    'ozon-multi': multiBlocks,
    yandex: yandexBlocks,
  };
  const activeTab = TABS.find((t) => t.key === active)!;

  return (
    <div className="mx-auto max-w-[1600px] space-y-3">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">Юнит-экономика</h1>
          <p className="text-xs text-muted-foreground">
            Маржа, P&amp;L и окупаемость товаров на маркетплейсах
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border/40 pb-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = active === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              className={cn(
                'group flex items-center gap-2 rounded-t-md border-b-2 px-3 py-1.5 text-[13px] transition-colors',
                isActive
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <div className="flex flex-col text-left">
                <span className={isActive ? 'font-semibold' : 'font-medium'}>{tab.label}</span>
                <span className="text-[10px] text-muted-foreground">{tab.description}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Render only the active grid (each grid persists its own layout) */}
      <BlockGrid
        key={activeTab.pageKey}
        pageKey={activeTab.pageKey}
        tenantId={tenantId}
        initialBlocks={blocksByTab[active]}
      />
    </div>
  );
}
