// PURPOSE: Layout для авторизованных страниц (dashboard, modules, settings)
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  LayoutDashboard,
  Inbox,
  Wallet,
  Calendar,
  Settings,
  Shield,
  Cpu,
  Users,
  Wrench,
  Sparkles,
} from 'lucide-react';
import { auth } from '@/lib/auth';
import { LogoutButton } from '@/components/logout-button';

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session) redirect('/login');

  const isAdmin = session.globalRole === 'admin' || session.globalRole === 'super_admin';

  const mainNav: NavItem[] = [
    { href: '/dashboard', label: 'Дашборд', icon: LayoutDashboard },
    { href: '/inbox', label: 'Inbox', icon: Inbox },
    { href: '/cashflow', label: 'Денежный поток', icon: Wallet },
    { href: '/deadlines', label: 'Дедлайны', icon: Calendar },
    { href: '/settings', label: 'Настройки', icon: Settings },
  ];
  const adminNav: NavItem[] = [
    { href: '/admin', label: 'Панель', icon: Shield },
    { href: '/admin/ai/local-models', label: 'AI модели', icon: Cpu },
    { href: '/admin/ai/system-prompt', label: 'AI prompt', icon: Sparkles },
    { href: '/admin/users', label: 'Пользователи', icon: Users },
    { href: '/admin/settings', label: 'Настройки платформы', icon: Wrench },
  ];

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="w-56 shrink-0 border-r border-border/60 bg-background px-2 py-3">
        <div className="mb-4 px-2">
          <div className="text-sm font-semibold tracking-tight">Open Finance</div>
          <div className="text-[10px] text-muted-foreground">v0.8.2</div>
        </div>
        <nav className="space-y-0.5">
          {mainNav.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
          {isAdmin && (
            <>
              <div className="px-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Админ
              </div>
              {adminNav.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </>
          )}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-10 shrink-0 items-center justify-between border-b border-border/60 bg-background px-4">
          <div className="text-xs text-muted-foreground">{session.email}</div>
          <LogoutButton />
        </header>
        <main className="min-w-0 flex-1 p-4 md:p-5">{children}</main>
      </div>
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
