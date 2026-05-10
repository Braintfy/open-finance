// PURPOSE: Layout для авторизованных страниц (dashboard, modules, settings)
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { LogoutButton } from '@/components/logout-button';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login');

  const isAdmin = session.globalRole === 'admin' || session.globalRole === 'super_admin';

  return (
    <div className="flex min-h-screen bg-zinc-50">
      <aside className="w-60 border-r border-zinc-200 bg-white p-4">
        <div className="mb-8 px-2">
          <div className="text-lg font-semibold text-zinc-900">Open Finance</div>
          <div className="text-xs text-zinc-500">v0.7.0</div>
        </div>
        <nav className="space-y-1 text-sm">
          <Link href="/dashboard" className="block rounded-md px-3 py-2 text-zinc-700 hover:bg-zinc-100">
            Дашборд
          </Link>
          <Link href="/inbox" className="block rounded-md px-3 py-2 text-zinc-700 hover:bg-zinc-100">
            Inbox
          </Link>
          <Link href="/cashflow" className="block rounded-md px-3 py-2 text-zinc-700 hover:bg-zinc-100">
            Денежный поток
          </Link>
          <Link href="/deadlines" className="block rounded-md px-3 py-2 text-zinc-700 hover:bg-zinc-100">
            Дедлайны
          </Link>
          <Link href="/settings" className="block rounded-md px-3 py-2 text-zinc-700 hover:bg-zinc-100">
            Настройки
          </Link>
          {isAdmin && (
            <>
              <div className="px-3 pt-4 text-xs font-medium uppercase tracking-wider text-zinc-400">
                Админ
              </div>
              <Link href="/admin" className="block rounded-md px-3 py-2 text-zinc-700 hover:bg-zinc-100">
                Панель
              </Link>
              <Link href="/admin/ai/local-models" className="block rounded-md px-3 py-2 text-zinc-700 hover:bg-zinc-100">
                AI модели
              </Link>
              <Link href="/admin/users" className="block rounded-md px-3 py-2 text-zinc-700 hover:bg-zinc-100">
                Пользователи
              </Link>
              <Link href="/admin/settings" className="block rounded-md px-3 py-2 text-zinc-700 hover:bg-zinc-100">
                Настройки платформы
              </Link>
            </>
          )}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-zinc-200 bg-white px-6">
          <div className="text-sm text-zinc-600">{session.email}</div>
          <LogoutButton />
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
