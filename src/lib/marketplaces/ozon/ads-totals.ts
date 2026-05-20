// PURPOSE: Единая агрегация рекламных расходов Ozon для KPI / timeseries /
// analytics / block queries. Один источник правды для adsRub и adsSource.

import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import {
  ozonTransactions,
  ozonPerfSkuStats,
  ozonPerfCpoDaily,
  ozonPerfExpenseDaily,
} from '@/lib/db/schema/marketplaces';
import type { OzonQueryPeriod } from '@/lib/marketplaces/ozon/query-period';

export type OzonAdsSource =
  | 'expense'
  | 'performance'
  | 'transactions-heuristic'
  | 'none';

export type OzonAdsBreakdown = {
  expenseRub: number;
  cpcRub: number;
  cpoRub: number;
  moneyRub: number;
  bonusRub: number;
};

export type OzonAdsTotals = {
  adsRub: number;
  adsSource: OzonAdsSource;
  breakdown: OzonAdsBreakdown;
  byDay: Array<{ date: string; adsRub: number }>;
  /** Расход по advObjectType из expense_daily (informational). */
  expenseByAdvType: Array<{ advObjectType: string | null; adsRub: number }>;
  /**
   * |expense - (cpc+cpo)| / expense * 100 когда expense > 0.
   * >5% → показываем reconciliation warning в UI.
   */
  reconciliationGapPct: number | null;
};

const ADS_FILTER_SQL = sql`(
  lower(operation_type) LIKE '%promot%'
  OR lower(operation_type) LIKE '%advertis%'
  OR lower(operation_type) LIKE '%marketing%'
)`;

function accountCond(column: SQL, accountId: string | null): SQL {
  return accountId ? sql`AND ${column} = ${accountId}` : sql``;
}

type SumRow = { v: string | number };
type DayRow = { day: string; v: string | number };
type AdvTypeRow = { adv_object_type: string | null; v: string | number };

function rows<T>(result: unknown): T[] {
  return Array.isArray(result)
    ? (result as T[])
    : (((result as unknown) as { rows: T[] }).rows ?? []);
}

/**
 * Агрегирует рекламный расход за MSC-период.
 * Primary: expense_daily (sum > 0). Fallback: CPC+CPO. Tertiary: transactions.
 */
