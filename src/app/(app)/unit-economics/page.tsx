// PURPOSE: Серверный entrypoint раздела «Юнит-экономика».
// v0.22.0: вкладки больше не захардкожены — загружаются из unit_economics_tabs,
// каждая со своим layout'ом. При первом визите делается seed 4 дефолтов.
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { loadLayout } from '@/lib/blocks/queries';
import { listTabs } from '@/lib/unit-economics/tabs-queries';
import { UnitEconomicsClient, type ClientTab } from './unit-economics-client';

export default async function UnitEconomicsPage() {
  const session = await auth();
  if (!session?.userId) redirect('/login');
  if (!session.tenantId) redirect('/onboarding');

  const tabs = await listTabs({ tenantId: session.tenantId, userId: session.userId });

  const tabsWithLayouts: ClientTab[] = await Promise.all(
    tabs.map(async (t) => {
      const layout = await loadLayout({
        tenantId: session.tenantId!,
        userId: session.userId!,
        pageKey: t.pageKey,
      });
      return {
        id: t.id,
        pageKey: t.pageKey,
        label: t.label,
        icon: t.icon,
        order: t.order,
        kind: t.kind,
        defaultKey: t.defaultKey,
        blocks: layout.blocks,
      };
    }),
  );

  return <UnitEconomicsClient tenantId={session.tenantId} initialTabs={tabsWithLayouts} />;
}
