// PURPOSE: /inbox — Входящие как BlockGrid-страница для каналов коммуникаций.
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { loadLayout } from '@/lib/blocks/queries';
import { InboxClient } from './inbox-client';

export default async function InboxPage() {
  const session = await auth();
  if (!session?.tenantId || !session.userId) redirect('/login');

  const layout = await loadLayout({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey: 'inbox',
  });

  return <InboxClient tenantId={session.tenantId} initialBlocks={layout.blocks} />;
}
