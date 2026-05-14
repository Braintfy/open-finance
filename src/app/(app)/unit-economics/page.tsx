// PURPOSE: Серверный entrypoint раздела «Юнит-экономика». Загружает layouts
// для трёх вкладок и передаёт их клиенту.
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { loadLayout } from '@/lib/blocks/queries';
import { UnitEconomicsClient } from './unit-economics-client';

export default async function UnitEconomicsPage() {
  const session = await auth();
  if (!session?.userId) redirect('/login');
  if (!session.tenantId) redirect('/onboarding');

  const [ozonLayout, multiLayout, yandexLayout, myStoreLayout] = await Promise.all([
    loadLayout({
      tenantId: session.tenantId,
      userId: session.userId,
      pageKey: 'unit-economics-ozon',
    }),
    loadLayout({
      tenantId: session.tenantId,
      userId: session.userId,
      pageKey: 'unit-economics-ozon-multi',
    }),
    loadLayout({
      tenantId: session.tenantId,
      userId: session.userId,
      pageKey: 'unit-economics-yandex',
    }),
    loadLayout({
      tenantId: session.tenantId,
      userId: session.userId,
      pageKey: 'unit-economics-my-store',
    }),
  ]);

  return (
    <UnitEconomicsClient
      tenantId={session.tenantId}
      ozonBlocks={ozonLayout.blocks}
      multiBlocks={multiLayout.blocks}
      yandexBlocks={yandexLayout.blocks}
      myStoreBlocks={myStoreLayout.blocks}
    />
  );
}