export async function getOzonAdsTotals(args: {
  tenantId: string;
  accountId: string | null;
  fromDate: string;
  toDateExclusive: string;
}): Promise<OzonAdsTotals> {
  const { tenantId, accountId, fromDate, toDateExclusive } = args;

  const expenseSumResult = await db.execute<SumRow>(sql`
    SELECT COALESCE(SUM(ex.total_spent_kopecks), 0)::bigint AS v
    FROM ${ozonPerfExpenseDaily} ex
    WHERE ex.tenant_id = ${tenantId}
      ${accountCond(sql`ex.account_id`, accountId)}
      AND ex.date >= ${fromDate}::date
      AND ex.date < ${toDateExclusive}::date
  `);
  const expenseTotalKopecks = Number(rows<SumRow>(expenseSumResult)[0]?.v ?? 0);

  const expenseMoneyResult = await db.execute<SumRow>(sql`
    SELECT COALESCE(SUM(ex.money_spent_kopecks), 0)::bigint AS v
    FROM ${ozonPerfExpenseDaily} ex
    WHERE ex.tenant_id = ${tenantId}
      ${accountCond(sql`ex.account_id`, accountId)}
      AND ex.date >= ${fromDate}::date
      AND ex.date < ${toDateExclusive}::date
  `);
  const expenseBonusResult = await db.execute<SumRow>(sql`
    SELECT COALESCE(SUM(ex.bonus_spent_kopecks), 0)::bigint AS v
    FROM ${ozonPerfExpenseDaily} ex
    WHERE ex.tenant_id = ${tenantId}
      ${accountCond(sql`ex.account_id`, accountId)}
      AND ex.date >= ${fromDate}::date
      AND ex.date < ${toDateExclusive}::date
  `);
  const moneyKopecks = Number(rows<SumRow>(expenseMoneyResult)[0]?.v ?? 0);
  const bonusKopecks = Number(rows<SumRow>(expenseBonusResult)[0]?.v ?? 0);

  const cpcResult = await db.execute<SumRow>(sql`
    SELECT COALESCE(SUM(ps.expense_kopecks), 0)::bigint AS v
    FROM ${ozonPerfSkuStats} ps
    WHERE ps.tenant_id = ${tenantId}
      ${accountCond(sql`ps.account_id`, accountId)}
      AND ps.date >= ${fromDate}::date
      AND ps.date < ${toDateExclusive}::date
  `);
  const cpcKopecks = Number(rows<SumRow>(cpcResult)[0]?.v ?? 0);

  const cpoResult = await db.execute<SumRow>(sql`
    SELECT COALESCE(SUM(cd.expense_kopecks), 0)::bigint AS v
    FROM ${ozonPerfCpoDaily} cd
    WHERE cd.tenant_id = ${tenantId}
      ${accountCond(sql`cd.account_id`, accountId)}
      AND cd.date >= ${fromDate}::date
      AND cd.date < ${toDateExclusive}::date
  `);
  const cpoKopecks = Number(rows<SumRow>(cpoResult)[0]?.v ?? 0);

  const breakdown: OzonAdsBreakdown = {
    expenseRub: expenseTotalKopecks / 100,
    cpcRub: cpcKopecks / 100,
    cpoRub: cpoKopecks / 100,
    moneyRub: moneyKopecks / 100,
    bonusRub: bonusKopecks / 100,
  };

  const perfTotalKopecks = cpcKopecks + cpoKopecks;
  let adsSource: OzonAdsSource = 'none';
  let adsKopecks = 0;

  if (expenseTotalKopecks > 0) {
    adsSource = 'expense';
    adsKopecks = expenseTotalKopecks;
  } else if (perfTotalKopecks > 0) {
    adsSource = 'performance';
    adsKopecks = perfTotalKopecks;
  } else {
    const txResult = await db.execute<SumRow>(sql`
      SELECT COALESCE(SUM(ABS(tx.amount_kopecks)), 0)::bigint AS v
      FROM ${ozonTransactions} tx
      WHERE tx.tenant_id = ${tenantId}
        ${accountCond(sql`tx.account_id`, accountId)}
        AND tx.operation_date >= ${fromDate}::timestamp
        AND tx.operation_date < ${toDateExclusive}::timestamp
        AND ${ADS_FILTER_SQL}
    `);
    const txKopecks = Number(rows<SumRow>(txResult)[0]?.v ?? 0);
    if (txKopecks > 0) {
      adsSource = 'transactions-heuristic';
      adsKopecks = txKopecks;
    }
  }

  let byDay: Array<{ date: string; adsRub: number }> = [];

  if (adsSource === 'expense') {
    const dayResult = await db.execute<DayRow>(sql`
      SELECT to_char(ex.date, 'YYYY-MM-DD') AS day,
             COALESCE(SUM(ex.total_spent_kopecks), 0)::bigint AS v
      FROM ${ozonPerfExpenseDaily} ex
      WHERE ex.tenant_id = ${tenantId}
        ${accountCond(sql`ex.account_id`, accountId)}
        AND ex.date >= ${fromDate}::date
        AND ex.date < ${toDateExclusive}::date
      GROUP BY ex.date
      ORDER BY ex.date
    `);
    byDay = rows<DayRow>(dayResult).map((r) => ({
      date: r.day,
      adsRub: Number(r.v) / 100,
    }));
  } else if (adsSource === 'performance') {
    const dayResult = await db.execute<DayRow>(sql`
      WITH cpc_daily AS (
        SELECT ps.date AS day, SUM(ps.expense_kopecks) AS kopecks
        FROM ${ozonPerfSkuStats} ps
        WHERE ps.tenant_id = ${tenantId}
          ${accountCond(sql`ps.account_id`, accountId)}
          AND ps.date >= ${fromDate}::date
          AND ps.date < ${toDateExclusive}::date
        GROUP BY ps.date
      ),
      cpo_daily AS (
        SELECT cd.date AS day, SUM(cd.expense_kopecks) AS kopecks
        FROM ${ozonPerfCpoDaily} cd
        WHERE cd.tenant_id = ${tenantId}
          ${accountCond(sql`cd.account_id`, accountId)}
          AND cd.date >= ${fromDate}::date
          AND cd.date < ${toDateExclusive}::date
        GROUP BY cd.date
      ),
      combined AS (
        SELECT day, kopecks FROM cpc_daily
        UNION ALL
        SELECT day, kopecks FROM cpo_daily
      )
      SELECT to_char(day, 'YYYY-MM-DD') AS day, COALESCE(SUM(kopecks), 0)::bigint AS v
      FROM combined
      GROUP BY day
      ORDER BY day
    `);
    byDay = rows<DayRow>(dayResult).map((r) => ({
      date: r.day,
      adsRub: Number(r.v) / 100,
    }));
  } else if (adsSource === 'transactions-heuristic') {
    const dayResult = await db.execute<DayRow>(sql`
      SELECT to_char(date_trunc('day', tx.operation_date AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(ABS(tx.amount_kopecks)), 0)::bigint AS v
      FROM ${ozonTransactions} tx
      WHERE tx.tenant_id = ${tenantId}
        ${accountCond(sql`tx.account_id`, accountId)}
        AND tx.operation_date >= ${fromDate}::timestamp
        AND tx.operation_date < ${toDateExclusive}::timestamp
        AND ${ADS_FILTER_SQL}
      GROUP BY 1
      ORDER BY 1
    `);
    byDay = rows<DayRow>(dayResult).map((r) => ({
      date: r.day,
      adsRub: Number(r.v) / 100,
    }));
  }

  const advTypeResult = await db.execute<AdvTypeRow>(sql`
    SELECT ex.adv_object_type,
           COALESCE(SUM(ex.total_spent_kopecks), 0)::bigint AS v
    FROM ${ozonPerfExpenseDaily} ex
    WHERE ex.tenant_id = ${tenantId}
      ${accountCond(sql`ex.account_id`, accountId)}
      AND ex.date >= ${fromDate}::date
      AND ex.date < ${toDateExclusive}::date
    GROUP BY ex.adv_object_type
    ORDER BY v DESC
  `);
  const expenseByAdvType = rows<AdvTypeRow>(advTypeResult).map((r) => ({
    advObjectType: r.adv_object_type,
    adsRub: Number(r.v) / 100,
  }));

  let reconciliationGapPct: number | null = null;
  if (expenseTotalKopecks > 0 && perfTotalKopecks > 0) {
    reconciliationGapPct =
      (Math.abs(expenseTotalKopecks - perfTotalKopecks) / expenseTotalKopecks) * 100;
  }

  return {
    adsRub: adsKopecks / 100,
    adsSource,
    breakdown,
    byDay,
    expenseByAdvType,
    reconciliationGapPct,
  };
}

/** Удобная обёртка для OzonQueryPeriod. */
export async function getOzonAdsTotalsForPeriod(
  tenantId: string,
  accountId: string | null,
  period: OzonQueryPeriod,
): Promise<OzonAdsTotals> {
  return getOzonAdsTotals({
    tenantId,
    accountId,
    fromDate: period.fromDate,
    toDateExclusive: period.toDateExclusive,
  });
}

export { ADS_FILTER_SQL };
