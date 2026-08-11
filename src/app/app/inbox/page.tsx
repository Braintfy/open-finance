// PURPOSE: /inbox — Входящие как BlockGrid-страница для каналов коммуникаций.
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { loadLayout } from '@/lib/blocks/queries';
import { getPageWorkspaceScope } from '@/lib/workspaces/active';
import { InboxClient } from './inbox-client';

export default async function InboxPage() {
  const session = await auth();
  if (!session?.tenantId || !session.userId) redirect('/login');

  const scope = await getPageWorkspaceScope(session.tenantId, session.userId, 'inbox');
  const layout = await loadLayout({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey: 'inbox',
    workspaceId: scope.workspaceId,
    workspaceTemplate: scope.template,
  });

  return (
    <InboxClient
      tenantId={session.tenantId}
      workspaceId={scope.workspaceId}
      initialBlocks={layout.blocks}
    />
  );
}
