// PURPOSE: Реестр всех типов блоков (мап type → BlockDef)
import type { BlockDef, BlockInstance } from './types';
import { applySourceBindingMigration } from './source-binding';
import {
  StatIncomeBlock,
  StatExpenseBlock,
  StatBalanceBlock,
  TopCategoriesBlock,
  TransactionsListBlock,
} from './catalog/cashflow';
import { SheetBlock } from './catalog/sheet';
import { StatCustomBlock } from './catalog/stat-custom';
import { NavigateCardBlock } from './catalog/navigate-card';
import { ComputedSumBlock } from './catalog/computed';
import { CustomDataBlock } from './catalog/custom-data';
import { ExcelCellBlock } from './catalog/excel-cell';
import { KpiGridBlock } from './catalog/kpi-grid';
import { CashflowChartBlock } from './catalog/chart-cashflow';
import { AiMicroAgentBlock } from './catalog/ai-micro-agent';
import { InboxChannelFeedBlock } from './catalog/inbox-channel-feed';
import { InboxDashboardBlock } from './catalog/inbox-dashboard';
import { UnitOzonCalculatorBlock } from './catalog/unit-ozon-calculator';
import { UnitOzonMultiTableBlock } from './catalog/unit-ozon-multi-table';
import { UnitOzonAnalyticsBlock } from './catalog/unit-ozon-analytics';
import { UnitOzonKpiBlock } from './catalog/unit-ozon-kpi';
import { UnitOzonChartBlock } from './catalog/unit-ozon-chart';
import { UnitOzonTopAdsBlock } from './catalog/unit-ozon-top-ads';
import { UnitOzonStockClustersBlock } from './catalog/unit-ozon-stock-clusters';
import { UnitOzonWarehouseClustersBlock } from './catalog/unit-ozon-warehouse-clusters';
import { UnitOzonSearchPhrasesBlock } from './catalog/unit-ozon-search-phrases';
import { UnitOzonCampaignsBlock } from './catalog/unit-ozon-campaigns';
import { UnitOzonDataHealthBlock } from './catalog/unit-ozon-data-health';
import { UnitOzonAbcBlock } from './catalog/unit-ozon-abc';
import { UnitOzonAiInsightsBlock } from './catalog/unit-ozon-ai-insights';
import { UnitYandexCalculatorBlock } from './catalog/unit-yandex-calculator';
import { UnitMyStoreTableBlock } from './catalog/unit-my-store-table';
import { CurrencyRatesBlock } from './catalog/currency-rates';
import { MarkdownNoteBlock } from './catalog/markdown-note';
import { StockBalancesBlock } from './catalog/stock-balances';
import { StockDocsBlock } from './catalog/stock-docs';

/**
 * Метаданные маркетплейса для каждого блока — tags, recommendedFor, iconName
 * и source задаются здесь, чтобы не править каждый catalog-файл отдельно
 * и иметь единый источник правды.
 *
 * `iconName` критичен для RSC: catalog-файлы помечены `'use client'`,
 * поэтому `def.icon` в server-компонентах превращается в client-reference
 * без полей (включая `displayName`). Сериализуем имя иконки строкой здесь.
 */
const BLOCK_META: Record<
  string,
  {
    tags?: string[];
    recommendedFor?: string[];
    source?: BlockDef['source'];
    iconName: string;
    usesPeriod?: boolean;
    skeletonVariant?: string;
    /** Скрыт из каталога добавления; существующие инстансы работают (см. BlockDef.hidden). */
    hidden?: boolean;
  }
