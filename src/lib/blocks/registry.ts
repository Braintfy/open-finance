// PURPOSE: Реестр всех типов блоков (мап type → BlockDef)
import type { BlockDef, BlockInstance, PageLayout } from './types';
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
  { tags?: string[]; recommendedFor?: string[]; source?: BlockDef['source']; iconName: string }
> = {
  'stat.income': {
    // tag 'legacy' — старый KPI-блок. Новые пользователи добавляют через
    // excel.cell + cashflow-пресет или kpi.grid. Существующие — работают.
    tags: ['cashflow', 'kpi', 'finance', 'legacy'],
    recommendedFor: [],
    iconName: 'ArrowDown',
  },
  'stat.expense': {
    tags: ['cashflow', 'kpi', 'finance', 'legacy'],
    recommendedFor: [],
    iconName: 'ArrowUp',
  },
  'stat.balance': {
    tags: ['cashflow', 'kpi', 'finance', 'legacy'],
    recommendedFor: [],
    iconName: 'Wallet',
  },
  'stat.custom': {
    tags: ['kpi', 'custom', 'finance'],
    recommendedFor: ['cashflow', 'dashboard'],
    iconName: 'Sparkles',
  },
  'cashflow.top-categories': {
    tags: ['cashflow', 'analytics'],
    recommendedFor: ['cashflow', 'dashboard'],
    iconName: 'BarChart3',
  },
  'cashflow.transactions': {
    tags: ['cashflow', 'tables'],
    recommendedFor: ['cashflow'],
    iconName: 'ListOrdered',
  },
  sheet: { tags: ['tables', 'spreadsheet', 'universal'], recommendedFor: [], iconName: 'Table2' },
  'navigate.card': { tags: ['navigation', 'dashboard'], recommendedFor: ['dashboard'], iconName: 'Link' },
  'computed.sum': { tags: ['formula', 'analytics', 'universal'], recommendedFor: [], iconName: 'Sigma' },
  'custom.data': { tags: ['data', 'universal'], recommendedFor: [], iconName: 'Database' },
  'excel.cell': { tags: ['spreadsheet', 'universal'], recommendedFor: [], iconName: 'Calculator' },
  'kpi.grid': {
    tags: ['cashflow', 'kpi', 'finance', 'analytics'],
    recommendedFor: ['cashflow', 'dashboard'],
    iconName: 'Wallet',
  },
  'chart.cashflow': {
    tags: ['charts', 'cashflow'],
    recommendedFor: ['cashflow', 'dashboard'],
    iconName: 'BarChart3',
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
  },
  'unit.ozon-kpi': {
    tags: ['marketplace', 'analytics', 'ozon', 'kpi'],
    recommendedFor: ['marketplaces-ozon-dashboard', 'dashboard'],
    iconName: 'Activity',
  },
  'unit.ozon-chart': {
    tags: ['marketplace', 'analytics', 'ozon', 'charts'],
    recommendedFor: ['marketplaces-ozon-dashboard', 'dashboard'],
    iconName: 'LineChart',
  },
  'unit.ozon-top-ads': {
    tags: ['marketplace', 'analytics', 'ozon', 'ads', 'performance'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'Megaphone',
  },
  'unit.ozon-stock-clusters': {
    tags: ['marketplace', 'analytics', 'ozon', 'inventory'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'Warehouse',
  },
  'unit.ozon-warehouse-clusters': {
    tags: ['marketplace', 'analytics', 'ozon', 'inventory', 'clusters'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'Map',
  },
  'unit.ozon-search-phrases': {
    tags: ['marketplace', 'analytics', 'ozon', 'ads', 'performance'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'Search',
  },
  'unit.ozon-campaigns': {
    tags: ['marketplace', 'analytics', 'ozon', 'ads', 'performance'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'Megaphone',
  },
  'unit.ozon-data-health': {
    tags: ['marketplace', 'ozon', 'health', 'status'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'Activity',
  },
  'unit.ozon-abc': {
    tags: ['marketplace', 'analytics', 'ozon', 'abc'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'PieChart',
  },
  'unit.ozon-ai-insights': {
    tags: ['marketplace', 'analytics', 'ozon', 'ai'],
    recommendedFor: ['marketplaces-ozon-dashboard'],
    iconName: 'Sparkles',
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
};

function withMeta(def: BlockDef): BlockDef {
  const meta = BLOCK_META[def.type];
  if (!meta) return { ...def, source: def.source ?? 'builtin', iconName: def.iconName ?? 'Square' };
  return {
    ...def,
    tags: def.tags ?? meta.tags,
    recommendedFor: def.recommendedFor ?? meta.recommendedFor,
    source: def.source ?? meta.source ?? 'builtin',
    iconName: def.iconName ?? meta.iconName,
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
 * Блоки, рекомендуемые для конкретной страницы.
 * Правило: `recommendedFor` явно содержит pageKey ИЛИ `pages` содержит pageKey
 * (без '*'-блоков, чтобы Рекомендуемые не превращались во «всё»).
 */
export function listRecommendedForPage(pageKey: string): BlockDef[] {
  return ALL_BLOCKS.filter((b) => {
    if (b.recommendedFor?.includes(pageKey)) return true;
    if (b.pages.includes(pageKey)) return true;
    return false;
  });
}

export function listAllBlocks(): BlockDef[] {
  return ALL_BLOCKS.slice();
}

/** Дефолтные layout'ы для страниц — используются если у пользователя нет своего */
export const DEFAULT_LAYOUTS: Record<string, PageLayout> = {
  dashboard: {
    pageKey: 'dashboard',
    blocks: [
      { id: 'dash-income', type: 'stat.income', x: 0, y: 0, w: 4, h: 2 },
      { id: 'dash-expense', type: 'stat.expense', x: 4, y: 0, w: 4, h: 2 },
      { id: 'dash-balance', type: 'stat.balance', x: 8, y: 0, w: 4, h: 2 },
      {
        id: 'dash-nav-cashflow',
        type: 'navigate.card',
        x: 0,
        y: 2,
        w: 4,
        h: 2,
        config: {
          href: '/cashflow',
          title: 'Денежный поток',
          description: 'Доходы и расходы, импорт выписок',
          comingSoon: false,
        },
        appearance: { icon: 'Wallet' },
      },
      {
        id: 'dash-inbox',
        type: 'inbox.dashboard',
        x: 4,
        y: 2,
        w: 4,
        h: 4,
        config: { title: 'Входящие', limit: 5, channelId: null },
      },
      {
        id: 'dash-nav-deadlines',
        type: 'navigate.card',
        x: 8,
        y: 2,
        w: 4,
        h: 2,
        config: {
          href: '/deadlines',
          title: 'Дедлайны',
          description: 'Налоги, отчёты, обязательства',
          comingSoon: true,
        },
        appearance: { icon: 'Calendar' },
      },
    ],
    hiddenSections: [],
  },
  cashflow: {
    pageKey: 'cashflow',
    blocks: [
      { id: 'default-income', type: 'stat.income', x: 0, y: 0, w: 4, h: 2 },
      { id: 'default-expense', type: 'stat.expense', x: 4, y: 0, w: 4, h: 2 },
      { id: 'default-balance', type: 'stat.balance', x: 8, y: 0, w: 4, h: 2 },
      {
        id: 'default-chart',
        type: 'chart.cashflow',
        x: 0,
        y: 2,
        w: 12,
        h: 5,
        config: {
          chartType: 'area',
          showIncome: true,
          showExpense: true,
          showBalance: false,
          compare: 'prev',
          granularity: 'auto',
          periodOverride: null,
        },
      },
      {
        id: 'default-top-income',
        type: 'cashflow.top-categories',
        x: 0,
        y: 7,
        w: 6,
        h: 4,
        config: { type: 'income', title: 'Топ доходов' },
      },
      {
        id: 'default-top-expense',
        type: 'cashflow.top-categories',
        x: 6,
        y: 7,
        w: 6,
        h: 4,
        config: { type: 'expense', title: 'Топ расходов' },
      },
      {
        id: 'default-list',
        type: 'cashflow.transactions',
        x: 0,
        y: 11,
        w: 12,
        h: 6,
      },
    ],
    hiddenSections: [],
  },
  inbox: {
    pageKey: 'inbox',
    blocks: [
      {
        id: 'default-inbox-feed-left',
        type: 'inbox.channel-feed',
        x: 0,
        y: 0,
        w: 6,
        h: 12,
        config: { title: 'Входящие' },
      },
      {
        id: 'default-inbox-feed-right',
        type: 'inbox.channel-feed',
        x: 6,
        y: 0,
        w: 6,
        h: 12,
        config: { title: 'Входящие' },
      },
    ],
    hiddenSections: [],
  },
  'unit-economics-ozon': {
    pageKey: 'unit-economics-ozon',
    blocks: [
      {
        id: 'default-unit-ozon-calc',
        type: 'unit.ozon-calculator',
        x: 0,
        y: 0,
        w: 12,
        h: 9,
      },
    ],
    hiddenSections: [],
  },
  'unit-economics-ozon-multi': {
    pageKey: 'unit-economics-ozon-multi',
    blocks: [
      {
        id: 'default-unit-ozon-multi',
        type: 'unit.ozon-multi-table',
        x: 0,
        y: 0,
        w: 12,
        h: 12,
      },
    ],
    hiddenSections: [],
  },
  'marketplaces-ozon-dashboard': {
    pageKey: 'marketplaces-ozon-dashboard',
    blocks: [
      { id: 'mp-ozon-kpi', type: 'unit.ozon-kpi', x: 0, y: 0, w: 12, h: 4 },
      { id: 'mp-ozon-chart', type: 'unit.ozon-chart', x: 0, y: 4, w: 12, h: 6 },
      { id: 'mp-ozon-analytics', type: 'unit.ozon-analytics', x: 0, y: 10, w: 12, h: 10 },
      { id: 'mp-ozon-warehouse-clusters', type: 'unit.ozon-warehouse-clusters', x: 0, y: 20, w: 12, h: 6 },
      { id: 'mp-ozon-top-ads', type: 'unit.ozon-top-ads', x: 0, y: 26, w: 8, h: 6 },
      { id: 'mp-ozon-data-health', type: 'unit.ozon-data-health', x: 8, y: 26, w: 4, h: 6 },
      { id: 'mp-ozon-campaigns', type: 'unit.ozon-campaigns', x: 0, y: 32, w: 6, h: 6 },
      { id: 'mp-ozon-search-phrases', type: 'unit.ozon-search-phrases', x: 6, y: 32, w: 6, h: 6 },
      { id: 'mp-ozon-stock-clusters', type: 'unit.ozon-stock-clusters', x: 0, y: 38, w: 6, h: 5 },
      { id: 'mp-ozon-abc', type: 'unit.ozon-abc', x: 6, y: 38, w: 6, h: 7 },
      { id: 'mp-ozon-ai-insights', type: 'unit.ozon-ai-insights', x: 0, y: 45, w: 6, h: 6 },
    ],
    hiddenSections: [],
  },
  'unit-economics-yandex': {
    pageKey: 'unit-economics-yandex',
    blocks: [
      {
        id: 'default-unit-yandex-calc',
        type: 'unit.yandex-calculator',
        x: 0,
        y: 0,
        w: 12,
        h: 9,
      },
    ],
    hiddenSections: [],
  },
  'unit-economics-my-store': {
    pageKey: 'unit-economics-my-store',
    blocks: [
      {
        id: 'default-unit-my-store',
        type: 'unit.my-store-table',
        x: 0,
        y: 0,
        w: 12,
        h: 12,
      },
    ],
    hiddenSections: [],
  },
};

export function getDefaultLayout(pageKey: string): PageLayout {
  return (
    DEFAULT_LAYOUTS[pageKey] ?? {
      pageKey,
      blocks: [],
      hiddenSections: [],
    }
  );
}

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
    pages: ['cashflow', 'dashboard', '*'],
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
    pages: ['cashflow', 'dashboard', '*'],
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
    pages: ['cashflow', 'dashboard', '*'],
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
    pages: ['cashflow', 'dashboard', '*'],
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
    pages: ['cashflow', 'dashboard', '*'],
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
    pages: ['cashflow', 'dashboard', '*'],
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
    pages: ['cashflow', 'dashboard', '*'],
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
    pages: ['cashflow', 'dashboard', '*'],
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
