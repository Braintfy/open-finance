// PURPOSE: GET /api/blocks/sources — каталог доступных источников для cross-block формул.
import { NextResponse } from 'next/server';
import { and, eq, gte, ilike, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { blockLayouts } from '@/lib/db/schema/block-layouts';
import { transactions } from '@/lib/db/schema/transactions';
import { loadLayout } from '@/lib/blocks/queries';
import { getCashflowSummary } from '@/lib/cashflow/queries';
import type { BlockInstance } from '@/lib/blocks/types';

type SourceField = {
  name: string;
  label: string;
  value: number | string | null;
};

type SourceBlock = {
  blockId: string;
  pageKey: string;
  pageLabel: string;
  type: string;
  typeLabel: string;
  category: string;
  label: string;
  fields: SourceField[];
};

const DEFAULT_PAGE_KEYS = ['dashboard', 'cashflow'];

const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Главная',
  cashflow: 'Кэшфлоу',
  inbox: 'Inbox',
  deadlines: 'Дедлайны',
  taxes: 'Налоги',
  settings: 'Настройки',
};

const TYPE_LABELS: Record<string, { label: string; category: string }> = {
  'stat.income': { label: 'Доходы', category: 'KPI' },
  'stat.expense': { label: 'Списания', category: 'KPI' },
  'stat.balance': { label: 'Баланс', category: 'KPI' },
  'stat.custom': { label: 'Кастомный KPI', category: 'KPI' },
  sheet: { label: 'Таблица', category: 'Таблицы' },
  'custom.data': { label: 'Данные', category: 'Данные' },
  'computed.sum': { label: 'Вычисление', category: 'Вычисления' },
  'cashflow.top-categories': { label: 'Топ категорий', category: 'Кэшфлоу' },
  'cashflow.transactions': { label: 'Операции', category: 'Кэшфлоу' },
  'cashflow.chart': { label: 'График', category: 'Графики' },
  'navigate.card': { label: 'Навигация', category: 'Навигация' },
  'ai.micro-agent': { label: 'AI агент', category: 'AI' },
};

function pageLabel(pageKey: string): string {
  return PAGE_LABELS[pageKey] ?? pageKey;
}

function typeMeta(type: string): { label: string; category: string } {
  return TYPE_LABELS[type] ?? { label: type, category: 'Другое' };
}

function titleOf(block: BlockInstance): string {
  const cfg = block.config ?? {};
  return String(block.appearance?.title ?? cfg.title ?? typeMeta(block.type).label);
}

function periodStart(period: string | undefined): Date | undefined {
  if (!period || period === 'all_time') return undefined;
  const now = new Date();
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1);
  if (period === 'quarter') return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  if (period === 'year') return new Date(now.getFullYear(), 0, 1);
  return undefined;
}

async function aggregateCashflow(args: {
  tenantId: string;
  metric: 'income' | 'expense' | 'balance' | 'count';
  period?: string;
  counterparty?: string;
  source?: string;
}): Promise<{ value: number; count: number }> {
  const conds = [eq(transactions.tenantId, args.tenantId)];
  const from = periodStart(args.period);
  if (from) conds.push(gte(transactions.occurredAt, from));
  if (args.counterparty) conds.push(ilike(transactions.counterparty, `%${args.counterparty}%`));
  if (args.source) conds.push(eq(transactions.source, args.source));
  if (args.metric === 'income' || args.metric === 'expense') conds.push(eq(transactions.type, args.metric));

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
  const totalCount = (income?.count ?? 0) + (expense?.count ?? 0);

  if (args.metric === 'income') return { value: incomeTotal, count: income?.count ?? 0 };
  if (args.metric === 'expense') return { value: expenseTotal, count: expense?.count ?? 0 };
  if (args.metric === 'balance') return { value: incomeTotal - expenseTotal, count: totalCount };
  return { value: totalCount, count: totalCount };
}

function numericCells(cells: unknown): number[] {
  if (!Array.isArray(cells)) return [];
  return cells.flatMap((row) => Array.isArray(row) ? row : []).map((v) => Number.parseFloat(String(v))).filter(Number.isFinite);
}

