// PURPOSE: Админ-панель платформы (super_admin/admin доступ через middleware)
import { db } from '@/lib/db/client';
import { users } from '@/lib/db/schema/users';
import { tenants } from '@/lib/db/schema/tenants';
import { sql } from 'drizzle-orm';

export default async function AdminPage() {
  const [usersCount] = await db.select({ count: sql<number>`count(*)::int` }).from(users);
  const [tenantsCount] = await db.select({ count: sql<number>`count(*)::int` }).from(tenants);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-2 text-2xl font-semibold text-zinc-900">Панель администратора</h1>
      <p className="mb-8 text-zinc-600">Глобальные настройки и управление платформой</p>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Пользователей" value={usersCount?.count ?? 0} />
        <Stat label="Tenants" value={tenantsCount?.count ?? 0} />
        <Stat label="Активных подписок" value={0} hint="(биллинг-mock)" />
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <Section title="Пользователи и доступ" links={[
          { href: '/admin/users', label: 'Список пользователей' },
          { href: '/admin/settings', label: 'Открытая регистрация / by-invite' },
        ]} />
        <Section title="AI и инфраструктура" links={[
          { href: '/admin/ai/local-models', label: 'Локальные модели (Ollama) — менеджер' },
          { href: '/admin/ai/providers', label: 'Внешние API + VPN + диагностика' },
          { href: '/admin/ai/system-prompt', label: 'System prompt (общий)' },
          { href: '/admin/audit', label: 'AI Audit log' },
        ]} />
        <Section title="Биллинг" links={[
          { href: '/admin/billing', label: 'Подписки и платежи (mock)' },
          { href: '/admin/changelog', label: 'CHANGELOG (что появилось)' },
        ]} />
        <Section title="Мониторинг" links={[
          { href: '/api/health', label: 'Health endpoint' },
          { href: 'http://localhost:8081', label: 'Adminer (Postgres UI)' },
        ]} />
      </div>

      <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Заглушки.</strong> Большинство ссылок — TODO для следующих этапов плана. Сейчас работает
        только просмотр статистики и аудит-лог (когда появятся записи).
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="text-sm text-zinc-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-zinc-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-400">{hint}</div>}
    </div>
  );
}

function Section({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <div className="mb-3 font-medium text-zinc-900">{title}</div>
      <ul className="space-y-1.5 text-sm">
        {links.map((l) => (
          <li key={l.href}>
            <a href={l.href} className="text-zinc-700 hover:text-zinc-900 hover:underline">
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
