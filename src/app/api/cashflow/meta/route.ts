// PURPOSE: GET /api/cashflow/meta — distinct sources и top contrahents для пикеров фильтров
import { NextResponse } from 'next/server';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { transactions } from '@/lib/db/schema/transactions';

export async function GET() {
  const session = await auth();
  if (!session?.tenantId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const [sourcesWithCount, counterparties] = await Promise.all([
    db
      .select({
        source: transactions.source,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(and(eq(transactions.tenantId, session.tenantId), isNotNull(transactions.source)))
      .groupBy(transactions.source)
      .orderBy(sql`count(*) desc`),
    db
      .select({
        counterparty: transactions.counterparty,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(
        and(eq(transactions.tenantId, session.tenantId), isNotNull(transactions.counterparty))
      )
      .groupBy(transactions.counterparty)
      .orderBy(sql`count(*) desc`)
      .limit(50),
  ]);

  return NextResponse.json({
    ok: true,
    // Backward-compat: массив string[]
    sources: sourcesWithCount.map((s) => s.source).filter(Boolean) as string[],
    // Новый формат с count'ами для UI chips
    sourcesWithCount: sourcesWithCount
      .filter((s) => s.source)
      .map((s) => ({ source: s.source as string, count: s.count })),
    counterparties: counterparties.map((c) => ({
      name: c.counterparty,
      count: c.count,
    })),
  });
}
