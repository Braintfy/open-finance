// PURPOSE: Главный экран дашборда — пока заглушка с приветствием
import Link from 'next/link';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect('/login');

  let tenant: typeof tenants.$inferSelect | undefined;
  if (session.tenantId) {
    const rows = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
    tenant = rows[0];
  }

  // Если ещё не прошёл онбординг — отправляем туда
  if (tenant && !tenant.onboardingCompleted) {
    redirect('/onboarding');
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-2 text-2xl font-semibold text-zinc-900">Привет, {session.email.split('@')[0]}</h1>
      <p className="mb-8 text-zinc-600">
        Добро пожаловать в Open Finance. Это ранняя foundation-версия — модули появятся в Этапе 1.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Денежный поток" href="/cashflow" desc="Доходы и расходы по счетам" />
        <Card title="Inbox" href="/inbox" desc="Чеки, счета, договоры — AI разберёт" />
        <Card title="Дедлайны" href="/deadlines" desc="Налоги, отчёты, обязательства" />
      </div>

      <div className="mt-8 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Foundation phase.</strong> Сейчас работают только auth, лендинг и каркас. Модули в разработке.
        План:{' '}
        <Link href="/PLAN.md" className="underline">
          PLAN.md
        </Link>
        .
      </div>
    </div>
  );
}

function Card({ title, href, desc }: { title: string; href: string; desc: string }) {
  return (
    <Link
      href={href}
      className="block rounded-xl border border-zinc-200 bg-white p-5 transition hover:border-zinc-400 hover:shadow-sm"
    >
      <div className="mb-1 font-medium text-zinc-900">{title}</div>
      <div className="text-sm text-zinc-500">{desc}</div>
    </Link>
  );
}
