// PURPOSE: GET /api/blocks/sources — каталог доступных источников для cross-block формул.
import { NextResponse } from 'next/server';
import { and, eq, gte, ilike, sql } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db/client';
import { blockLayouts } from '@/lib/db/schema/block-layouts';
import { unitEconomicsTabs } from '@/lib/db/schema/unit-economics-tabs';
import { transactions } from '@/lib/db/schema/transactions';
import { loadLayout } from '@/lib/blocks/queries';
import { getCashflowSummary, getCashflowKpi } from '@/lib/cashflow/queries';
import { listInboxChannels, listInboxMessages } from '@/lib/inbox/queries';
import { getCurrencyRates } from '@/lib/currency/queries';
import type { CurrencyRate } from '@/lib/currency/types';
import type { BlockInstance } from '@/lib/blocks/types';
import { getOzonAnalyticsTotals } from '@/lib/blocks/catalog/unit-ozon-analytics-queries';
import {
  getOzonClusterStocksTotals,
  getOzonCampaignsTotals,
  getOzonSearchPhrasesTotals,
} from '@/lib/blocks/catalog/unit-ozon-cluster-queries';
import { OzonAnalyticsBlockConfigSchema } from '@/lib/blocks/catalog/unit-ozon-analytics-types';
import FormulaParser, { MAX_COLUMN, MAX_ROW } from 'fast-formula-parser';
import {
  evaluateAllCells as evaluateCustomDataCells,
  resultAsNumber as customDataResultAsNumber,
  cellAddress as customDataCellAddress,
  type FormulaEvalContext as CustomDataEvalContext,
} from '@/lib/blocks/custom-data-formulas';

type SourceField = {
  name: string;
  label: string;
  value: number | string | null;
  format?: 'money' | 'number' | 'text';
  /**
   * L2-подкатегория поля внутри блока (для модалки связей):
   * `Текущий период` / `Прошлый период` / `Δ изменения` / `Top-SKU` /
   * `Остатки` / `Итоги по магазину` / `Метаданные`. Если не задано —
   * UI кладёт в `Текущий период` (дефолт). Только Ozon-блоки группируют
   * поля; для остальных оставляем undefined.
   */
  group?: string;
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
  /**
   * L1-метка экземпляра блока (для модалки связей категории `Аналитика
   * Ozon`). Формат: `Ozon · аналитика · 7 дней (Главная)`. Включает
   * period preset → читабельный текст, чтобы пользователь не путал
   * блок «Ozon · аналитика · 7 дней» с «Ozon · аналитика · 30 дней» на
   * разных страницах.
   */
  instanceLabel: string;
};

const DEFAULT_PAGE_KEYS = [
  'dashboard',
  'cashflow',
  'inbox',
  'marketplaces-ozon-dashboard',
  'unit-economics-ozon',
  'unit-economics-ozon-multi',
  'unit-economics-yandex',
  'unit-economics-my-store',
];

const PAGE_LABELS: Record<string, string> = {
  dashboard: 'Главная',
  cashflow: 'Кэшфлоу',
  inbox: 'Входящие',
  deadlines: 'Дедлайны',
  taxes: 'Налоги',
  settings: 'Настройки',
  'marketplaces-ozon-dashboard': 'Аналитика Ozon',
  'unit-economics-ozon': 'Юнит-экономика · Ozon',
  'unit-economics-ozon-multi': 'Юнит-экономика · Ozon мульти',
  'unit-economics-yandex': 'Юнит-экономика · Яндекс',
  'unit-economics-my-store': 'Юнит-экономика · Мой магазин',
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
  'inbox.channel-feed': { label: 'Каналы входящих', category: 'Входящие' },
  'cashflow.top-categories': { label: 'Топ категорий', category: 'Кэшфлоу' },
  'cashflow.transactions': { label: 'Операции', category: 'Кэшфлоу' },
  'cashflow.chart': { label: 'График', category: 'Графики' },
  'navigate.card': { label: 'Навигация', category: 'Навигация' },
  'ai.micro-agent': { label: 'AI агент', category: 'AI' },
  'unit.ozon-calculator': { label: 'Ozon · калькулятор', category: 'Юнит-экономика' },
  'unit.ozon-multi-table': { label: 'Ozon · юнит-таблица', category: 'Юнит-экономика' },
  // Все аналитические Ozon-блоки объединены под общую категорию «Аналитика Ozon»
  // для удобной группировки/сортировки в модалке привязок.
  'unit.ozon-analytics': { label: 'Ozon · аналитика', category: 'Аналитика Ozon' },
  'unit.ozon-kpi': { label: 'Ozon · KPI', category: 'Аналитика Ozon' },
  'unit.ozon-chart': { label: 'Ozon · Динамика', category: 'Аналитика Ozon' },
  'unit.ozon-top-ads': { label: 'Ozon · Топ рекламы', category: 'Аналитика Ozon' },
  'unit.ozon-stock-clusters': { label: 'Ozon · Остатки по типу склада', category: 'Аналитика Ozon' },
  'unit.ozon-warehouse-clusters': { label: 'Ozon · Остатки по кластерам', category: 'Аналитика Ozon' },
  'unit.ozon-search-phrases': { label: 'Ozon · Поисковые фразы', category: 'Аналитика Ozon' },
  'unit.ozon-campaigns': { label: 'Ozon · Кампании', category: 'Аналитика Ozon' },
  'unit.ozon-data-health': { label: 'Ozon · Состояние данных', category: 'Аналитика Ozon' },
  'unit.ozon-abc': { label: 'Ozon · ABC-анализ', category: 'Аналитика Ozon' },
  'unit.ozon-ai-insights': { label: 'Ozon · AI инсайты', category: 'Аналитика Ozon' },
  'unit.yandex-calculator': { label: 'Яндекс · калькулятор', category: 'Юнит-экономика' },
  'unit.my-store-table': { label: 'Мой магазин · таблица', category: 'Юнит-экономика' },
  'currency.rates': { label: 'Курсы валют', category: 'Финансы' },
};

/**
 * Порядок категорий блоков в модалке привязок: аналитика впереди (это самое
 * интересное для пользователя при настройке формул), затем юнит-экономика,
 * финансы, KPI, графики/таблицы, и т.д.
 */
const CATEGORY_ORDER: readonly string[] = [
  'Аналитика Ozon',
  'Маркетплейсы',
  'Юнит-экономика',
  'Финансы',
  'KPI',
  'Графики',
  'Таблицы',
  'Данные',
  'Вычисления',
  'Кэшфлоу',
  'Входящие',
  'Навигация',
  'AI',
  'Другое',
];

