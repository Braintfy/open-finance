// PURPOSE: Серверные запросы к транзакциям и категориям (с tenant scoping)
import { and, desc, eq, gte, ilike, lt, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { transactions, categories, type Transaction } from '@/lib/db/schema/transactions';

export type ListFilters = {
  tenantId: string;
  type?: 'income' | 'expense';
  categoryId?: string;
  /** Имя категории (фильтр по join с categories.name, exact match). */
  categoryName?: string;
  /** Контрагент содержит (ilike '%...%'). */
  counterparty?: string;
  source?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
  /** Cursor-based pagination: ISO timestamp последнего видимого item (occurredAt) + id. */
  cursorOccurredAt?: Date;
  cursorId?: string;
};

export async function listTransactions(filters: ListFilters): Promise<Transaction[]> {
  const conds = [eq(transactions.tenantId, filters.tenantId)];
  if (filters.type) conds.push(eq(transactions.type, filters.type));
  if (filters.categoryId) conds.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.from) conds.push(gte(transactions.occurredAt, filters.from));
  if (filters.to) conds.push(lt(transactions.occurredAt, filters.to));
  if (filters.counterparty) {
    conds.push(ilike(transactions.counterparty, `%${filters.counterparty}%`));
  }
  if (filters.source) conds.push(eq(transactions.source, filters.source));

  if (filters.cursorOccurredAt) {
    // Cursor: occurredAt < cursor OR (=cursor AND id < cursorId) — стабильная пагинация
    if (filters.cursorId) {
      conds.push(
        sql`(${transactions.occurredAt}, ${transactions.id}) < (${filters.cursorOccurredAt}, ${filters.cursorId})`,
      );
    } else {
      conds.push(lt(transactions.occurredAt, filters.cursorOccurredAt));
    }
  }

  // categoryName — join с categories
  if (filters.categoryName) {
    const rows = await db
      .select({ tx: transactions })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(and(...conds, eq(categories.name, filters.categoryName)))
      .orderBy(desc(transactions.occurredAt), desc(transactions.id))
      .limit(filters.limit ?? 100)
      .offset(filters.offset ?? 0);
    return rows.map((r) => r.tx);
  }

  return db
    .select()
    .from(transactions)
    .where(and(...conds))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(filters.limit ?? 100)
    .offset(filters.offset ?? 0);
}

/**
 * Расширенный variant с join'ом category name — для UI с category badge.
 */
export async function listTransactionsWithCategory(
  filters: ListFilters,
): Promise<Array<Transaction & { categoryName: string | null }>> {
  const conds = [eq(transactions.tenantId, filters.tenantId)];
  if (filters.type) conds.push(eq(transactions.type, filters.type));
  if (filters.categoryId) conds.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.from) conds.push(gte(transactions.occurredAt, filters.from));
  if (filters.to) conds.push(lt(transactions.occurredAt, filters.to));
  if (filters.counterparty) {
    conds.push(ilike(transactions.counterparty, `%${filters.counterparty}%`));
  }
  if (filters.source) conds.push(eq(transactions.source, filters.source));
  if (filters.categoryName) {
    conds.push(eq(categories.name, filters.categoryName));
  }
  if (filters.cursorOccurredAt) {
    if (filters.cursorId) {
      conds.push(
        sql`(${transactions.occurredAt}, ${transactions.id}) < (${filters.cursorOccurredAt}, ${filters.cursorId})`,
      );
    } else {
      conds.push(lt(transactions.occurredAt, filters.cursorOccurredAt));
    }
  }

  const rows = await db
    .select({
      tx: transactions,
      categoryName: categories.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(...conds))
    .orderBy(desc(transactions.occurredAt), desc(transactions.id))
    .limit(filters.limit ?? 100)
    .offset(filters.offset ?? 0);
  return rows.map((r) => ({ ...r.tx, categoryName: r.categoryName ?? null }));
}

