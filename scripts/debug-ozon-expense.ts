// PURPOSE: Live-сверка expense Ozon Performance API vs БД vs CPC+CPO breakdown.
//
// Запуск:
//   pnpm tsx scripts/debug-ozon-expense.ts <accountId> --from 2026-04-20 --to 2026-05-20
//
// Сравнивает:
//   - JSON /statistics/expense/json (с CSV validation внутри getExpenseDaily)
//   - SUM(ozon_perf_expense_daily)
//   - SUM(ozon_perf_sku_stats) + SUM(ozon_perf_cpo_daily)

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../src/lib/db/client';
import {
  marketplaceAccounts,
  ozonPerfExpenseDaily,
  ozonPerfSkuStats,
  ozonPerfCpoDaily,
} from '../src/lib/db/schema/marketplaces';
import { decryptAccountPerfSecret } from '../src/lib/marketplaces/queries';
import { OzonPerformanceClient } from '../src/lib/marketplaces/ozon/performance/client';
import {
  getExpenseDaily,
  sumExpenseRows,
} from '../src/lib/marketplaces/ozon/performance/endpoints';
import { shiftIsoDate } from '../src/lib/marketplaces/ozon/sync/perf-period';

function parseArgs() {
  const accountId = process.argv[2];
  let from = process.argv[4];
  let to = process.argv[6];
  if (process.argv[3] !== '--from' || process.argv[5] !== '--to') {
    console.error(
      'Usage: pnpm tsx scripts/debug-ozon-expense.ts <accountId> --from YYYY-MM-DD --to YYYY-MM-DD',
    );
    process.exit(2);
  }
  if (!accountId || !from || !to) {
    console.error('accountId, --from and --to are required');
    process.exit(2);
  }
  from = from.slice(0, 10);
  to = to.slice(0, 10);
  const toExclusive = shiftIsoDate(to, 1);
  return { accountId, from, to, toExclusive };
}

async function main() {
  const { accountId, from, to, toExclusive } = parseArgs();

  const accountRows = await db
    .select()
    .from(marketplaceAccounts)
    .where(eq(marketplaceAccounts.id, accountId))
    .limit(1);
  const account = accountRows[0];
  if (!account?.perfClientId) {
    console.error('Account not found or Performance API not connected.');
    process.exit(2);
  }

  const perfSecret = decryptAccountPerfSecret(account);
  if (!perfSecret) {
    console.error('Cannot decrypt perf secret.');
    process.exit(2);
  }

  const client = new OzonPerformanceClient({
    accountId: account.id,
    clientId: account.perfClientId,
    clientSecret: perfSecret,
  });

  console.log(`\n=== Ozon Expense Debug ===`);
  console.log(`Account: ${accountId}`);
  console.log(`Period:  ${from} … ${to} (MSC, inclusive)`);
  console.log(`SQL:     date >= ${from} AND date < ${toExclusive}\n`);

  const liveRows = await getExpenseDaily(client, { dateFrom: from, dateTo: to });
  const liveSum = sumExpenseRows(liveRows);
  console.log(`Live API (getExpenseDaily): ${Math.round(liveSum).toLocaleString('ru-RU')} ₽ (${liveRows.length} rows)`);

  type SumRow = { v: string | number };
  const [expDbResult, cpcDbResult, cpoDbResult] = await Promise.all([
    db.execute<SumRow>(sql`
      SELECT COALESCE(SUM(total_spent_kopecks), 0)::bigint AS v
      FROM ${ozonPerfExpenseDaily}
      WHERE tenant_id = ${account.tenantId}
        AND account_id = ${accountId}
        AND date >= ${from}::date AND date < ${toExclusive}::date
    `),
    db.execute<SumRow>(sql`
      SELECT COALESCE(SUM(expense_kopecks), 0)::bigint AS v
      FROM ${ozonPerfSkuStats}
      WHERE tenant_id = ${account.tenantId}
        AND account_id = ${accountId}
        AND date >= ${from}::date AND date < ${toExclusive}::date
    `),
    db.execute<SumRow>(sql`
      SELECT COALESCE(SUM(expense_kopecks), 0)::bigint AS v
      FROM ${ozonPerfCpoDaily}
      WHERE tenant_id = ${account.tenantId}
        AND account_id = ${accountId}
        AND date >= ${from}::date AND date < ${toExclusive}::date
    `),
  ]);

  const row = (r: unknown) =>
    (Array.isArray(r) ? r[0] : ((r as { rows: SumRow[] }).rows?.[0])) as SumRow | undefined;

  const expenseDbRub = Number(row(expDbResult)?.v ?? 0) / 100;
  const cpcDbRub = Number(row(cpcDbResult)?.v ?? 0) / 100;
  const cpoDbRub = Number(row(cpoDbResult)?.v ?? 0) / 100;

  console.log(`DB expense_daily:         ${Math.round(expenseDbRub).toLocaleString('ru-RU')} ₽`);
  console.log(`DB CPC (sku_stats):       ${Math.round(cpcDbRub).toLocaleString('ru-RU')} ₽`);
  console.log(`DB CPO (cpo_daily):       ${Math.round(cpoDbRub).toLocaleString('ru-RU')} ₽`);
  console.log(`DB CPC+CPO:               ${Math.round(cpcDbRub + cpoDbRub).toLocaleString('ru-RU')} ₽`);

  if (liveSum > 0 && expenseDbRub > 0) {
    const gap = ((liveSum - expenseDbRub) / liveSum) * 100;
    console.log(`\nLive vs DB expense gap:   ${gap.toFixed(1)}%`);
  }

  const byType = new Map<string, number>();
  for (const r of liveRows) {
    const t = r.advObjectType ?? 'null';
    byType.set(t, (byType.get(t) ?? 0) + r.totalSpentRub);
  }
  if (byType.size > 0) {
    console.log('\nLive breakdown by advObjectType:');
    for (const [t, v] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${t}: ${Math.round(v).toLocaleString('ru-RU')} ₽`);
    }
  }

  console.log('\n→ Сверьте Live API с Ozon LK → Реклама → Расход за тот же период.');
  console.log('→ После fix: Settings → Sync → perfExpenseDaily + perfCpoDaily + perfSkuStats\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
