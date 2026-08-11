// PURPOSE: Серверный entrypoint страницы «Маркетплейсы → Ozon».
// Загружает layout для marketplaces-ozon-dashboard и передаёт клиенту.

import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { loadLayout } from '@/lib/blocks/queries';
import { getPageWorkspaceScope } from '@/lib/workspaces/active';
import { MarketplacesOzonClient } from './marketplaces-ozon-client';

export default async function MarketplacesOzonPage() {
  const session = await auth();
  if (!session?.userId) redirect('/login');
  if (!session.tenantId) redirect('/app/onboarding');

  const scope = await getPageWorkspaceScope(
    session.tenantId,
    session.userId,
    'marketplaces-ozon-dashboard',
  );
  const layout = await loadLayout({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey: 'marketplaces-ozon-dashboard',
    workspaceId: scope.workspaceId,
    workspaceTemplate: scope.template,
  });

  return (
    <MarketplacesOzonClient
      tenantId={session.tenantId}
      workspaceId={scope.workspaceId}
      blocks={layout.blocks}
    />
  );
}