export async function getCashflowSummary(
  tenantId: string,
  from?: Date,
  to?: Date,
  options: { source?: string } = {},
) {
  const conds = [eq(transactions.tenantId, tenantId)];
  if (from) conds.push(gte(transactions.occurredAt, from));
  if (to) conds.push(lt(transactions.occurredAt, to));
  if (options.source) conds.push(eq(transactions.source, options.source));

  const rows = await db
    .select({
      type: transactions.type,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .where(and(...conds))
    .groupBy(transactions.type);

  const income = rows.find((r) => r.type === 'income');
  const expense = rows.find((r) => r.type === 'expense');
  const incomeTotal = Number(income?.total ?? 0);
  const expenseTotal = Number(expense?.total ?? 0);

  return {
    incomeTotal,
    expenseTotal,
    balance: incomeTotal - expenseTotal,
    incomeCount: income?.count ?? 0,
    expenseCount: expense?.count ?? 0,
  };
}

export async function getTopCategories(
  tenantId: string,
  type: 'income' | 'expense',
  limit = 5,
  options: { from?: Date; to?: Date; source?: string } = {},
) {
  const conds = [eq(transactions.tenantId, tenantId), eq(transactions.type, type)];
  if (options.from) conds.push(gte(transactions.occurredAt, options.from));
  if (options.to) conds.push(lt(transactions.occurredAt, options.to));
  if (options.source) conds.push(eq(transactions.source, options.source));

  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(...conds))
    .groupBy(transactions.categoryId, categories.name)
    .orderBy(sql`sum(${transactions.amount}) desc`)
    .limit(limit);

  return rows.map((r) => ({
    categoryId: r.categoryId,
    categoryName: r.categoryName ?? 'Без категории',
    total: Number(r.total),
    count: r.count,
  }));
}

// ============================================================================
// KPI с trend + sparkline
// ============================================================================

export type CashflowKpiMetric = 'income' | 'expense' | 'balance';

export type CashflowKpiResult = {
  /** Текущий период (копейки). */
  current: number;
  /** Предыдущий период такой же длины (копейки). */
  previous: number;
  /** Кол-во транзакций в текущем периоде. */
  count: number;
  /** Кол-во транзакций в предыдущем. */
  prevCount: number;
  /** Дельта в % (current vs previous). null если previous=0. */
  deltaPct: number | null;
  /** Daily sparkline: [{date: 'YYYY-MM-DD', value: kopecks}]. */
  byDay: Array<{ date: string; value: number }>;
};

/**
 * Единый KPI endpoint: текущий период + предыдущий той же длины + sparkline.
 *
 * Делает 2 запроса: GROUP BY type (current vs previous) + GROUP BY date (sparkline).
 */
export async function getCashflowKpi(opts: {
  tenantId: string;
  metric: CashflowKpiMetric;
  from: Date;
  to: Date;
  /** Опц. фильтр контрагент содержит. */
  counterparty?: string;
  /** Опц. exact source filter. */
  source?: string;
  /** Опц. фильтр имя категории (exact). */
  categoryName?: string;
}): Promise<CashflowKpiResult> {
  const { tenantId, metric, from, to, counterparty, source, categoryName } = opts;
  const lengthMs = to.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - lengthMs);
  const prevTo = from;

  function baseConds(periodFrom: Date, periodTo: Date) {
    const conds = [
      eq(transactions.tenantId, tenantId),
      gte(transactions.occurredAt, periodFrom),
      lt(transactions.occurredAt, periodTo),
    ];
    if (counterparty) conds.push(ilike(transactions.counterparty, `%${counterparty}%`));
    if (source) conds.push(eq(transactions.source, source));
    if (metric === 'income' || metric === 'expense') {
      conds.push(eq(transactions.type, metric));
    }
    return conds;
  }

  async function totals(periodFrom: Date, periodTo: Date) {
    const conds = baseConds(periodFrom, periodTo);
    if (categoryName) {
      const rows = await db
        .select({
          type: transactions.type,
          total: sql<number>`coalesce(sum(${transactions.amount}), 0)::bigint`,
          count: sql<number>`count(*)::int`,
        })
        .from(transactions)
        .leftJoin(categories, eq(transactions.categoryId, categories.id))
        .where(and(...conds, eq(categories.name, categoryName)))
        .groupBy(transactions.type);
      return rows;
    }
    return db
      .select({
        type: transactions.type,
        total: sql<number>`coalesce(sum(${transactions.amount}), 0)::bigint`,
        count: sql<number>`count(*)::int`,
      })
      .from(transactions)
      .where(and(...conds))
      .groupBy(transactions.type);
  }

  function computeValue(rows: { type: string; total: number; count: number }[]) {
    const income = rows.find((r) => r.type === 'income');
    const expense = rows.find((r) => r.type === 'expense');
    const inc = Number(income?.total ?? 0);
    const exp = Number(expense?.total ?? 0);
    const cnt = (income?.count ?? 0) + (expense?.count ?? 0);
    if (metric === 'income') return { value: inc, count: income?.count ?? 0 };
    if (metric === 'expense') return { value: exp, count: expense?.count ?? 0 };
    return { value: inc - exp, count: cnt };
  }

  const [currRows, prevRows] = await Promise.all([
    totals(from, to),
    totals(prevFrom, prevTo),
  ]);
  const curr = computeValue(currRows);
  const prev = computeValue(prevRows);

  // Sparkline (current period only): GROUP BY day, sum по metric.
  const dayConds = baseConds(from, to);
  let dayRows: Array<{ d: string; value: number }>;
  if (categoryName) {
    dayRows = await db
      .select({
        d: sql<string>`to_char(${transactions.occurredAt} at time zone 'Europe/Moscow', 'YYYY-MM-DD')`,
        value:
          metric === 'balance'
            ? sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else -${transactions.amount} end), 0)::bigint`
            : sql<number>`coalesce(sum(${transactions.amount}), 0)::bigint`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(and(...dayConds, eq(categories.name, categoryName)))
      .groupBy(sql`to_char(${transactions.occurredAt} at time zone 'Europe/Moscow', 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${transactions.occurredAt} at time zone 'Europe/Moscow', 'YYYY-MM-DD')`);
  } else {
    dayRows = await db
      .select({
        d: sql<string>`to_char(${transactions.occurredAt} at time zone 'Europe/Moscow', 'YYYY-MM-DD')`,
        value:
          metric === 'balance'
            ? sql<number>`coalesce(sum(case when ${transactions.type} = 'income' then ${transactions.amount} else -${transactions.amount} end), 0)::bigint`
            : sql<number>`coalesce(sum(${transactions.amount}), 0)::bigint`,
      })
      .from(transactions)
      .where(and(...dayConds))
      .groupBy(sql`to_char(${transactions.occurredAt} at time zone 'Europe/Moscow', 'YYYY-MM-DD')`)
      .orderBy(sql`to_char(${transactions.occurredAt} at time zone 'Europe/Moscow', 'YYYY-MM-DD')`);
  }

  const byDay = dayRows.map((r) => ({ date: r.d, value: Number(r.value) }));
  const deltaPct =
    prev.value !== 0 ? ((curr.value - prev.value) / Math.abs(prev.value)) * 100 : null;

  return {
    current: curr.value,
    previous: prev.value,
    count: curr.count,
    prevCount: prev.count,
    deltaPct,
    byDay,
  };
}

// ============================================================================
// Chart data: aggregate by day/week/month for chart.cashflow
// ============================================================================

export type CashflowChartPoint = {
  date: string;
  income: number;
  expense: number;
  balance: number;
};

export async function getCashflowChart(opts: {
  tenantId: string;
  from: Date;
  to: Date;
  granularity: 'day' | 'week' | 'month';
  source?: string;
  /**
   * Source binding: фильтр по контрагенту (substring match, как в KPI).
   */
  counterparty?: string;
  /**
   * Source binding: фильтр по названию категории (substring match).
   */
  categoryName?: string;
}): Promise<CashflowChartPoint[]> {
  const { tenantId, from, to, granularity, source, counterparty, categoryName } = opts;
  const truncFn =
    granularity === 'month'
      ? sql`to_char(date_trunc('month', ${transactions.occurredAt} at time zone 'Europe/Moscow'), 'YYYY-MM')`
      : granularity === 'week'
        ? sql`to_char(date_trunc('week', ${transactions.occurredAt} at time zone 'Europe/Moscow'), 'YYYY-MM-DD')`
        : sql`to_char(${transactions.occurredAt} at time zone 'Europe/Moscow', 'YYYY-MM-DD')`;

  const conds = [
    eq(transactions.tenantId, tenantId),
    gte(transactions.occurredAt, from),
    lt(transactions.occurredAt, to),
  ];
  if (source) conds.push(eq(transactions.source, source));
  if (counterparty) conds.push(ilike(transactions.counterparty, `%${counterparty}%`));

  let rows: Array<{ bucket: string; type: string; total: number }>;
  if (categoryName) {
    rows = await db
      .select({
        bucket: sql<string>`${truncFn}`,
        type: transactions.type,
        total: sql<number>`coalesce(sum(${transactions.amount}), 0)::bigint`,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .where(and(...conds, eq(categories.name, categoryName)))
      .groupBy(sql`${truncFn}`, transactions.type)
      .orderBy(sql`${truncFn}`);
  } else {
    rows = await db
      .select({
        bucket: sql<string>`${truncFn}`,
        type: transactions.type,
        total: sql<number>`coalesce(sum(${transactions.amount}), 0)::bigint`,
      })
      .from(transactions)
      .where(and(...conds))
      .groupBy(sql`${truncFn}`, transactions.type)
      .orderBy(sql`${truncFn}`);
  }

  const map = new Map<string, { income: number; expense: number }>();
  rows.forEach((r) => {
    const cur = map.get(r.bucket) ?? { income: 0, expense: 0 };
    if (r.type === 'income') cur.income = Number(r.total);
    if (r.type === 'expense') cur.expense = Number(r.total);
    map.set(r.bucket, cur);
  });
  const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  let runningBalance = 0;
  return sorted.map(([date, v]) => {
    runningBalance += v.income - v.expense;
    return {
      date,
      income: v.income,
      expense: v.expense,
      balance: runningBalance,
    };
  });
}

export async function listCategories(tenantId: string) {
  return db
    .select()
    .from(categories)
    .where(eq(categories.tenantId, tenantId))
    .orderBy(categories.name);
}

export async function ensureDefaultCategories(tenantId: string) {
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.tenantId, tenantId))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(categories).values([
    // Доходы
    { tenantId, name: 'Продажи маркетплейс', type: 'income', icon: '🏷️' },
    { tenantId, name: 'Услуги / гонорары', type: 'income', icon: '💼' },
    { tenantId, name: 'Возвраты', type: 'income', icon: '↩️' },
    { tenantId, name: 'Прочие доходы', type: 'income', icon: '💰' },
    // Расходы
    { tenantId, name: 'Закупка товара', type: 'expense', icon: '📦' },
    { tenantId, name: 'Реклама', type: 'expense', icon: '📣' },
    { tenantId, name: 'Логистика', type: 'expense', icon: '🚚' },
    { tenantId, name: 'Налоги и сборы', type: 'expense', icon: '🏛️' },
    { tenantId, name: 'Зарплата / подряд', type: 'expense', icon: '👥' },
    { tenantId, name: 'Сервисы и подписки', type: 'expense', icon: '💳' },
    { tenantId, name: 'Аренда', type: 'expense', icon: '🏢' },
    { tenantId, name: 'Прочие расходы', type: 'expense', icon: '🧾' },
  ]);
}
