// PURPOSE: /app/warehouse — Block-Grid обёртка раздела «Склад» с действиями
// страницы (новая поставка) и AI-анализом раздела.
//
// Период страницы включён (periodPanel='always'): блок stock.docs наследует его
// через useBlockPeriod, а блок остатков периода не имеет — остаток всегда «сейчас».

'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackagePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BlockGrid } from '@/components/blocks/block-grid';
import { SectionAiButton } from '@/components/blocks/section-ai-button';
import { StockDocDialog } from '@/components/stock/stock-doc-dialog';
import type { BlockInstance } from '@/lib/blocks/types';

export function WarehouseClient({
  tenantId,
  workspaceId,
  initialBlocks,
}: {
  tenantId: string;
  /** Активный кабинет — ключ ремоунта грида при переключении. */
  workspaceId?: string;
  initialBlocks: BlockInstance[];
}) {
  const router = useRouter();
  const [showSupply, setShowSupply] = useState(false);

  // router.refresh() перерисовывает серверную часть страницы; блоки
  // перезапрашивают свои данные сами (у каждого свой fetch).
  const onSaved = useCallback(() => {
    setShowSupply(false);
    router.refresh();
  }, [router]);

  return (
    <div className="mx-auto max-w-[1400px] space-y-3">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold tracking-tight">Склад</h1>
          <p className="text-xs text-muted-foreground">
            Поставки, остатки и себестоимость. Журнал — единственный источник правды
            по своему складу; остатки Ozon отдаёт маркетплейс.
          </p>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <SectionAiButton pageKey="warehouse" pageLabel="Склад" />
          <Button size="sm" onClick={() => setShowSupply(true)}>
            <PackagePlus /> Новая поставка
          </Button>
        </div>
      </div>

      <BlockGrid
        key={`${workspaceId ?? 'default'}:warehouse`}
        pageKey="warehouse"
        tenantId={tenantId}
        workspaceId={workspaceId}
        initialBlocks={initialBlocks}
        periodPanel="auto"
        periodPanelDescription="Период применяется к ленте документов; остатки всегда показываются на текущий момент"
      />

      <StockDocDialog
        open={showSupply}
        kind="purchase"
        onClose={() => setShowSupply(false)}
        onSaved={onSaved}
      />
    </div>
  );
}
