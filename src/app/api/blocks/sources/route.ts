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
import FormulaParser, { MAX_COLUMN, MAX_ROW } from 'fast-formula-parser';

type SourceField = {
  name: string;
  label: string;
  value: number | string | null;
  format?: 'money' | 'number' | 'text';
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
  'excel.cell': { label: 'Excel-ячейка', category: 'Таблицы' },
  'custom.data': { label: 'Данные', category: 'Данные' },
  'computed.sum': { label: 'Вычисление', category: 'Вычисления' },
  'cashflow.top-categories': { label: 'Топ категорий', category: 'Кэшфлоу' },
  'cashflow.transactions': { label: 'Операции', category: 'Кэшфлоу' },
  'cashflow.chart': { label: 'График', category: 'Графики' },
  'navigate.card': { label: 'Навигация', category: 'Навигация' },
  'ai.micro-agent': { label: 'AI агент', category: 'AI' },
};

function pageLabel(pageKey: string): string {
  if (PAGE_LABELS[pageKey]) return PAGE_LABELS[pageKey];
  if (pageKey.startsWith('board-')) return 'Доска';
  return pageKey;
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

function parseSheetNumber(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, '').replace(',', '.');
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function colLabel(i: number): string {
  let s = '';
  let n = i;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

function cellAddress(row: number, col: number): string {
  return `${colLabel(col)}${row + 1}`;
}

function colIndex(label: string): number {
  let n = 0;
  for (let i = 0; i < label.length; i++) {
    n = n * 26 + (label.charCodeAt(i) - 64);
  }
  return n - 1;
}

function simpleMathEval(expr: string): number | null {
  if (!/^[\d\s+\-*/().,%]+$/.test(expr)) return null;
  try {
    const normalized = expr.replace(/(\d),(\d)/g, '$1.$2');
    const result = new Function('return (' + normalized + ')')();
    return typeof result === 'number' && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

function refFieldName(ref: string): string {
  const source = ref.includes(':') ? ref.slice(ref.lastIndexOf(':') + 1) : ref;
  const dot = source.lastIndexOf('.');
  return dot >= 0 ? source.slice(dot + 1) : 'value';
}

function refIsPlainNumber(ref: string): boolean {
  const field = refFieldName(ref);
  return /^[A-Z]+\d+$/.test(field) || ['count', 'raw', 'label'].includes(field);
}

function formulaReferencesMoneyRefs(raw: string): boolean {
  const refs = raw.matchAll(/@([A-Za-z0-9_.:-]+)/g);
  for (const match of refs) {
    if (!refIsPlainNumber(match[1])) return true;
  }
  return false;
}

function formulaReferencesMoneyCells(raw: string, moneyCells: Set<string>): boolean {
  const ranges = /([A-Z]+)(\d+):([A-Z]+)(\d+)/g;
  let range: RegExpExecArray | null;
  while ((range = ranges.exec(raw)) !== null) {
    const c1 = colIndex(range[1]);
    const r1 = Number(range[2]) - 1;
    const c2 = colIndex(range[3]);
    const r2 = Number(range[4]) - 1;
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) {
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++) {
        if (moneyCells.has(cellAddress(r, c))) return true;
      }
    }
  }
  const refs = /\b([A-Z]+)(\d+)\b/g;
  let ref: RegExpExecArray | null;
  while ((ref = refs.exec(raw)) !== null) {
    if (moneyCells.has(`${ref[1]}${ref[2]}`)) return true;
  }
  return false;
}

function numericExpressionValue(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const parsed = parseSheetNumber(String(value ?? ''));
  return parsed !== null ? String(parsed) : '0';
}

function evaluateSheetFormula(
  formula: string,
  cells: string[][],
  evaluated: Map<string, number | string>,
  blockRefs: Record<string, string | number | null>,
  visiting?: Set<string>,
): number | string {
  try {
    let expr = formula;
    const blockRefPattern = /@([A-Za-z0-9_.:-]+)/g;
    let m: RegExpExecArray | null;
    while ((m = blockRefPattern.exec(formula)) !== null) {
      expr = expr.replace(m[0], numericExpressionValue(blockRefs[m[1]]));
    }

    const simple = simpleMathEval(expr);
    if (simple !== null) return simple;

    const maxRowConst = MAX_ROW ?? FormulaParser.MAX_ROW ?? 1048576;
    const maxColConst = MAX_COLUMN ?? FormulaParser.MAX_COLUMN ?? 16384;
    const parser = new FormulaParser({
      onCell: ({ row, col }: { sheet: string; row: number; col: number }) => {
        const addr = cellAddress(row - 1, col - 1);
        if (visiting?.has(addr)) return 0;
        if (evaluated.has(addr)) return Number(numericExpressionValue(evaluated.get(addr)));
        const rawValue = cells[row - 1]?.[col - 1] ?? '';
        if (rawValue.startsWith('=')) {
          const nextVisiting = new Set(visiting ?? []);
          nextVisiting.add(addr);
          const result = evaluateSheetFormula(rawValue.slice(1), cells, evaluated, blockRefs, nextVisiting);
          evaluated.set(addr, result);
          return Number(numericExpressionValue(result));
        }
        return Number(numericExpressionValue(rawValue));
      },
      onRange: (ref: { from: { row: number; col: number }; to: { row: number; col: number } }) => {
        const maxRow = ref.to.row >= maxRowConst ? cells.length : ref.to.row;
        const maxCol = ref.to.col >= maxColConst ? (cells[0]?.length ?? 0) : ref.to.col;
        const arr: number[][] = [];
        for (let row = ref.from.row; row <= maxRow; row++) {
          const innerArr: number[] = [];
          for (let col = ref.from.col; col <= maxCol; col++) {
            const addr = cellAddress(row - 1, col - 1);
            const rawValue = cells[row - 1]?.[col - 1] ?? '';
            if (rawValue.startsWith('=')) {
              if (!evaluated.has(addr)) {
                const nextVisiting = new Set(visiting ?? []);
                nextVisiting.add(addr);
                evaluated.set(addr, evaluateSheetFormula(rawValue.slice(1), cells, evaluated, blockRefs, nextVisiting));
              }
              innerArr.push(Number(numericExpressionValue(evaluated.get(addr))));
            } else {
              innerArr.push(Number(numericExpressionValue(rawValue)));
            }
          }
          arr.push(innerArr);
        }
        return arr;
      },
    });
    const result = parser.parse(expr, { row: 1, col: 1, sheet: 'Sheet1' });
    if (typeof result === 'number') return result;
    if (typeof result === 'string') return result;
    if (typeof result === 'boolean') return result ? 1 : 0;
    if (result === null || result === undefined) return 0;
    return '#ERR';
  } catch {
    const fallback = simpleMathEval(formula);
    return fallback ?? '#ERR';
  }
}

function evaluateSheetCells(block: BlockInstance): { values: Map<string, number | string>; moneyCells: Set<string> } {
  const rawCells = Array.isArray(block.config?.cells) ? block.config.cells : [];
  const cells = rawCells.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []);
  const blockRefs = typeof block.config?.blockRefs === 'object' && block.config.blockRefs !== null
    ? block.config.blockRefs as Record<string, string | number | null>
    : {};
  const values = new Map<string, number | string>();
  const moneyCells = new Set<string>();
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < (cells[r]?.length ?? 0); c++) {
      const raw = cells[r][c];
      const addr = cellAddress(r, c);
      if (!raw) continue;
      if (raw.startsWith('=')) {
        const value = evaluateSheetFormula(raw.slice(1), cells, values, blockRefs);
        values.set(addr, value);
        if (formulaReferencesMoneyRefs(raw) || formulaReferencesMoneyCells(raw, moneyCells)) moneyCells.add(addr);
      } else {
        const parsed = parseSheetNumber(raw);
        if (parsed !== null) values.set(addr, parsed);
      }
    }
  }
  return { values, moneyCells };
}