function categoryRank(cat: string): number {
  const i = CATEGORY_ORDER.indexOf(cat);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

function pageLabel(pageKey: string, customLabels?: Record<string, string>): string {
  if (customLabels?.[pageKey]) return customLabels[pageKey];
  if (PAGE_LABELS[pageKey]) return PAGE_LABELS[pageKey];
  if (pageKey.startsWith('board-')) return 'Доска';
  // v0.22.0: custom unit-economics-вкладки. Если label не найден в БД —
  // fallback на "Юнит-экономика · <hash>".
  if (pageKey.startsWith('unit-economics-custom-')) {
    return `Юнит-экономика · ${pageKey.slice('unit-economics-custom-'.length)}`;
  }
  return pageKey;
}

function typeMeta(type: string): { label: string; category: string } {
  return TYPE_LABELS[type] ?? { label: type, category: 'Другое' };
}

function titleOf(block: BlockInstance): string {
  const cfg = block.config ?? {};
  return String(block.appearance?.title ?? cfg.title ?? typeMeta(block.type).label);
}

/** Pretty label для periodPreset из cfg Ozon-блока. Используется в L1. */
function periodPresetLabel(
  preset: string | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
): string | null {
  switch (preset) {
    case 'today':
      return 'Сегодня';
    case 'yesterday':
      return 'Вчера';
    case '7d':
      return '7 дней';
    case '14d':
      return '14 дней';
    case '30d':
      return '30 дней';
    case 'mtd':
      return 'Текущий месяц';
    case 'all_time':
      return 'Всё время';
    case 'custom': {
      if (!from || !to) return 'Произвольный период';
      try {
        const dFrom = new Date(from);
        const dTo = new Date(to);
        if (Number.isNaN(dFrom.getTime()) || Number.isNaN(dTo.getTime())) {
          return 'Произвольный период';
        }
        const fmt = (d: Date) =>
          d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        return `${fmt(dFrom)}–${fmt(dTo)} ${dTo.getFullYear()}`;
      } catch {
        return 'Произвольный период';
      }
    }
    default:
      return null;
  }
}

/**
 * Группа поля внутри Ozon-блока (L2 в модалке связей).
 * Эвристика по name: префиксы/суффиксы говорят о назначении поля.
 *
 * Правила (порядок важен):
 *   - `delta*`          → `Δ изменения`
 *   - `*Prev` (суффикс) → `Прошлый период`
 *   - `top1*` или avgDrr/maxDrr → `Top-SKU`
 *   - `stock*` / `*Stock*` / `reserved*` / `promised*` / `freeStock` /
 *     `totalStockValue*` → `Остатки`
 *   - `label` → `Метаданные` (служебное поле «Название»)
 *   - всё остальное → `Текущий период`
 */
function groupForOzonField(name: string): string {
  if (name.startsWith('delta')) return 'Δ изменения';
  if (/Prev$/.test(name)) return 'Прошлый период';
  if (
    name.startsWith('top1') ||
    name === 'avgDrr' ||
    name === 'maxDrr'
  ) {
    return 'Top-SKU';
  }
  if (
    /^(stock|freeStock|reservedStock|promisedStock)/.test(name) ||
    /Stock$/.test(name) ||
    name === 'totalStockValueRub' ||
    name === 'skuCount'
  ) {
    return 'Остатки';
  }
  if (name === 'label') return 'Метаданные';
  return 'Текущий период';
}

/** Назначить `group` всем полям Ozon-блока (in-place, возвращает тот же массив). */
function decorateOzonGroups(fields: SourceField[]): SourceField[] {
  for (const f of fields) {
    if (!f.group) f.group = groupForOzonField(f.name);
  }
  return fields;
}

/**
 * Строит L1-instanceLabel блока: `{typeLabel} · {periodLabel} ({pageLabel})`.
 * Для блоков без периода (например, Остатки-по-кластерам) — `{typeLabel} ({pageLabel})`.
 * Для не-Ozon блоков — просто `{label} ({pageLabel})`, чтобы UI всегда имел
 * фоллбек.
 */
function buildInstanceLabel(args: {
  type: string;
  typeLabel: string;
  label: string;
  pageLabel: string;
  config: Record<string, unknown> | undefined;
}): string {
  const cfg = args.config ?? {};
  const isOzon = args.type.startsWith('unit.ozon-');
  if (isOzon) {
    const preset = typeof cfg.periodPreset === 'string' ? cfg.periodPreset : undefined;
    const periodLabel = periodPresetLabel(
      preset,
      typeof cfg.customFrom === 'string' ? cfg.customFrom : null,
      typeof cfg.customTo === 'string' ? cfg.customTo : null,
    );
    const base = periodLabel ? `${args.typeLabel} · ${periodLabel}` : args.typeLabel;
    // Дополнительно показываем заголовок блока в скобках, чтобы
    // отличить два «Ozon · аналитика · 7 дней» на одной странице.
    const titleSuffix =
      args.label && args.label !== args.typeLabel ? ` (${args.label})` : '';
    return `${base}${titleSuffix} — ${args.pageLabel}`;
  }
  return `${args.label} — ${args.pageLabel}`;
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

function formulaReferencesMoneyRefs(raw: string, moneyRefs?: Record<string, boolean>): boolean {
  const refs = raw.matchAll(/@([A-Za-z0-9_.:-]+)/g);
  for (const match of refs) {
    const ref = match[1];
    if (moneyRefs && ref in moneyRefs) {
      if (moneyRefs[ref]) return true;
      continue;
    }
    if (!refIsPlainNumber(ref)) return true;
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
  const moneyRefs = typeof block.config?.moneyRefs === 'object' && block.config.moneyRefs !== null
    ? block.config.moneyRefs as Record<string, boolean>
    : undefined;
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
        if (formulaReferencesMoneyRefs(raw, moneyRefs) || formulaReferencesMoneyCells(raw, moneyCells)) moneyCells.add(addr);
      } else {
        const parsed = parseSheetNumber(raw);
        if (parsed !== null) values.set(addr, parsed);
      }
    }
  }
  return { values, moneyCells };
}

/**
 * v0.18.26: server-side evaluator для блока `custom.data` — использует
 * портативный formula engine из `src/lib/blocks/custom-data-formulas`.
 * Возвращает source fields для cross-block picker:
 *   - { name: 'value', value: aggregate(primaryColumn) }
 *   - { name: '<colId>', value: aggregate(col) } для каждой publish-колонки
 *   - { name: 'count', value: rows.length }
 * @blockId.field refs не резолвятся (нет live-context); они подставляются 0
 * через evaluator-fallback. Этого хватает для модалки связей — она показывает
 * фиксированные литералы. На клиенте те же поля досчитываются с live-values.
 */
