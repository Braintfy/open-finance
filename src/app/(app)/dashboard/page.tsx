// PURPOSE: Главный экран дашборда
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { Inbox, Wallet, Calendar } from 'lucide-react';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { tenants } from '@/lib/db/schema/tenants';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getCashflowSummary } from '@/lib/cashflow/queries';
import { formatRubles } from '@/lib/utils';

export default async function DashboardPage() {
  const session = await auth();
  if (!session) redirect('/login');

  let tenant: typeof tenants.$inferSelect | undefined;
  if (session.tenantId) {
    const rows = await db.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1);
    tenant = rows[0];
  }

  if (tenant && !tenant.onboardingCompleted) {
    redirect('/onboarding');
  }

  const summary = session.tenantId
    ? await getCashflowSummary(
        session.tenantId,
        new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      )
    : { incomeTotal: 0, expenseTotal: 0, balance: 0, incomeCount: 0, expenseCount: 0 };

  const hasData = summary.incomeCount + summary.expenseCount > 0;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Привет, {session.email.split('@')[0]}
        </h1>
        <p className="text-muted-foreground">
          {hasData
            ? `Сводка за текущий месяц`
            : `Начните с импорта выписки или добавления первой операции`}
        </p>
      </div>

      {hasData && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-normal text-muted-foreground">Доходы</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold text-green-600">
              {formatRubles(summary.incomeTotal)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-normal text-muted-foreground">Расходы</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold text-red-600">
              {formatRubles(summary.expenseTotal)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-normal text-muted-foreground">Баланс</CardTitle>
            </CardHeader>
            <CardContent
              className={`text-3xl font-semibold ${
                summary.balance >= 0 ? 'text-foreground' : 'text-red-600'
              }`}
            >
              {summary.balance < 0 ? '−' : ''}
              {formatRubles(Math.abs(summary.balance))}
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <ModuleCard
          icon={<Wallet className="size-5" />}
          title="Денежный поток"
          desc="Доходы и расходы, импорт выписок"
          href="/cashflow"
        />
        <ModuleCard
          icon={<Inbox className="size-5" />}
          title="Inbox"
          desc="Чеки, счета, договоры — AI разберёт"
          href="/inbox"
          comingSoon
        />
        <ModuleCard
          icon={<Calendar className="size-5" />}
          title="Дедлайны"
          desc="Налоги, отчёты, обязательства"
          href="/deadlines"
          comingSoon
        />
      </div>

      <Alert variant="warning">
        <AlertDescription>
          <strong>Foundation phase.</strong> Сейчас работают auth, лендинг, cashflow с импортом
          CSV/XLSX. Inbox, Deadlines, AI-секретарь — в разработке. План:{' '}
          <Link href="/PLAN.md" className="underline">
            PLAN.md
          </Link>
          .
        </AlertDescription>
      </Alert>
    </div>
  );
}

function ModuleCard({
  icon,
  title,
  desc,
  href,
  comingSoon,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  href: string;
  comingSoon?: boolean;
}) {
  const inner = (
    <Card className={`transition-shadow ${comingSoon ? 'opacity-60' : 'hover:shadow-md'}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground">{icon}</div>
          {comingSoon && <span className="text-xs text-muted-foreground">скоро</span>}
        </div>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{desc}</CardContent>
    </Card>
  );
  if (comingSoon) return inner;
  return <Link href={href}>{inner}</Link>;
}