async function fieldsForBlock(block: BlockInstance, tenantId: string, monthlySummary: Awaited<ReturnType<typeof getCashflowSummary>>): Promise<SourceField[]> {
  if (block.type === 'stat.income') {
    return [
      { name: 'value', label: 'Сумма', value: monthlySummary.incomeTotal, format: 'money' },
      { name: 'count', label: 'Количество операций', value: monthlySummary.incomeCount },
    ];
  }
  if (block.type === 'stat.expense') {
    return [
      { name: 'value', label: 'Сумма', value: monthlySummary.expenseTotal, format: 'money' },
      { name: 'count', label: 'Количество операций', value: monthlySummary.expenseCount },
    ];
  }
  if (block.type === 'stat.balance') {
    return [
      { name: 'value', label: 'Баланс', value: monthlySummary.balance, format: 'money' },
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
      { name: 'value', label: metric === 'count' ? 'Количество операций' : 'Сумма', value: result.value, format: metric === 'count' ? 'number' : 'money' },
      { name: 'count', label: 'Количество операций', value: result.count },
    ];
  }
  if (block.type === 'custom.data') {
    const rows = Array.isArray(block.config?.rows) ? block.config.rows : [];
    const values = rows.map((row) => typeof row === 'object' && row !== null && 'value' in row ? Number((row as { value?: unknown }).value) : 0);
    const sum = values.filter(Number.isFinite).reduce((acc, v) => acc + v, 0);
    return [
      { name: 'value', label: 'Значение', value: sum, format: 'money' },
      { name: 'sum', label: 'Сумма', value: sum, format: 'money' },
      { name: 'count', label: 'Количество строк', value: rows.length },
    ];
  }
  if (block.type === 'sheet') {
    const evaluated = evaluateSheetCells(block);
    const nums = Array.from(evaluated.values.values())
      .map((value) => typeof value === 'number' ? value : parseSheetNumber(String(value)))
      .filter((value): value is number => value !== null);
    const sum = nums.reduce((acc, v) => acc + v, 0);
    const cellFields = Array.from(evaluated.values.entries()).map(([addr, value]) => ({
      name: addr,
      label: addr,
      value,
      format: evaluated.moneyCells.has(addr) ? 'money' as const : 'number' as const,
    }));
    return [
      { name: 'value', label: 'Сумма', value: sum, format: evaluated.moneyCells.size > 0 ? 'money' : 'number' },
      { name: 'sum', label: 'Сумма', value: sum, format: evaluated.moneyCells.size > 0 ? 'money' : 'number' },
      { name: 'count', label: 'Числовые ячейки', value: nums.length },
      ...cellFields,
    ];
  }
  if (block.type === 'excel.cell') {
    const raw = typeof block.config?.value === 'string' ? block.config.value : '';
    const value = parseSheetNumber(raw);
    return [
      { name: 'value', label: 'Значение', value },
      { name: 'raw', label: 'Формула/текст', value: raw },
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
