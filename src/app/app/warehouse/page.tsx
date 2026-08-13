// PURPOSE: Страница «Склад» (pageKey='warehouse') — Block-Grid раздела
// «Склад · Поставки · Себестоимость» (docs/STOCK_MODULE_DESIGN.md §7).
//
// Раскладка живёт per-workspace (block_layouts.workspace_id) через
// getPageWorkspaceScope — как на всех остальных страницах приложения.
// Сам склад при этом ОДИН на бизнес (§12.1): кабинеты — это разные взгляды
// на одни и те же остатки, а не разные склады.

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { loadLayout } from '@/lib/blocks/queries';
import { getPageWorkspaceScope } from '@/lib/workspaces/active';
import { WarehouseClient } from './warehouse-client';

export default async function WarehousePage() {
  const session = await auth();
  if (!session?.tenantId || !session.userId) redirect('/login');

  const scope = await getPageWorkspaceScope(session.tenantId, session.userId, 'warehouse');
  const layout = await loadLayout({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey: 'warehouse',
    workspaceId: scope.workspaceId,
    workspaceTemplate: scope.template,
  });

  return (
    <WarehouseClient
      tenantId={session.tenantId}
      workspaceId={scope.workspaceId}
      initialBlocks={layout.blocks}
    />
  );
}
