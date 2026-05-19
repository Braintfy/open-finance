// PURPOSE: Layout для авторизованных страниц (dashboard, modules, settings)
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  LayoutDashboard,
  LayoutGrid,
  Inbox,
  Wallet,
  Calendar,
  Settings,
  Shield,
  Cpu,
  Users,
  Wrench,
  Sparkles,
  Calculator,
  Store,
  BarChart3,
} from 'lucide-react';
import { auth } from '@/lib/auth';
import { LogoutButton } from '@/components/logout-button';
import { CommandPalette } from '@/components/command-palette';
import { loadLayout } from '@/lib/blocks/queries';
import { listPinnedBoards } from '@/lib/boards/queries';
import { GlobalSyncIndicator } from '@/components/marketplaces/global-sync-indicator';

type NavItem = {
  key: string;
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  protected?: boolean;
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login');

  const isAdmin = session.globalRole === 'admin' || session.globalRole === 'super_admin';

  // Hidden sections — read from block_layouts pageKey='nav'
  let hidden = new Set<string>();
  if (session.tenantId && session.userId) {
    try {
      const navLayout = await loadLayout({
        tenantId: session.tenantId,
        userId: session.userId,
        pageKey: 'nav',
      });
      hidden = new Set(navLayout.hiddenSections ?? []);
    } catch {
      // ignore
    }
  }

  const mainNavAll: NavItem[] = [
    { key: 'dashboard', href: '/dashboard', label: 'Дашборд', icon: LayoutDashboard, protected: true },
    { key: 'inbox', href: '/inbox', label: 'Входящие', icon: Inbox },
    { key: 'cashflow', href: '/cashflow', label: 'Денежный поток', icon: Wallet },
    { key: 'unit-economics', href: '/unit-economics', label: 'Юнит-экономика', icon: Calculator },
    { key: 'marketplaces-ozon', href: '/marketplaces/ozon', label: 'Аналитика', icon: BarChart3 },
    { key: 'boards', href: '/boards', label: 'Мои доски', icon: LayoutGrid },
    { key: 'marketplace', href: '/marketplace', label: 'Маркет блоков', icon: Store },
    { key: 'deadlines', href: '/deadlines', label: 'Дедлайны', icon: Calendar },
    { key: 'settings', href: '/settings', label: 'Настройки', icon: Settings, protected: true },
  ];
  const adminNavAll: NavItem[] = [
    { key: 'admin', href: '/admin', label: 'Панель', icon: Shield },
    { key: 'admin-ai-models', href: '/admin/ai/local-models', label: 'AI модели', icon: Cpu },
    { key: 'admin-ai-prompt', href: '/admin/ai/system-prompt', label: 'AI prompt', icon: Sparkles },
    { key: 'admin-users', href: '/admin/users', label: 'Пользователи', icon: Users },
    { key: 'admin-settings', href: '/admin/settings', label: 'Настройки платформы', icon: Wrench },
  ];

  const mainNav = mainNavAll.filter((i) => i.protected || !hidden.has(i.key));
  const adminNav = adminNavAll.filter((i) => !hidden.has(i.key));

  // Pinned boards for sidebar
  let pinnedBoards: Array<{ id: string; name: string }> = [];
  if (session.tenantId && session.userId) {
    try {
      pinnedBoards = await listPinnedBoards({
        tenantId: session.tenantId,
        userId: session.userId,
      });
    } catch {
      // ignore
    }
  }

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="w-56 shrink-0 border-r border-border/60 bg-background px-2 py-3">
        <div className="mb-4 px-2">
          <div className="text-sm font-semibold tracking-tight">Open Finance</div>
          <div className="text-[10px] text-muted-foreground">v0.9.0</div>
        </div>
        <nav className="space-y-0.5">
          {mainNav.map(({ key: _k, protected: _p, ...rest }) => (
            <NavLink key={rest.href} {...rest} />
          ))}
          {pinnedBoards.length > 0 && (
            <>
              {pinnedBoards.map((b) => (
                <Link
                  key={b.id}
                  href={`/boards/${b.id}`}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 pl-7 text-[13px] text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
                >
                  <span className="truncate">{b.name}</span>
                </Link>
              ))}
            </>
          )}
          {isAdmin && (
            <>
              <div className="px-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Админ
              </div>
              {adminNav.map(({ key: _k, protected: _p, ...rest }) => (
                <NavLink key={rest.href} {...rest} />
              ))}
            </>
          )}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 bg-background px-4">
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">{session.email}</span>
            <CommandPalette />
          </div>
          <LogoutButton />
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-5">{children}</main>
      </div>
      <GlobalSyncIndicator />
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
