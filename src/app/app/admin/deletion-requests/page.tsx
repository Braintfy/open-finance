// PURPOSE: Админ — заявки на удаление аккаунтов (152-ФЗ «право на удаление»).
// Просмотр — admin|super_admin (гейт middleware + redirect-страховка). Обработка
// (выполнить/отклонить) — только super_admin (canProcess + серверный гейт в API).
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { listDeletionRequests } from '@/lib/account/deletion-queries';
import { RequestsTable, type AdminDeletionRequest } from './requests-table';

export default async function DeletionRequestsPage() {
  const session = await auth();
  if (!session?.userId) redirect('/login');
  const isAdmin = session.globalRole === 'admin' || session.globalRole === 'super_admin';
  if (!isAdmin) redirect('/app/dashboard');

  const rows = await listDeletionRequests({});
  const initial: AdminDeletionRequest[] = rows.map((r) => ({
    id: r.id,
    email: r.email,
    reason: r.reason,
    status: r.status,
    requestedAt: r.requestedAt.toISOString(),
    processedAt: r.processedAt ? r.processedAt.toISOString() : null,
    note: r.note,
  }));

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Заявки на удаление аккаунтов</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        152-ФЗ — право на удаление. «Удалить» физически и безвозвратно стирает аккаунт со всеми
        данными. Обработка доступна только super_admin.
      </p>
      <RequestsTable initial={initial} canProcess={session.globalRole === 'super_admin'} />
    </div>
  );
}
