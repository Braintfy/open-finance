// PURPOSE: Настройки — видимость разделов навигации, общие предпочтения
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { loadLayout } from '@/lib/blocks/queries';
import { SettingsClient } from './settings-client';

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.userId || !session.tenantId) redirect('/login');

  const navLayout = await loadLayout({
    tenantId: session.tenantId,
    userId: session.userId,
    pageKey: 'nav',
  });

  return (
    <SettingsClient
      initialHidden={navLayout.hiddenSections ?? []}
      isAdmin={session.globalRole === 'admin' || session.globalRole === 'super_admin'}
    />
  );
}
