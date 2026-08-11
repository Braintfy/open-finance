// PURPOSE: Layout для авторизованных страниц (dashboard, modules, settings)
// B0 (перф): статическая оболочка (сайдбар-рамка + хедер + main) рендерится
// сразу после дешёвого auth() (JWT, без БД). DB-зависимая навигация
// (loadLayout('nav') + listPinnedBoards, распараллелены) стримится в <Suspense>
// → навигация больше не блокирует весь экран на каждом переходе, а контент
// страницы закрыт route-level loading.tsx.
import { Suspense } from 'react';
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
import { listWorkspaces } from '@/lib/workspaces/queries';
import { getWorkspaceScope, getPageWorkspaceScope } from '@/lib/workspaces/active';
import { listWorkspaceTemplates } from '@/lib/blocks/default-layouts';
import { WorkspaceSwitcher } from '@/components/workspaces/workspace-switcher';
import { GlobalSyncIndicator } from '@/components/marketplaces/global-sync-indicator';
import { APP_VERSION } from '@/lib/version';
import { Skeleton } from '@/components/ui/skeleton';

type Session = NonNullable<Awaited<ReturnType<typeof auth>>>;

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

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="sticky top-0 z-30 flex h-screen w-56 shrink-0 flex-col self-start overflow-y-auto border-r border-border/60 bg-background px-2 py-3">
        <div className="mb-4 px-2">
          <div className="text-sm font-semibold tracking-tight">Open Finance</div>
          <div className="text-[10px] text-muted-foreground">v{APP_VERSION}</div>
        </div>
        <nav className="space-y-0.5">
          <Suspense fallback={<SidebarNavSkeleton isAdmin={isAdmin} />}>
            <SidebarNav session={session} isAdmin={isAdmin} />
          </Suspense>
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 bg-background px-4">
          <div className="flex min-w-0 items-center gap-3">
            <Suspense fallback={<Skeleton className="h-6 w-32 rounded" />}>
              <WorkspaceSwitcherSlot session={session} />
            </Suspense>
            <span className="hidden truncate text-xs text-muted-foreground sm:inline">
              {session.email}
            </span>
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

// Async-секция шапки: список кабинетов + активный (кука/users.settings).
// Стримится в <Suspense>, чтобы резолв воркспейсов не блокировал отрисовку оболочки.
async function WorkspaceSwitcherSlot({ session }: { session: Session }) {
  if (!session.tenantId || !session.userId) return null;

  const [list, scope] = await Promise.all([
    listWorkspaces({ tenantId: session.tenantId, userId: session.userId }).catch(() => []),
    getWorkspaceScope(session.tenantId, session.userId).catch(() => null),
  ]);
  if (list.length === 0 || !scope) return null;

  return (
    <WorkspaceSwitcher
      workspaces={list.map((w) => ({ id: w.id, name: w.name, isDefault: w.isDefault }))}
      activeId={scope.activeId}
      templates={listWorkspaceTemplates().map((t) => ({
        id: t.id,
        label: t.label,
        description: t.description,
      }))}
    />
  );
}

// Async-секция навигации: единственное место в оболочке, которое ходит в БД.
// Завёрнута в <Suspense> → не задерживает отрисовку рамки/хедера/контента.
async function SidebarNav({ session, isAdmin }: { session: Session; isAdmin: boolean }) {
  let hidden = new Set<string>();
  let pinnedBoards: Array<{ id: string; name: string }> = [];

  if (session.tenantId && session.userId) {
    // 'nav' — ОБЩАЯ раскладка сайдбара: всегда default-кабинет (isSharedPageKey).
    const navScope = await getPageWorkspaceScope(
      session.tenantId,
      session.userId,
      'nav',
    ).catch(() => null);
    const [navLayout, pins] = await Promise.all([
      loadLayout({
        tenantId: session.tenantId,
        userId: session.userId,
        pageKey: 'nav',
        workspaceId: navScope?.workspaceId,
        workspaceTemplate: navScope?.template,
      }).catch(() => null),
      listPinnedBoards({ tenantId: session.tenantId, userId: session.userId }).catch(() => []),
    ]);
    if (navLayout) hidden = new Set(navLayout.hiddenSections ?? []);
    pinnedBoards = pins ?? [];
  }

  const mainNavAll: NavItem[] = [
    { key: 'dashboard', href: '/app/dashboard', label: 'Дашборд', icon: LayoutDashboard, protected: true },
    { key: 'inbox', href: '/app/inbox', label: 'Входящие', icon: Inbox },
    { key: 'cashflow', href: '/app/cashflow', label: 'Денежный поток', icon: Wallet },
    { key: 'unit-economics', href: '/app/unit-economics', label: 'Юнит-экономика', icon: Calculator },
    { key: 'marketplaces-ozon', href: '/app/marketplaces/ozon', label: 'Аналитика', icon: BarChart3 },
    { key: 'boards', href: '/app/boards', label: 'Мои доски', icon: LayoutGrid },
    { key: 'marketplace', href: '/app/marketplace', label: 'Маркет блоков', icon: Store },
    { key: 'deadlines', href: '/app/deadlines', label: 'Дедлайны', icon: Calendar },
    { key: 'settings', href: '/app/settings', label: 'Настройки', icon: Settings, protected: true },
  ];
  const adminNavAll: NavItem[] = [
    { key: 'admin', href: '/app/admin', label: 'Панель', icon: Shield },
    { key: 'admin-ai-models', href: '/app/admin/ai/local-models', label: 'AI модели', icon: Cpu },
    { key: 'admin-ai-prompt', href: '/app/admin/ai/system-prompt', label: 'AI prompt', icon: Sparkles },
    { key: 'admin-users', href: '/app/admin/users', label: 'Пользователи', icon: Users },
    { key: 'admin-settings', href: '/app/admin/settings', label: 'Настройки платформы', icon: Wrench },
  ];

  const mainNav = mainNavAll.filter((i) => i.protected || !hidden.has(i.key));
  const adminNav = adminNavAll.filter((i) => !hidden.has(i.key));

  return (
    <>
      {mainNav.map(({ key: _k, protected: _p, ...rest }) => (
        <NavLink key={rest.href} {...rest} />
      ))}
      {pinnedBoards.length > 0 &&
        pinnedBoards.map((b) => (
          <Link
            key={b.id}
            href={`/app/boards/${b.id}`}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 pl-7 text-[13px] text-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
          >
            <span className="truncate">{b.name}</span>
          </Link>
        ))}
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
    </>
  );
}

function SidebarNavSkeleton({ isAdmin }: { isAdmin: boolean }) {
  return (
    <>
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 px-2 py-1.5">
          <Skeleton className="h-3.5 w-3.5 rounded" />
          <Skeleton className="h-3 w-24" />
        </div>
      ))}
      {isAdmin && (
        <>
          <div className="px-2 pb-1 pt-4">
            <Skeleton className="h-2.5 w-12" />
          </div>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={`admin-${i}`} className="flex items-center gap-2 px-2 py-1.5">
              <Skeleton className="h-3.5 w-3.5 rounded" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </>
      )}
    </>
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