function computeCustomDataFields(block: BlockInstance): SourceField[] {
  const cfg = (block.config ?? {}) as Record<string, unknown>;
  const rawColumns = Array.isArray(cfg.columns) ? cfg.columns : [];
  const rawRows = Array.isArray(cfg.rows) ? cfg.rows : [];
  const publishMode = (typeof cfg.publishMode === 'string'
    ? cfg.publishMode
    : 'sum') as 'sum' | 'avg' | 'count' | 'last';

  type Col = { id: string; label: string; format: 'rubles' | 'number' | 'percent' | 'text'; publish?: boolean };
  const columns: Col[] = rawColumns
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .map((c) => ({
      id: String(c.id ?? ''),
      label: typeof c.label === 'string' ? c.label : '',
      format: (c.format === 'number' || c.format === 'percent' || c.format === 'text'
        ? c.format
        : 'rubles') as Col['format'],
      publish: c.publish !== false,
    }))
    .filter((c) => c.id);

  type Row = { id: string; label: string; cells: Record<string, { v: number | string | null; ref?: string; isMoney?: boolean } | undefined> };
  const rows: Row[] = rawRows
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => {
      const cells: Row['cells'] = {};
      const rawCells = (r.cells ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(rawCells)) {
        if (typeof v !== 'object' || v === null) continue;
        const cv = v as Record<string, unknown>;
        cells[k] = {
          v: (typeof cv.v === 'number' || typeof cv.v === 'string' ? cv.v : null) as number | string | null,
          ref: typeof cv.ref === 'string' ? cv.ref : undefined,
          isMoney: typeof cv.isMoney === 'boolean' ? cv.isMoney : undefined,
        };
      }
      return {
        id: String(r.id ?? ''),
        label: typeof r.label === 'string' ? r.label : '',
        cells,
      };
    })
    .filter((r) => r.id);

  const ctx: CustomDataEvalContext = {
    rows: rows.map((r) => ({ id: r.id, label: r.label, cells: r.cells })),
    columns: columns.map((c) => ({ id: c.id, label: c.label, format: c.format })),
    liveValues: {},
    moneyRefs: {},
  };
  const cache = evaluateCustomDataCells(ctx);

  function aggregate(colIdx: number, mode: typeof publishMode): number {
    const nums: number[] = [];
    for (let r = 0; r < rows.length; r++) {
      const res = cache.get(customDataCellAddress(r, colIdx));
      if (!res) continue;
      const n = customDataResultAsNumber(res);
      if (n !== null) nums.push(n);
    }
    if (nums.length === 0) return 0;
    if (mode === 'sum') return nums.reduce((a, b) => a + b, 0);
    if (mode === 'avg') return nums.reduce((a, b) => a + b, 0) / nums.length;
    if (mode === 'count') return nums.length;
    if (mode === 'last') return nums[nums.length - 1];
    return 0;
  }

  const publishColIdx = columns.findIndex((c) => c.id === cfg.publishColumnId);
  const primaryIdx = publishColIdx >= 0 ? publishColIdx : columns.findIndex((c) => c.publish);
  const primaryColumn = primaryIdx >= 0 ? columns[primaryIdx] : columns[0];
  const primaryValue = primaryColumn ? aggregate(primaryIdx >= 0 ? primaryIdx : 0, publishMode) : 0;
  const primaryIsMoney = primaryColumn?.format === 'rubles';

  const fields: SourceField[] = [
    {
      name: 'value',
      label: primaryColumn?.label ? `Итог: ${primaryColumn.label}` : 'Значение',
      value: primaryValue,
      format: primaryIsMoney ? 'money' : primaryColumn?.format === 'percent' ? 'number' : 'number',
    },
    { name: 'count', label: 'Количество строк', value: rows.length, format: 'number' },
  ];
  const publishedCols: Array<{ col: (typeof columns)[0]; cIdx: number }> = [];
  for (let cIdx = 0; cIdx < columns.length; cIdx++) {
    const col = columns[cIdx];
    if (!col.publish) continue;
    const v = aggregate(cIdx, publishMode);
    fields.push({
      name: col.id,
      label: col.label || col.id,
      value: v,
      format: col.format === 'rubles' ? 'money' : col.format === 'text' ? 'text' : 'number',
    });
    publishedCols.push({ col, cIdx });
  }

  // Per-cell fields exposed with group: 'Ячейки' for collapsible section in picker.
  // Only for tables with <= 200 cells to avoid heavy payloads.
  const totalCells = rows.length * publishedCols.length;
  if (totalCells > 0 && totalCells <= 200) {
    for (let rIdx = 0; rIdx < rows.length; rIdx++) {
      const row = rows[rIdx];
      for (const { col, cIdx } of publishedCols) {
        const result = cache.get(customDataCellAddress(rIdx, cIdx));
        const n = result !== undefined ? customDataResultAsNumber(result) : null;
        fields.push({
          name: `${row.id}.${col.id}`,
          label: `${row.label} · ${col.label || col.id}`,
          value: n,
          format: col.format === 'rubles' ? 'money' : col.format === 'text' ? 'text' : 'number',
          group: 'Ячейки',
        });
      }
    }
  }

  return fields;
}

