// PURPOSE: Серверные запросы к транзакциям и категориям (с tenant scoping)
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { transactions, categories, type Transaction } from '@/lib/db/schema/transactions';

export type ListFilters = {
  tenantId: string;
  type?: 'income' | 'expense';
  categoryId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
  offset?: number;
};

export async function listTransactions(filters: ListFilters): Promise<Transaction[]> {
  const conds = [eq(transactions.tenantId, filters.tenantId)];
  if (filters.type) conds.push(eq(transactions.type, filters.type));
  if (filters.categoryId) conds.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.from) conds.push(gte(transactions.occurredAt, filters.from));
  if (filters.to) conds.push(lte(transactions.occurredAt, filters.to));

  return db
    .select()
    .from(transactions)
    .where(and(...conds))
    .orderBy(desc(transactions.occurredAt))
    .limit(filters.limit ?? 100)
    .offset(filters.offset ?? 0);
}

export async function getCashflowSummary(tenantId: string, from?: Date, to?: Date) {
  const conds = [eq(transactions.tenantId, tenantId)];
  if (from) conds.push(gte(transactions.occurredAt, from));
  if (to) conds.push(lte(transactions.occurredAt, to));

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

export async function getTopCategories(tenantId: string, type: 'income' | 'expense', limit = 5) {
  const rows = await db
    .select({
      categoryId: transactions.categoryId,
      categoryName: categories.name,
      total: sql<number>`coalesce(sum(${transactions.amount}), 0)::bigint`,
      count: sql<number>`count(*)::int`,
    })
    .from(transactions)
    .leftJoin(categories, eq(transactions.categoryId, categories.id))
    .where(and(eq(transactions.tenantId, tenantId), eq(transactions.type, type)))
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