async function fieldsForBlock(block: BlockInstance, tenantId: string, monthlySummary: Awaited<ReturnType<typeof getCashflowSummary>>): Promise<SourceField[]> {
  if (block.type === 'stat.income') {
    return [
      { name: 'value', label: 'Сумма', value: monthlySummary.incomeTotal },
      { name: 'count', label: 'Количество операций', value: monthlySummary.incomeCount },
    ];
  }
  if (block.type === 'stat.expense') {
    return [
      { name: 'value', label: 'Сумма', value: monthlySummary.expenseTotal },
      { name: 'count', label: 'Количество операций', value: monthlySummary.expenseCount },
    ];
  }
  if (block.type === 'stat.balance') {
    return [
      { name: 'value', label: 'Баланс', value: monthlySummary.balance },
      { name: 'count', label: 'Количество операций', value: monthlySummary.incomeCount + monthlySummary.expenseCount },
    ];
  }
  if (block.type === 'stat.custom') {
    const cfg = block.config ?? {};
    const metric = ['income', 'expense', 'balance', 'count'].includes(String(cfg.metric))
      ? String(cfg.metric) as 'income' | 'expense' | 'balance' | 'count'
      : 'income';
    const result = await aggregateCashflow({
      tenantId,
      metric,
      period: typeof cfg.period === 'string' ? cfg.period : 'month',
      counterparty: typeof cfg.counterparty === 'string' ? cfg.counterparty : undefined,
      source: typeof cfg.source === 'string' ? cfg.source : undefined,
    });
    return [
      { name: 'value', label: metric === 'count' ? 'Количество операций' : 'Сумма', value: result.value },
      { name: 'count', label: 'Количество операций', value: result.count },
    ];
  }
  if (block.type === 'custom.data') {
    const rows = Array.isArray(block.config?.rows) ? block.config.rows : [];
    const values = rows.map((row) => typeof row === 'object' && row !== null && 'value' in row ? Number((row as { value?: unknown }).value) : 0);
    const sum = values.filter(Number.isFinite).reduce((acc, v) => acc + v, 0);
    return [
      { name: 'value', label: 'Значение', value: sum },
      { name: 'sum', label: 'Сумма', value: sum },
      { name: 'count', label: 'Количество строк', value: rows.length },
    ];
  }
  if (block.type === 'sheet') {
    const nums = numericCells(block.config?.cells);
    const sum = nums.reduce((acc, v) => acc + v, 0);
    return [
      { name: 'value', label: 'Сумма', value: sum },
      { name: 'sum', label: 'Сумма', value: sum },
      { name: 'count', label: 'Числовые ячейки', value: nums.length },
    ];
  }
  return [
    { name: 'value', label: 'Значение', value: null },
  ];
}

export async function GET() {
  const session = await auth();
  if (!session?.tenantId || !session.userId) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  const tenantId = session.tenantId;
  const userId = session.userId;

  const saved = await db
    .select({ pageKey: blockLayouts.pageKey })
    .from(blockLayouts)
    .where(and(eq(blockLayouts.tenantId, tenantId), eq(blockLayouts.userId, userId)));

  const pageKeys: string[] = Array.from(new Set([...DEFAULT_PAGE_KEYS, ...saved.map((r) => r.pageKey)]));
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthlySummary = await getCashflowSummary(tenantId, monthStart);

  const pages = await Promise.all(pageKeys.map(async (pageKey) => {
    const layout = await loadLayout({ tenantId, userId, pageKey });
    const blocks = await Promise.all(layout.blocks.map(async (block) => {
      const meta = typeMeta(block.type);
      const label = titleOf(block);
      const fields = await fieldsForBlock(block, tenantId, monthlySummary);
      return {
        blockId: block.id,
        pageKey,
        pageLabel: pageLabel(pageKey),
        type: block.type,
        typeLabel: meta.label,
        category: meta.category,
        label,
        fields: [
          ...fields,
          { name: 'label', label: 'Название', value: label },
        ],
      } satisfies SourceBlock;
    }));
    return { pageKey, pageLabel: pageLabel(pageKey), blocks };
  }));

  return NextResponse.json({ ok: true, pages });
}