async function fieldsForBlock(
  block: BlockInstance,
  tenantId: string,
  monthlySummary: Awaited<ReturnType<typeof getCashflowSummary>>,
  currencyRatesByCode: Map<string, CurrencyRate>,
): Promise<SourceField[]> {
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
    // v0.18.26: server-side evaluator с поддержкой формул (A1 / [row].col).
    // @blockId.field refs резолвить здесь нельзя (нет live-context), но
    // литералы / cross-cell формулы / диапазоны / агрегаты считаются полно.
    return computeCustomDataFields(block);
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
  if (block.type === 'unit.ozon-calculator' || block.type === 'unit.yandex-calculator') {
    const inputs = (block.config?.inputs ?? {}) as Record<string, unknown>;
    const price = Number(inputs.price ?? inputs.sellerPrice ?? 0);
    const stock = Number(inputs.stock ?? 0);
    return [
      { name: 'value', label: 'Цена', value: Math.round(price * 100), format: 'money' },
      { name: 'price', label: 'Цена', value: Math.round(price * 100), format: 'money' },
      { name: 'stock', label: 'Остаток', value: stock, format: 'number' },
      { name: 'profitPerUnit', label: 'Прибыль / ед', value: null, format: 'money' },
      { name: 'profitPerMonth', label: 'Прибыль / мес', value: null, format: 'money' },
      { name: 'margin', label: 'Маржа', value: null, format: 'number' },
      { name: 'roi', label: 'ROI', value: null, format: 'number' },
    ];
  }
  if (block.type === 'unit.ozon-multi-table') {
    const rows = Array.isArray(block.config?.rows) ? (block.config.rows as Array<Record<string, unknown>>) : [];
    const stockTotal = rows.reduce((acc, row) => {
      const inputs = (row.inputs ?? {}) as Record<string, unknown>;
      return acc + Number(inputs.stock ?? 0);
    }, 0);
    return [
      { name: 'value', label: 'Товаров', value: rows.length, format: 'number' },
      { name: 'rowsCount', label: 'Товаров', value: rows.length, format: 'number' },
      { name: 'stockTotal', label: 'Сумма остатков', value: stockTotal, format: 'number' },
      // Live-вычисляемые на клиенте; здесь — только метки для cross-page picker.
      { name: 'totalProfitMonth', label: 'Прибыль / мес', value: null, format: 'money' },
      { name: 'totalMoneyInGoods', label: 'Деньги в товаре', value: null, format: 'money' },
      { name: 'totalStockValue', label: 'Себестоимость остатка', value: null, format: 'money' },
      { name: 'avgMargin', label: 'Средняя маржа', value: null, format: 'number' },
      { name: 'avgRoi', label: 'Средний ROI', value: null, format: 'number' },
      { name: 'profitableCount', label: 'Прибыльных', value: null, format: 'number' },
      { name: 'lossCount', label: 'Убыточных', value: null, format: 'number' },
    ];
  }
  if (block.type === 'unit.ozon-analytics') {
    // Серверный расчёт агрегатов аналитики — реальные значения для cross-block picker.
    // Синхронизировано с useBlockValuePublisher в unit-ozon-analytics.tsx.
    const cfg = OzonAnalyticsBlockConfigSchema.safeParse(block.config ?? {});
    const parsed = cfg.success ? cfg.data : OzonAnalyticsBlockConfigSchema.parse({});
    try {
      const t = await getOzonAnalyticsTotals(
        tenantId,
        parsed.accountId,
        parsed.periodPreset,
        parsed.customFrom,
        parsed.customTo,
        { includePrevious: true },
      );
      return [
        { name: 'value', label: 'Выручка / период', value: Math.round(t.revenueRub * 100), format: 'money' },
        { name: 'revenue', label: 'Выручка / период', value: Math.round(t.revenueRub * 100), format: 'money' },
        { name: 'ads', label: 'Реклама / период', value: Math.round(t.adsRub * 100), format: 'money' },
        { name: 'totalCostRub', label: 'Себестоимость проданного', value: Math.round(t.totalCostRub * 100), format: 'money' },
        { name: 'totalProfitRub', label: 'Прибыль (выручка−себест)', value: Math.round(t.totalProfitRub * 100), format: 'money' },
        { name: 'drr', label: 'ДРР %', value: t.drrPct !== null ? Math.round(t.drrPct * 10) / 10 : null, format: 'number' },
        { name: 'orders', label: 'Заказы доставлено', value: t.delivered, format: 'number' },
        { name: 'cancelled', label: 'Заказы отменено', value: t.cancelled, format: 'number' },
        { name: 'returned', label: 'Заказы возврат', value: t.returned, format: 'number' },
        { name: 'qtyDelivered', label: 'Штук доставлено', value: t.qtyDelivered, format: 'number' },
        { name: 'productsWithSales', label: 'Товары с продажами', value: t.productsWithSales, format: 'number' },
        { name: 'rowsCount', label: 'Всего товаров', value: t.rowsCount, format: 'number' },
        { name: 'stockTotal', label: 'Остатки (шт)', value: t.stockTotal, format: 'number' },
        { name: 'avgBuyoutPct', label: 'Средний выкуп %', value: t.avgBuyoutPct, format: 'number' },
        // --- Top-1 SKU метрики ---
        { name: 'top1Revenue', label: 'Выручка топ-1 SKU', value: Math.round(t.top1Revenue * 100), format: 'money' },
        { name: 'top1Article', label: 'Артикул топ-1 SKU', value: t.top1Article ?? '', format: 'text' },
        { name: 'top1Name', label: 'Название топ-1 SKU', value: t.top1Name ?? '', format: 'text' },
        { name: 'top1Drr', label: 'ДРР топ-1 SKU %', value: t.top1Drr, format: 'number' },
        { name: 'top1Ads', label: 'Реклама топ-1 SKU', value: Math.round(t.top1Ads * 100), format: 'money' },
        { name: 'avgDrr', label: 'Средний ДРР по SKU %', value: t.avgDrr, format: 'number' },
        { name: 'maxDrr', label: 'Максимальный ДРР %', value: t.maxDrr, format: 'number' },
        { name: 'totalStockValueRub', label: 'Стоимость остатков', value: Math.round(t.totalStockValueRub * 100), format: 'money' },
        // --- Previous period (для δ-бейджей) ---
        { name: 'revenuePrev', label: 'Выручка / прошлый период', value: t.revenuePrev !== null ? Math.round(t.revenuePrev * 100) : null, format: 'money' },
        { name: 'adsPrev', label: 'Реклама / прошлый период', value: t.adsPrev !== null ? Math.round(t.adsPrev * 100) : null, format: 'money' },
        { name: 'ordersPrev', label: 'Заказы / прошлый период', value: t.ordersPrev, format: 'number' },
        { name: 'deltaRevenuePct', label: 'Δ Выручка %', value: t.deltaRevenuePct, format: 'number' },
        { name: 'deltaAdsPct', label: 'Δ Реклама %', value: t.deltaAdsPct, format: 'number' },
        { name: 'deltaOrdersPct', label: 'Δ Заказы %', value: t.deltaOrdersPct, format: 'number' },
      ];
    } catch (e) {
      console.error('[blocks/sources] ozon-analytics totals failed:', e);
      return [
        { name: 'value', label: 'Выручка / период', value: null, format: 'money' },
        { name: 'revenue', label: 'Выручка / период', value: null, format: 'money' },
        { name: 'ads', label: 'Реклама / период', value: null, format: 'money' },
        { name: 'drr', label: 'ДРР %', value: null, format: 'number' },
        { name: 'orders', label: 'Заказы доставлено', value: null, format: 'number' },
        { name: 'productsWithSales', label: 'Товары с продажами', value: null, format: 'number' },
      ];
    }
  }
  if (block.type === 'unit.ozon-kpi') {
    // Сервер берёт те же агрегаты, что и Аналитика — они источник правды для
    // выручки/рекламы/заказов. KPI-блок имеет свой compare-period (для δ-бейджей)
    // и AOV/CPO, которые мы выводим из revenue/orders/ads — без отдельного SQL.
    const cfg = block.config ?? {};
    const accountId = typeof cfg.accountId === 'string' ? cfg.accountId : null;
    const periodPreset = (typeof cfg.periodPreset === 'string'
      ? cfg.periodPreset
      : '7d') as Parameters<typeof getOzonAnalyticsTotals>[2];
    const customFrom = typeof cfg.customFrom === 'string' ? cfg.customFrom : null;
    const customTo = typeof cfg.customTo === 'string' ? cfg.customTo : null;
    try {
      const t = await getOzonAnalyticsTotals(tenantId, accountId, periodPreset, customFrom, customTo, {
        includePrevious: true,
      });
      const aov = t.delivered > 0 ? Math.round((t.revenueRub / t.delivered) * 100) : null;
      const cpo = t.delivered > 0 && t.adsRub > 0
        ? Math.round((t.adsRub / t.delivered) * 100)
        : null;
      return [
        { name: 'value', label: 'Выручка / период', value: Math.round(t.revenueRub * 100), format: 'money' },
        { name: 'revenue', label: 'Выручка / период', value: Math.round(t.revenueRub * 100), format: 'money' },
        { name: 'orders', label: 'Заказы / период', value: t.delivered, format: 'number' },
        { name: 'ads', label: 'Расход на рекламу', value: Math.round(t.adsRub * 100), format: 'money' },
        { name: 'drr', label: 'ДРР %', value: t.drrPct !== null ? Math.round(t.drrPct * 10) / 10 : null, format: 'number' },
        { name: 'aov', label: 'Средний чек', value: aov, format: 'money' },
        { name: 'cpo', label: 'Средний CPO', value: cpo, format: 'money' },
        // --- Previous period (для δ-бейджей в модалке) ---
        { name: 'revenuePrev', label: 'Выручка / прошлый период', value: t.revenuePrev !== null ? Math.round(t.revenuePrev * 100) : null, format: 'money' },
        { name: 'ordersPrev', label: 'Заказы / прошлый период', value: t.ordersPrev, format: 'number' },
        { name: 'adsPrev', label: 'Реклама / прошлый период', value: t.adsPrev !== null ? Math.round(t.adsPrev * 100) : null, format: 'money' },
        { name: 'deltaRevenuePct', label: 'Δ Выручка %', value: t.deltaRevenuePct, format: 'number' },
        { name: 'deltaOrdersPct', label: 'Δ Заказы %', value: t.deltaOrdersPct, format: 'number' },
        { name: 'deltaAdsPct', label: 'Δ Реклама %', value: t.deltaAdsPct, format: 'number' },
      ];
    } catch (e) {
      console.error('[blocks/sources] ozon-kpi totals failed:', e);
      return [
        { name: 'value', label: 'Выручка / период', value: null, format: 'money' },
        { name: 'revenue', label: 'Выручка / период', value: null, format: 'money' },
        { name: 'orders', label: 'Заказы / период', value: null, format: 'number' },
        { name: 'ads', label: 'Расход на рекламу', value: null, format: 'money' },
        { name: 'drr', label: 'ДРР %', value: null, format: 'number' },
        { name: 'aov', label: 'Средний чек', value: null, format: 'money' },
        { name: 'cpo', label: 'Средний CPO', value: null, format: 'money' },
      ];
    }
  }
  if (block.type === 'unit.ozon-chart') {
    // У Dynamics-блока поля publisher: value (revenue в копейках, *100),
    // revenue/ads/orders/drr. Серверно — те же агрегаты что и аналитика.
    const cfg = block.config ?? {};
    const accountId = typeof cfg.accountId === 'string' ? cfg.accountId : null;
    const periodPreset = (typeof cfg.periodPreset === 'string'
      ? cfg.periodPreset
      : '30d') as Parameters<typeof getOzonAnalyticsTotals>[2];
    const customFrom = typeof cfg.customFrom === 'string' ? cfg.customFrom : null;
    const customTo = typeof cfg.customTo === 'string' ? cfg.customTo : null;
    try {
      const t = await getOzonAnalyticsTotals(tenantId, accountId, periodPreset, customFrom, customTo);
      return [
        { name: 'value', label: 'Выручка / период', value: Math.round(t.revenueRub * 100), format: 'money' },
        { name: 'revenue', label: 'Выручка / период', value: Math.round(t.revenueRub * 100), format: 'money' },
        { name: 'ads', label: 'Реклама / период', value: Math.round(t.adsRub * 100), format: 'money' },
        { name: 'orders', label: 'Заказы / период', value: t.delivered, format: 'number' },
        { name: 'drr', label: 'ДРР %', value: t.drrPct !== null ? Math.round(t.drrPct * 10) / 10 : null, format: 'number' },
      ];
    } catch (e) {
      console.error('[blocks/sources] ozon-chart totals failed:', e);
      return [
        { name: 'value', label: 'Выручка / период', value: null, format: 'money' },
        { name: 'revenue', label: 'Выручка / период', value: null, format: 'money' },
        { name: 'ads', label: 'Реклама / период', value: null, format: 'money' },
        { name: 'orders', label: 'Заказы / период', value: null, format: 'number' },
        { name: 'drr', label: 'ДРР %', value: null, format: 'number' },
      ];
    }
  }
  if (block.type === 'unit.ozon-top-ads') {
    // Поля синхронизированы с useBlockValuePublisher в unit-ozon-top-ads.tsx.
    return [
      { name: 'value', label: 'Расход на рекламу', value: null, format: 'money' },
      { name: 'totalExpenseRub', label: 'Расход на рекламу', value: null, format: 'money' },
      { name: 'totalOrders', label: 'Заказы', value: null, format: 'number' },
      { name: 'totalClicks', label: 'Клики', value: null, format: 'number' },
      { name: 'totalViews', label: 'Показы', value: null, format: 'number' },
      { name: 'avgDrrPct', label: 'Средний ДРР %', value: null, format: 'number' },
      { name: 'rowCount', label: 'Товаров в топе', value: null, format: 'number' },
    ];
  }
  if (block.type === 'unit.ozon-stock-clusters') {
    const cfg = block.config ?? {};
    const accountId = typeof cfg.accountId === 'string' ? cfg.accountId : null;
    try {
      const t = await getOzonClusterStocksTotals(tenantId, accountId);
      return [
        { name: 'value', label: 'Всего остатков (шт)', value: t.totalStock, format: 'number' },
        { name: 'totalStock', label: 'Всего остатков (шт)', value: t.totalStock, format: 'number' },
        { name: 'rowsCount', label: 'Типов склада', value: t.skuCount, format: 'number' },
      ];
    } catch (e) {
      console.error('[blocks/sources] ozon-stock-clusters totals failed:', e);
      return [
        { name: 'value', label: 'Всего остатков (шт)', value: null, format: 'number' },
        { name: 'totalStock', label: 'Всего остатков (шт)', value: null, format: 'number' },
        { name: 'rowsCount', label: 'Типов склада', value: null, format: 'number' },
      ];
    }
  }
  if (block.type === 'unit.ozon-warehouse-clusters') {
    const cfg = block.config ?? {};
    const accountId = typeof cfg.accountId === 'string' ? cfg.accountId : null;
    try {
      const t = await getOzonClusterStocksTotals(tenantId, accountId);
      return [
        { name: 'value', label: 'Всего остатков (шт)', value: t.totalStock, format: 'number' },
        { name: 'totalStock', label: 'Всего остатков (шт)', value: t.totalStock, format: 'number' },
        { name: 'freeStock', label: 'Свободно (шт)', value: t.freeStock, format: 'number' },
        { name: 'reservedStock', label: 'В резерве (шт)', value: t.reservedStock, format: 'number' },
        { name: 'promisedStock', label: 'Ожидается (шт)', value: t.promisedStock, format: 'number' },
        { name: 'skuCount', label: 'SKU', value: t.skuCount, format: 'number' },
        // ordersInPeriod/revenueInPeriod зависят от периода блока — в модалке
        // показываем null (значения будут от run-time publisher на клиенте).
        { name: 'ordersInPeriod', label: 'Заказов / период', value: null, format: 'number' },
        { name: 'revenueInPeriod', label: 'Выручка / период', value: null, format: 'money' },
        { name: 'clustersCount', label: 'Кластеров', value: t.clustersCount, format: 'number' },
      ];
    } catch (e) {
      console.error('[blocks/sources] ozon-warehouse-clusters totals failed:', e);
      return [
        { name: 'value', label: 'Всего остатков (шт)', value: null, format: 'number' },
        { name: 'totalStock', label: 'Всего остатков (шт)', value: null, format: 'number' },
        { name: 'freeStock', label: 'Свободно (шт)', value: null, format: 'number' },
        { name: 'reservedStock', label: 'В резерве (шт)', value: null, format: 'number' },
        { name: 'promisedStock', label: 'Ожидается (шт)', value: null, format: 'number' },
        { name: 'skuCount', label: 'SKU', value: null, format: 'number' },
        { name: 'ordersInPeriod', label: 'Заказов / период', value: null, format: 'number' },
        { name: 'revenueInPeriod', label: 'Выручка / период', value: null, format: 'money' },
        { name: 'clustersCount', label: 'Кластеров', value: null, format: 'number' },
      ];
    }
  }
  if (block.type === 'unit.ozon-search-phrases') {
    const cfg = block.config ?? {};
    const accountId = typeof cfg.accountId === 'string' ? cfg.accountId : null;
    const periodPreset = (typeof cfg.periodPreset === 'string'
      ? cfg.periodPreset
      : '30d') as Parameters<typeof getOzonSearchPhrasesTotals>[2];
    const customFrom = typeof cfg.customFrom === 'string' ? cfg.customFrom : null;
    const customTo = typeof cfg.customTo === 'string' ? cfg.customTo : null;
    try {
      const t = await getOzonSearchPhrasesTotals(tenantId, accountId, periodPreset, customFrom, customTo);
      return [
        { name: 'value', label: 'Фраз', value: t.phrasesCount, format: 'number' },
        { name: 'phrasesCount', label: 'Количество фраз', value: t.phrasesCount, format: 'number' },
        { name: 'totalExpenseRub', label: 'Расход на рекламу', value: Math.round(t.totalExpenseRub * 100), format: 'money' },
        { name: 'totalOrders', label: 'Заказы', value: t.totalOrders, format: 'number' },
        { name: 'totalClicks', label: 'Клики', value: t.totalClicks, format: 'number' },
        { name: 'totalViews', label: 'Показы', value: t.totalViews, format: 'number' },
        { name: 'avgCtrPct', label: 'Средний CTR %', value: t.avgCtrPct, format: 'number' },
      ];
    } catch (e) {
      console.error('[blocks/sources] ozon-search-phrases totals failed:', e);
      return [
        { name: 'value', label: 'Фраз', value: null, format: 'number' },
        { name: 'phrasesCount', label: 'Количество фраз', value: null, format: 'number' },
        { name: 'totalExpenseRub', label: 'Расход на рекламу', value: null, format: 'money' },
        { name: 'totalOrders', label: 'Заказы', value: null, format: 'number' },
        { name: 'totalClicks', label: 'Клики', value: null, format: 'number' },
        { name: 'totalViews', label: 'Показы', value: null, format: 'number' },
        { name: 'avgCtrPct', label: 'Средний CTR %', value: null, format: 'number' },
      ];
    }
  }
  if (block.type === 'unit.ozon-campaigns') {
    const cfg = block.config ?? {};
    const accountId = typeof cfg.accountId === 'string' ? cfg.accountId : null;
    const periodPreset = (typeof cfg.periodPreset === 'string'
      ? cfg.periodPreset
      : '30d') as Parameters<typeof getOzonCampaignsTotals>[2];
    const customFrom = typeof cfg.customFrom === 'string' ? cfg.customFrom : null;
    const customTo = typeof cfg.customTo === 'string' ? cfg.customTo : null;
    try {
      const t = await getOzonCampaignsTotals(tenantId, accountId, periodPreset, customFrom, customTo);
      return [
        { name: 'value', label: 'Кампаний', value: t.campaignsCount, format: 'number' },
        { name: 'campaignsCount', label: 'Кампаний всего', value: t.campaignsCount, format: 'number' },
        { name: 'activeCampaignsCount', label: 'Активных', value: t.activeCampaignsCount, format: 'number' },
        { name: 'totalExpenseRub', label: 'Расход на рекламу', value: Math.round(t.totalExpenseRub * 100), format: 'money' },
        { name: 'totalOrders', label: 'Заказы', value: t.totalOrders, format: 'number' },
        { name: 'totalOrdersRub', label: 'Выручка с рекламы', value: Math.round(t.totalOrdersRub * 100), format: 'money' },
        { name: 'avgDrrPct', label: 'Средний ДРР %', value: t.avgDrrPct, format: 'number' },
      ];
    } catch (e) {
      console.error('[blocks/sources] ozon-campaigns totals failed:', e);
      return [
        { name: 'value', label: 'Кампаний', value: null, format: 'number' },
        { name: 'campaignsCount', label: 'Кампаний всего', value: null, format: 'number' },
        { name: 'activeCampaignsCount', label: 'Активных', value: null, format: 'number' },
        { name: 'totalExpenseRub', label: 'Расход на рекламу', value: null, format: 'money' },
        { name: 'totalOrders', label: 'Заказы', value: null, format: 'number' },
        { name: 'totalOrdersRub', label: 'Выручка с рекламы', value: null, format: 'money' },
        { name: 'avgDrrPct', label: 'Средний ДРР %', value: null, format: 'number' },
      ];
    }
  }
  if (block.type === 'unit.ozon-data-health') {
    // Синхронизированы с useBlockValuePublisher в unit-ozon-data-health.tsx.
    return [
      { name: 'value', label: 'Seller API OK', value: null, format: 'number' },
      { name: 'sellerOk', label: 'Seller API OK', value: null, format: 'number' },
      { name: 'perfOk', label: 'Performance API OK', value: null, format: 'number' },
      { name: 'perfConnected', label: 'Performance API подключён', value: null, format: 'number' },
      { name: 'sellerHoursSinceSync', label: 'Часов с прошлого Seller sync', value: null, format: 'number' },
      { name: 'stale', label: 'Данные устарели (>24ч)', value: null, format: 'number' },
      { name: 'sellerLastSyncStatus', label: 'Статус Seller sync', value: null, format: 'text' },
      { name: 'perfStatus', label: 'Статус Performance sync', value: null, format: 'text' },
      { name: 'sellerErrorMessage', label: 'Ошибка Seller API', value: null, format: 'text' },
      { name: 'perfErrorMessage', label: 'Ошибка Performance API', value: null, format: 'text' },
    ];
  }
  if (block.type === 'unit.ozon-abc') {
    return [
      { name: 'value', label: 'Группа A (SKU)', value: null, format: 'number' },
      { name: 'aRevenue', label: 'Выручка группы A', value: null, format: 'money' },
      { name: 'bRevenue', label: 'Выручка группы B', value: null, format: 'money' },
      { name: 'cRevenue', label: 'Выручка группы C', value: null, format: 'money' },
    ];
  }
  if (block.type === 'unit.ozon-ai-insights') {
    return [
      { name: 'value', label: 'Инсайтов', value: null, format: 'number' },
      { name: 'criticalCount', label: 'Критических', value: null, format: 'number' },
    ];
  }
  if (block.type === 'unit.my-store-table') {
    const rows = Array.isArray(block.config?.rows) ? (block.config.rows as Array<Record<string, unknown>>) : [];
    const stockTotal = rows.reduce((acc, row) => {
      const values = (row.values ?? {}) as Record<string, unknown>;
      return acc + Number(values.stock ?? 0);
    }, 0);
    return [
      { name: 'value', label: 'Товаров', value: rows.length, format: 'number' },
      { name: 'rowsCount', label: 'Товаров', value: rows.length, format: 'number' },
      { name: 'stockTotal', label: 'Сумма остатков', value: stockTotal, format: 'number' },
      { name: 'totalRevenue', label: 'Выручка / мес', value: null, format: 'money' },
      { name: 'totalProfit', label: 'Прибыль / мес', value: null, format: 'money' },
      { name: 'avgMargin', label: 'Средняя маржа', value: null, format: 'number' },
    ];
  }
  if (block.type === 'currency.rates') {
    const cfg = block.config ?? {};
    const codesRaw = Array.isArray(cfg.codes) ? cfg.codes : ['USD', 'EUR', 'CNY', 'AED'];
    const codes = codesRaw
      .map((c) => (typeof c === 'string' ? c.toUpperCase() : ''))
      .filter(Boolean);
    const primaryRaw = typeof cfg.primaryCode === 'string' ? cfg.primaryCode.toUpperCase() : codes[0];
    const primaryCode = primaryRaw && codes.includes(primaryRaw) ? primaryRaw : codes[0];
    const fields: SourceField[] = [];
    const primary = primaryCode ? currencyRatesByCode.get(primaryCode) : undefined;
    fields.push({
      name: 'value',
      label: primary ? `${primary.code}/RUB` : 'Курс',
      value: primary?.rateRub ?? null,
      format: 'number',
    });
    for (const code of codes) {
      const rate = currencyRatesByCode.get(code);
      const key = code.toLowerCase();
      fields.push({
        name: key,
        label: `${code} (₽)`,
        value: rate?.rateRub ?? null,
        format: 'number',
      });
      if (rate && rate.previousRub !== null && rate.previousRub > 0) {
        const delta = ((rate.rateRub - rate.previousRub) / rate.previousRub) * 100;
        fields.push({
          name: `${key}_change`,
          label: `${code} Δ%`,
          value: Number(delta.toFixed(4)),
          format: 'number',
        });
      }
    }
    return fields;
  }
  if (block.type === 'cashflow.transactions') {
    // Источник для cashflow-консьюмеров (KPI/chart/top-categories/kpi.grid).
    // Возвращаем (а) сериализованный txFilters — это «view» блока: period +
    // type + source + counterparty + categoryName. Используется cross-page
    // bindings: консьюмер на другой странице, привязанный к этому tx-блоку,
    // читает эти фильтры и применяет к своему запросу.
    const cfg = (block.config ?? {}) as Record<string, unknown>;
    const txFilters = JSON.stringify({
      period: cfg.defaultPeriodOverride ?? null,
      type:
        cfg.defaultType === 'income' ||
        cfg.defaultType === 'expense'
          ? cfg.defaultType
          : null,
      source:
        cfg.defaultSourceOverride === undefined
          ? null
          : (cfg.defaultSourceOverride ?? null),
      counterparty:
        typeof cfg.defaultCounterparty === 'string' && cfg.defaultCounterparty
          ? cfg.defaultCounterparty
          : null,
      categoryName:
        typeof cfg.defaultCategoryName === 'string' && cfg.defaultCategoryName
          ? cfg.defaultCategoryName
          : null,
    });
    return [
      { name: 'value', label: 'txFilters (JSON)', value: txFilters, format: 'text' },
      { name: '__txFilters', label: 'txFilters (для cross-page binding)', value: txFilters, format: 'text' },
    ];
  }
  if (block.type === 'inbox.channel-feed') {
    const [channels, latest] = await Promise.all([
      listInboxChannels(tenantId, block.id),
      listInboxMessages({ tenantId, blockId: block.id, limit: 1 }),
    ]);
    const total = channels.reduce((sum, channel) => sum + channel.totalCount, 0);
    const message = latest[0];
    return [
      { name: 'value', label: 'Всего сообщений', value: total, format: 'number' },
      { name: 'count', label: 'Всего сообщений', value: total, format: 'number' },
      { name: 'latestSubject', label: 'Последняя тема', value: message?.subject ?? null, format: 'text' },
      { name: 'latestSender', label: 'Последний отправитель', value: message?.senderName ?? message?.senderAddress ?? null, format: 'text' },
      { name: 'latestPreview', label: 'Последнее превью', value: message?.preview ?? null, format: 'text' },
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

  // v0.22.0: custom unit-economics-вкладки — динамические pageKeys + labels.
  const unitTabsList = await db
    .select({
      pageKey: unitEconomicsTabs.pageKey,
      label: unitEconomicsTabs.label,
    })
    .from(unitEconomicsTabs)
    .where(
      and(eq(unitEconomicsTabs.tenantId, tenantId), eq(unitEconomicsTabs.userId, userId)),
    );
  const customLabels: Record<string, string> = {};
  for (const t of unitTabsList) {
    customLabels[t.pageKey] = t.label;
  }

  const pageKeys: string[] = Array.from(
    new Set([
      ...DEFAULT_PAGE_KEYS,
      ...unitTabsList.map((t) => t.pageKey),
      ...saved.map((r) => r.pageKey),
    ]),
  );
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [monthlySummary, currencyRatesList] = await Promise.all([
    getCashflowSummary(tenantId, monthStart),
    getCurrencyRates().catch((error) => {
      console.error('[blocks/sources] currency rates load failed:', error);
      return [] as CurrencyRate[];
    }),
  ]);
  const currencyRatesByCode = new Map(currencyRatesList.map((r) => [r.code, r]));

  // Виртуальная страница `__virtual` — содержит cashflow KPI как «псевдо-блоки»
  // (income/expense/balance). Любой блок на любой странице может биндиться
  // на них по refs `@__virtual:cashflow.kpi.{metric}.{field}`.
  const virtualPage = await buildVirtualCashflowPage(tenantId);

  const pages = await Promise.all(pageKeys.map(async (pageKey) => {
    const layout = await loadLayout({ tenantId, userId, pageKey });
    const blocks = await Promise.all(layout.blocks.map(async (block) => {
      const meta = typeMeta(block.type);
      const label = titleOf(block);
      const pLabel = pageLabel(pageKey, customLabels);
      const fields = await fieldsForBlock(block, tenantId, monthlySummary, currencyRatesByCode);
      const allFields: SourceField[] = [
        ...fields,
        { name: 'label', label: 'Название', value: label },
      ];
      // Для Ozon-блоков проставляем L2-группу (отображается как подзаголовок
      // внутри секции экземпляра в модалке привязок). Прочие блоки идут
      // плоским списком — group остаётся undefined.
      if (block.type.startsWith('unit.ozon-')) {
        decorateOzonGroups(allFields);
      }
      return {
        blockId: block.id,
        pageKey,
        pageLabel: pLabel,
        type: block.type,
        typeLabel: meta.label,
        category: meta.category,
        label,
        fields: allFields,
        instanceLabel: buildInstanceLabel({
          type: block.type,
          typeLabel: meta.label,
          label,
          pageLabel: pLabel,
          config: block.config,
        }),
      } satisfies SourceBlock;
    }));
    // Сортировка: по категории (CATEGORY_ORDER), потом по label.
    blocks.sort((a, b) => {
      const r = categoryRank(a.category) - categoryRank(b.category);
      if (r !== 0) return r;
      return a.label.localeCompare(b.label, 'ru');
    });
    return { pageKey, pageLabel: pageLabel(pageKey, customLabels), blocks };
  }));

  return NextResponse.json({ ok: true, pages: [virtualPage, ...pages] });
}

// ============================================================================
// Виртуальные источники cashflow.kpi.* для bindings (@__virtual:cashflow.kpi.income.current)
// ============================================================================

async function buildVirtualCashflowPage(tenantId: string): Promise<{
  pageKey: string;
  pageLabel: string;
  blocks: SourceBlock[];
}> {
  // Период по умолчанию для виртуальных значений — MTD. Для cross-page
  // bindings без явного period параметра используем MTD как baseline.
  // (Когда блок-потребитель на cashflow-странице — он на клиенте получит
  // актуальные значения через VirtualSourcesBridge, который слушает
  // page-level period+source.)
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const metrics: Array<{ metric: 'income' | 'expense' | 'balance'; label: string }> = [
    { metric: 'income', label: 'Доходы (Cashflow KPI)' },
    { metric: 'expense', label: 'Расходы (Cashflow KPI)' },
    { metric: 'balance', label: 'Баланс (Cashflow KPI)' },
  ];

  const blocks: SourceBlock[] = await Promise.all(
    metrics.map(async ({ metric, label }) => {
      let kpi: Awaited<ReturnType<typeof getCashflowKpi>>;
      try {
        kpi = await getCashflowKpi({
          tenantId,
          metric,
          from: monthStart,
          to: monthEnd,
        });
      } catch (e) {
        console.error(`[blocks/sources] virtual cashflow.kpi.${metric} failed:`, e);
        kpi = { current: 0, previous: 0, count: 0, prevCount: 0, deltaPct: null, byDay: [] };
      }
      const blockId = `__virtual:cashflow.kpi.${metric}`;
      const fields: SourceField[] = [
        { name: 'value', label: 'Сумма', value: kpi.current, format: 'money' },
        { name: 'current', label: 'Сумма за период', value: kpi.current, format: 'money' },
        { name: 'previous', label: 'Прошлый период', value: kpi.previous, format: 'money' },
        { name: 'count', label: 'Кол-во операций', value: kpi.count, format: 'number' },
        { name: 'prevCount', label: 'Кол-во операций (прошл.)', value: kpi.prevCount, format: 'number' },
        { name: 'deltaPct', label: 'Изменение %', value: kpi.deltaPct, format: 'number' },
        { name: 'label', label: 'Название', value: label },
      ];
      return {
        blockId,
        pageKey: '__virtual',
        pageLabel: 'Cashflow (виртуальные)',
        type: 'cashflow.virtual-kpi',
        typeLabel: 'Cashflow KPI',
        category: 'Кэшфлоу',
        label,
        fields,
        instanceLabel: `${label} (виртуальный)`,
      } satisfies SourceBlock;
    }),
  );

  return {
    pageKey: '__virtual',
    pageLabel: 'Cashflow (виртуальные источники)',
    blocks,
  };
}