> = {
  'stat.income': {
    // tag 'legacy' — старый KPI-блок. Новые пользователи добавляют через
    // excel.cell + cashflow-пресет или kpi.grid. Существующие — работают.
    tags: ['cashflow', 'kpi', 'finance', 'legacy'],
    recommendedFor: [],
    iconName: 'ArrowDown',
    usesPeriod: true,
  },
  'stat.expense': {
    tags: ['cashflow', 'kpi', 'finance', 'legacy'],
    recommendedFor: [],
    iconName: 'ArrowUp',
    usesPeriod: true,
  },
  'stat.balance': {
    tags: ['cashflow', 'kpi', 'finance', 'legacy'],
    recommendedFor: [],
    iconName: 'Wallet',
    usesPeriod: true,
  },
  'stat.custom': {
    tags: ['kpi', 'custom', 'finance'],
    recommendedFor: ['cashflow', 'dashboard'],
    iconName: 'Sparkles',
    usesPeriod: true,
  },
  'cashflow.top-categories': {
    tags: ['cashflow', 'analytics'],
    recommendedFor: ['cashflow', 'dashboard'],
    iconName: 'BarChart3',
    usesPeriod: true,
  },
  'cashflow.transactions': {
    tags: ['cashflow', 'tables'],
    recommendedFor: ['cashflow'],
    iconName: 'ListOrdered',
    usesPeriod: true,
  },
  sheet: { tags: ['tables', 'spreadsheet', 'universal'], recommendedFor: [], iconName: 'Table2' },
  'navigate.card': {
    tags: ['navigation', 'dashboard'],
    recommendedFor: ['dashboard'],
    iconName: 'Link',
    // Дефолтный config ведёт на несуществующий раздел (/app/deadlines, comingSoon)
    // → в каталоге добавления бесполезен. Размещённые карточки работают.
    hidden: true,
  },
  'computed.sum': { tags: ['formula', 'analytics', 'universal'], recommendedFor: [], iconName: 'Sigma' },
  'custom.data': { tags: ['data', 'universal'], recommendedFor: [], iconName: 'Database' },
  'excel.cell': { tags: ['spreadsheet', 'universal'], recommendedFor: [], iconName: 'Calculator' },
  'kpi.grid': {
    tags: ['cashflow', 'kpi', 'finance', 'analytics'],
    recommendedFor: ['cashflow', 'dashboard'],
    iconName: 'Wallet',
    usesPeriod: true,
  },
  'chart.cashflow': {
    tags: ['charts', 'cashflow'],
    recommendedFor: ['cashflow', 'dashboard'],
    iconName: 'BarChart3',
    usesPeriod: true,
  },
  'ai.micro-agent': { tags: ['ai', 'universal'], recommendedFor: [], iconName: 'Sparkles' },
  'inbox.channel-feed': {
    tags: ['inbox', 'communications'],
    recommendedFor: ['inbox'],
    iconName: 'Inbox',
  },
  'inbox.dashboard': {
    tags: ['inbox', 'communications', 'compact'],
    recommendedFor: ['dashboard', 'cashflow'],
    iconName: 'Inbox',
    // Без настроенных IMAP/Telegram-каналов блок всегда пуст → прячем из каталога
    // добавления. Размещённые инстансы работают как раньше.
    hidden: true,
  },
  'unit.ozon-calculator': {
    tags: ['marketplace', 'unit-economics', 'ozon'],
    recommendedFor: ['unit-economics-ozon'],
    iconName: 'Calculator',
  },
  'unit.ozon-multi-table': {
    tags: ['marketplace', 'unit-economics', 'ozon', 'tables'],
    recommendedFor: ['unit-economics-ozon-multi'],
    iconName: 'Table',
  },
  'unit.ozon-analytics': {
    tags: ['marketplace', 'analytics', 'ozon', 'tables'],
    recommendedFor: ['unit-economics-ozon-multi', 'marketplaces-ozon-dashboard', 'dashboard'],
    iconName: 'BarChart3',
    usesPeriod: true,
  },
  'unit.ozon-kpi': {
    tags: ['marketplace', 'analytics', 'ozon', 'kpi'],
    recommendedFor: ['marketplaces-ozon-dashboard', 'dashboard'],
    iconName: 'Activity',
    usesPeriod: true,
  },
  'unit.ozon-chart': {
    tags: ['marketplace', 'analytics', 'ozon', 'charts'],
    recommendedFor: ['marketplaces-ozon-dashboard', 'dashboard'],
    iconName: 'LineChart',
    usesPeriod: true,
  },
  'unit.ozon-top-ads': {
    tags: ['marketplace', 'analytics', 'ozon', 'ads', 'performance'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'Megaphone',
    usesPeriod: true,
  },
  'unit.ozon-stock-clusters': {
    tags: ['marketplace', 'analytics', 'ozon', 'inventory'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'Warehouse',
  },
  'unit.ozon-warehouse-clusters': {
    tags: ['marketplace', 'analytics', 'ozon', 'inventory', 'clusters', 'warehouses'],
    // 'dashboard' — блок входит в стартовый шаблон кабинета 'seller-ozon'.
    recommendedFor: ['marketplaces-ozon-dashboard', 'dashboard'],
    iconName: 'Map',
    usesPeriod: true,
  },
  'unit.ozon-search-phrases': {
    tags: ['marketplace', 'analytics', 'ozon', 'ads', 'performance'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'Search',
    usesPeriod: true,
  },
  'unit.ozon-campaigns': {
    tags: ['marketplace', 'analytics', 'ozon', 'ads', 'performance'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'Megaphone',
    usesPeriod: true,
  },
  'unit.ozon-data-health': {
    tags: ['marketplace', 'ozon', 'health', 'status'],
    recommendedFor: ['marketplaces-ozon-dashboard', 'dashboard'],
    iconName: 'Activity',
  },
  'unit.ozon-abc': {
    tags: ['marketplace', 'analytics', 'ozon', 'abc'],
    recommendedFor: ['marketplaces-ozon-dashboard', 'dashboard'],
    iconName: 'PieChart',
    usesPeriod: true,
  },
  'unit.ozon-ai-insights': {
    tags: ['marketplace', 'analytics', 'ozon', 'ai'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'Sparkles',
    usesPeriod: true,
  },
  'unit.yandex-calculator': {
    tags: ['marketplace', 'unit-economics', 'yandex'],
    recommendedFor: ['unit-economics-yandex'],
    iconName: 'Calculator',
  },
  'unit.my-store-table': {
    tags: ['marketplace', 'unit-economics', 'tables', 'custom'],
    recommendedFor: ['unit-economics-my-store'],
    iconName: 'Store',
  },
  'currency.rates': {
    tags: ['finance', 'currency', 'universal', 'data'],
    recommendedFor: ['dashboard'],
    iconName: 'Banknote',
  },
  'note.markdown': {
    tags: ['notes', 'markdown', 'universal', 'custom'],
    recommendedFor: ['dashboard', 'boards'],
    iconName: 'NotebookPen',
  },
  // Модуль «Склад · Поставки · Себестоимость» (docs/STOCK_MODULE_DESIGN.md §7).
  'stock.balances': {
    tags: ['stock', 'warehouse', 'inventory', 'cost', 'supply'],
    recommendedFor: ['warehouse'],
    iconName: 'Warehouse',
    skeletonVariant: 'table',
  },
  'stock.docs': {
    tags: ['stock', 'warehouse', 'documents', 'purchases', 'supply'],
    recommendedFor: ['warehouse'],
    iconName: 'ClipboardList',
    usesPeriod: true,
    skeletonVariant: 'table',
  },
};

// Форма скелетона загрузки по типу блока (см. BlockSkeletonVariant в block-skeleton.tsx).
// Строкой → RSC-safe (как iconName). Дефолт для отсутствующих — 'generic'.
const SKELETON_VARIANT_BY_TYPE: Record<string, string> = {
  'stat.income': 'stat',
  'stat.expense': 'stat',
  'stat.balance': 'stat',
  'stat.custom': 'stat',
  'computed.sum': 'stat',
  'excel.cell': 'stat',
  'kpi.grid': 'kpiGrid',
  'unit.ozon-kpi': 'kpiGrid',
  'chart.cashflow': 'chart',
  'unit.ozon-chart': 'chart',
  sheet: 'table',
  'custom.data': 'table',
  'unit.ozon-multi-table': 'table',
  'unit.ozon-analytics': 'table',
  'unit.ozon-top-ads': 'table',
  'unit.ozon-stock-clusters': 'table',
  'unit.ozon-warehouse-clusters': 'table',
  'unit.ozon-search-phrases': 'table',
  'unit.ozon-campaigns': 'table',
  'unit.ozon-abc': 'table',
  'unit.my-store-table': 'table',
  'stock.balances': 'table',
  'stock.docs': 'table',
  'cashflow.top-categories': 'list',
  'cashflow.transactions': 'list',
  'inbox.channel-feed': 'list',
  'inbox.dashboard': 'list',
  'unit.ozon-data-health': 'list',
  'unit.ozon-ai-insights': 'list',
  'currency.rates': 'list',
  'unit.ozon-calculator': 'calculator',
  'unit.yandex-calculator': 'calculator',
  'navigate.card': 'generic',
  'ai.micro-agent': 'generic',
  'note.markdown': 'generic',
};

function resolveSkeletonVariant(def: BlockDef, metaVariant?: string): string {
  return def.skeletonVariant ?? metaVariant ?? SKELETON_VARIANT_BY_TYPE[def.type] ?? 'generic';
}

function withMeta(def: BlockDef): BlockDef {
  const meta = BLOCK_META[def.type];
  if (!meta)
    return {
      ...def,
      source: def.source ?? 'builtin',
      iconName: def.iconName ?? 'Square',
      skeletonVariant: resolveSkeletonVariant(def),
    };
  return {
    ...def,
    tags: def.tags ?? meta.tags,
    recommendedFor: def.recommendedFor ?? meta.recommendedFor,
    source: def.source ?? meta.source ?? 'builtin',
    iconName: def.iconName ?? meta.iconName,
    usesPeriod: def.usesPeriod ?? meta.usesPeriod,
    hidden: def.hidden ?? meta.hidden,
    skeletonVariant: resolveSkeletonVariant(def, meta.skeletonVariant),
  };
}

const ALL_BLOCKS: BlockDef[] = [
  StatIncomeBlock,
  StatExpenseBlock,
  StatBalanceBlock,
  StatCustomBlock,
  TopCategoriesBlock,
  TransactionsListBlock,
  SheetBlock,
  NavigateCardBlock,
  ComputedSumBlock,
  CustomDataBlock,
  ExcelCellBlock,
  KpiGridBlock,
  CashflowChartBlock,
  AiMicroAgentBlock,
  InboxChannelFeedBlock,
  InboxDashboardBlock,
  UnitOzonCalculatorBlock,
  UnitOzonMultiTableBlock,
  UnitOzonAnalyticsBlock,
  UnitOzonKpiBlock,
  UnitOzonChartBlock,
  UnitOzonTopAdsBlock,
  UnitOzonStockClustersBlock,
  UnitOzonWarehouseClustersBlock,
  UnitOzonSearchPhrasesBlock,
  UnitOzonCampaignsBlock,
  UnitOzonDataHealthBlock,
  UnitOzonAbcBlock,
  UnitOzonAiInsightsBlock,
  UnitYandexCalculatorBlock,
  UnitMyStoreTableBlock,
  CurrencyRatesBlock,
  StockBalancesBlock,
  StockDocsBlock,
  MarkdownNoteBlock,
].map(withMeta);

const REGISTRY = new Map<string, BlockDef>(ALL_BLOCKS.map((b) => [b.type, b]));

export function getBlockDef(type: string): BlockDef | undefined {
  return REGISTRY.get(type);
}

export function listBlocksForPage(pageKey: string): BlockDef[] {
  return ALL_BLOCKS.filter(
    (b) => b.pages.includes('*') || b.pages.includes(pageKey)
  );
}

/**
 * Блоки, рекомендуемые для конкретной страницы. Порядок стабильный (порядок
 * `ALL_BLOCKS` внутри каждой группы), две группы подряд:
 *
 *  1. Явные — `recommendedFor` содержит pageKey ИЛИ `pages` содержит pageKey.
 *  2. Универсальные — `pages` РОВНО `['*']`, т.е. у блока нет собственных
 *     «домашних» страниц (sheet, custom.data, excel.cell, computed.sum,
 *     note.markdown, currency.rates, ai.micro-agent). Раньше они не попадали
 *     в «Рекомендуемые» ни на одной странице. Блоки вида `['cashflow','*']`
 *     (kpi.grid, navigate.card) остаются рекомендованными только на своих
 *     страницах — иначе cashflow-блоки лезли бы на Ozon-дашборд.
 *
 * Из обеих групп исключаются `hidden`-блоки, из универсальной — ещё и
 * `legacy`-тегированные.
 */
export function listRecommendedForPage(pageKey: string): BlockDef[] {
  const explicit = ALL_BLOCKS.filter(
    (b) => !b.hidden && (b.recommendedFor?.includes(pageKey) || b.pages.includes(pageKey)),
  );
  const seen = new Set(explicit.map((b) => b.type));
  const universal = ALL_BLOCKS.filter(
    (b) =>
      !b.hidden &&
      !seen.has(b.type) &&
      b.pages.length === 1 &&
      b.pages[0] === '*' &&
      !(b.tags ?? []).includes('legacy'),
  );
  return [...explicit, ...universal];
}

export function listAllBlocks(): BlockDef[] {
  return ALL_BLOCKS.slice();
}

// Дефолтные раскладки страниц и шаблоны кабинетов вынесены в отдельный модуль
// без импортов catalog-блоков (см. ./default-layouts.ts) — чтобы серверные
// запросы и smoke-тесты могли их использовать без клиентского бандла.
// Ре-экспорт сохраняет существующие импорты из '@/lib/blocks/registry'.
export {
  DEFAULT_LAYOUTS,
  WORKSPACE_TEMPLATES,
  WORKSPACE_TEMPLATE_IDS,
  DEFAULT_WORKSPACE_TEMPLATE,
  isWorkspaceTemplateId,
  listWorkspaceTemplates,
  getDefaultLayout,
} from './default-layouts';
export type { WorkspaceTemplate, WorkspaceTemplateId } from './default-layouts';

/**
 * Простая валидация — обрезает блоки с неизвестным type и применяет
 * idempotent source binding migration: для cashflow KPI/chart/top-categories/
 * kpi.grid блоков без `sourceBinding` авто-привязывает к первому
 * `cashflow.transactions` блоку на той же странице (или {empty} если такого
 * блока нет). Это сохраняет старое поведение для existing layout'ов и
 * одновременно вводит явную привязку для будущих изменений.
 *
 * Миграция idempotent: повторный вызов не меняет блоки с уже выставленным
 * binding'ом. Безопасно для разных страниц — `blocks` всегда одной страницы.
 */
export function sanitizeBlocks(blocks: BlockInstance[]): BlockInstance[] {
  const known = blocks.filter((b) => REGISTRY.has(b.type));
  return applySourceBindingMigration(known);
}

// ============================================================================
// BLOCK_PRESETS — pre-configured blocks (excel.cell + cashflow KPI и т.д.)
// ============================================================================
//
// Концепция: пресет — это «рецепт» создания блока с заранее заполненным config.
// Используется в AddBlockDialog для быстрого добавления типовых сценариев
// (например, «Доходы за период», «Расходы за месяц»).
//
// От обычного BlockDef отличается тем, что НЕ регистрирует новый type — это
// лишь shorthand для создания экземпляра существующего типа с готовым config.

export type BlockPreset = {
  /** Уникальный id пресета (для UI ключей). */
  id: string;
  /** Отображаемое название. */
  label: string;
  /** Категория для группировки в picker'е. */
  category: 'cashflow' | 'analytics' | 'marketplace';
  /** Имя Lucide-иконки. */
  iconName: string;
  /** Какой type блока создаётся (должен существовать в REGISTRY). */
  baseType: string;
  /** Описание (короткое). */
  description: string;
  /** Дефолтный config для нового экземпляра. */
  defaultConfig: Record<string, unknown>;
  /** Опц. дефолтный appearance (icon override, etc). */
  defaultAppearance?: Record<string, unknown>;
  /** Опц. рекомендуемый размер при добавлении. */
  defaultSize?: { w: number; h: number };
  /** На каких страницах пресет показывается. */
  pages: string[];
};

export const BLOCK_PRESETS: BlockPreset[] = [
  {
    id: 'cashflow.income-period',
    label: 'Доходы за период',
    category: 'cashflow',
    iconName: 'ArrowDown',
    baseType: 'excel.cell',
    description: 'KPI-ячейка с суммой поступлений за выбранный период страницы',
    defaultConfig: {
      title: 'Доходы',
      value: '=@__virtual:cashflow.kpi.income.current',
      showFormulaBar: false,
      showKopecks: null,
      blockRefs: { '__virtual:cashflow.kpi.income.current': null },
      moneyRefs: { '__virtual:cashflow.kpi.income.current': true },
    },
    defaultAppearance: { icon: 'ArrowDown', accentColor: '#10b981' },
    defaultSize: { w: 4, h: 2 },
    pages: ['cashflow', 'dashboard'],
  },
  {
    id: 'cashflow.expense-period',
    label: 'Расходы за период',
    category: 'cashflow',
    iconName: 'ArrowUp',
    baseType: 'excel.cell',
    description: 'KPI-ячейка с суммой расходов за выбранный период страницы',
    defaultConfig: {
      title: 'Расходы',
      value: '=@__virtual:cashflow.kpi.expense.current',
      showFormulaBar: false,
      showKopecks: null,
      blockRefs: { '__virtual:cashflow.kpi.expense.current': null },
      moneyRefs: { '__virtual:cashflow.kpi.expense.current': true },
    },
    defaultAppearance: { icon: 'ArrowUp', accentColor: '#ef4444' },
    defaultSize: { w: 4, h: 2 },
    pages: ['cashflow', 'dashboard'],
  },
  {
    id: 'cashflow.balance-period',
    label: 'Баланс за период',
    category: 'cashflow',
    iconName: 'Wallet',
    baseType: 'excel.cell',
    description: 'KPI-ячейка с балансом (доходы − расходы) за период страницы',
    defaultConfig: {
      title: 'Баланс',
      value: '=@__virtual:cashflow.kpi.balance.current',
      showFormulaBar: false,
      showKopecks: null,
      blockRefs: { '__virtual:cashflow.kpi.balance.current': null },
      moneyRefs: { '__virtual:cashflow.kpi.balance.current': true },
    },
    defaultAppearance: { icon: 'Wallet', accentColor: '#3b82f6' },
    defaultSize: { w: 4, h: 2 },
    pages: ['cashflow', 'dashboard'],
  },
  {
    id: 'cashflow.count-period',
    label: 'Количество операций',
    category: 'cashflow',
    iconName: 'ListOrdered',
    baseType: 'excel.cell',
    description: 'Сколько было операций за выбранный период страницы',
    defaultConfig: {
      title: 'Операций',
      value: '=@__virtual:cashflow.kpi.income.count + @__virtual:cashflow.kpi.expense.count',
      showFormulaBar: false,
      showKopecks: null,
      blockRefs: {
        '__virtual:cashflow.kpi.income.count': null,
        '__virtual:cashflow.kpi.expense.count': null,
      },
      moneyRefs: {
        '__virtual:cashflow.kpi.income.count': false,
        '__virtual:cashflow.kpi.expense.count': false,
      },
    },
    defaultAppearance: { icon: 'ListOrdered' },
    defaultSize: { w: 4, h: 2 },
    pages: ['cashflow', 'dashboard'],
  },
  // ----- kpi.grid presets -----
  {
    id: 'kpi-grid.three-cells',
    label: 'KPI-сетка: Доходы / Расходы / Баланс',
    category: 'cashflow',
    iconName: 'Wallet',
    baseType: 'kpi.grid',
    description: '3 KPI в строку (наследуют период и источник со страницы)',
    defaultConfig: {
      title: 'Cashflow KPI',
      layout: 'row',
      cells: [
        { id: 'c1', metric: 'income', format: 'rub' },
        { id: 'c2', metric: 'expense', format: 'rub' },
        { id: 'c3', metric: 'balance', format: 'rub' },
      ],
    },
    defaultSize: { w: 12, h: 3 },
    pages: ['cashflow', 'dashboard'],
  },
  {
    id: 'kpi-grid.months',
    label: 'KPI-сетка: Месяцы (тек. / прошлый / 30 дн.)',
    category: 'cashflow',
    iconName: 'Wallet',
    baseType: 'kpi.grid',
    description: '3 KPI с разными периодами для сравнения',
    defaultConfig: {
      title: 'Доходы по периодам',
      layout: 'row',
      cells: [
        {
          id: 'c1',
          metric: 'income',
          label: 'Текущий месяц',
          format: 'rub',
          periodOverride: { preset: 'mtd', customFrom: null, customTo: null },
        },
        {
          id: 'c2',
          metric: 'income',
          label: 'Последние 14 дней',
          format: 'rub',
          periodOverride: { preset: '14d', customFrom: null, customTo: null },
        },
        {
          id: 'c3',
          metric: 'income',
          label: 'Последние 30 дней',
          format: 'rub',
          periodOverride: { preset: '30d', customFrom: null, customTo: null },
        },
      ],
    },
    defaultSize: { w: 12, h: 3 },
    pages: ['cashflow', 'dashboard'],
  },
  {
    id: 'kpi-grid.panel-2x2',
    label: 'KPI-сетка: Финансовая панель 2×2',
    category: 'cashflow',
    iconName: 'Wallet',
    baseType: 'kpi.grid',
    description: '4 KPI: Доходы, Расходы, Баланс, Кол-во операций',
    defaultConfig: {
      title: 'Финансовая панель',
      layout: 'grid-2col',
      cells: [
        { id: 'c1', metric: 'income', format: 'rub' },
        { id: 'c2', metric: 'expense', format: 'rub' },
        { id: 'c3', metric: 'balance', format: 'rub' },
        { id: 'c4', metric: 'count', format: 'number' },
      ],
    },
    defaultSize: { w: 8, h: 4 },
    pages: ['cashflow', 'dashboard'],
  },
  {
    id: 'cashflow.delta-prev',
    label: 'Доходы vs прошлый период (%)',
    category: 'cashflow',
    iconName: 'TrendingUp',
    baseType: 'excel.cell',
    description: 'Изменение доходов % vs прошлый период такой же длины',
    defaultConfig: {
      title: 'Δ Доходы',
      value: '=@__virtual:cashflow.kpi.income.deltaPct',
      showFormulaBar: false,
      showKopecks: false,
      blockRefs: { '__virtual:cashflow.kpi.income.deltaPct': null },
      moneyRefs: { '__virtual:cashflow.kpi.income.deltaPct': false },
    },
    defaultAppearance: { icon: 'TrendingUp' },
    defaultSize: { w: 4, h: 2 },
    pages: ['cashflow', 'dashboard'],
  },
];

export function listPresetsForPage(pageKey: string): BlockPreset[] {
  return BLOCK_PRESETS.filter(
    (p) => p.pages.includes(pageKey) || p.pages.includes('*'),
  );
}

export function getPreset(presetId: string): BlockPreset | undefined {
  return BLOCK_PRESETS.find((p) => p.id === presetId);
}
