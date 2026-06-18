// PURPOSE: Страница интеграций маркетплейсов (`/app/settings/integrations`).
// SSR-загрузка списка аккаунтов + plan для tenant'а; всё остальное —
// в client-компоненте IntegrationsClient.

import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { auth } from '@/lib/auth';
import { listAccounts, toPublicAccount } from '@/lib/marketplaces/queries';
import { IntegrationsClient } from './integrations-client';

export default async function IntegrationsPage() {
  const session = await auth();
  if (!session?.userId || !session.tenantId) redirect('/login');

  const [tenant] = await db
    .select({ plan: tenants.plan })
    .from(tenants)
    .where(eq(tenants.id, session.tenantId))
    .limit(1);

  let accountsPublic: Awaited<ReturnType<typeof listAccounts>> extends Array<infer A>
    ? Array<ReturnType<typeof toPublicAccount>>
    : never = [];
  try {
    const rows = await listAccounts({ tenantId: session.tenantId });
    accountsPublic = rows.map(toPublicAccount);
  } catch {
    // Таблица marketplace_accounts может ещё не существовать (manual SQL не применили).
    accountsPublic = [];
  }

  return (
    <IntegrationsClient
      initialAccounts={accountsPublic}
      tenantPlan={tenant?.plan ?? 'free'}
    />
  );
}
