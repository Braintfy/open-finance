// PURPOSE: Код-дефолты раскладок страниц + шаблоны кабинетов (WORKSPACE_TEMPLATES).
//
// Почему отдельный модуль от registry.ts: здесь НЕТ импортов catalog-блоков
// ('use client' + React + lucide), поэтому файл можно импортировать из чистых
// smoke-тестов (scripts/test-workspace-templates.ts) и из серверных запросов
// (src/lib/blocks/queries.ts) без затягивания клиентского бандла.
//
// Дефолт = «строки в block_layouts нет». INSERT'ов при создании кабинета не
// делаем: новый кабинет пуст в БД и рисуется по шаблону (WORKSPACE_TEMPLATES),
// а первое же сохранение раскладки материализует его строкой.
//
// Шаблоны (LK_V2_PLAN.md Этап 3):
//   - 'seller-ozon' — дефолт нового кабинета: Ozon-дашборд + примеры
//     universal-блоков; остальные страницы наследуют DEFAULT_LAYOUTS;
//   - 'blank' — пустой кабинет: ВСЕ страницы без блоков.

import type { BlockInstance, PageLayout } from './types';

/**
 * Стартовый дашборд селлера Ozon. Заменил legacy-набор (stat.income/expense/
 * balance + пустой inbox.dashboard + мёртвая navigate.card на /app/deadlines).
 * Порядок сверху вниз: KPI → динамика → аналитика per-SKU → остатки по складам
 * → ABC + здоровье данных → примеры «своих» блоков (custom.data + excel.cell).
 */
const SELLER_OZON_DASHBOARD_BLOCKS: BlockInstance[] = [
  { id: 'dash-ozon-kpi', type: 'unit.ozon-kpi', x: 0, y: 0, w: 12, h: 4 },
  { id: 'dash-ozon-chart', type: 'unit.ozon-chart', x: 0, y: 4, w: 12, h: 6 },
  {
    id: 'dash-ozon-analytics',
    type: 'unit.ozon-analytics',
    x: 0,
    y: 10,
    w: 12,
    h: 10,
  },
  {
    id: 'dash-ozon-warehouses',
    type: 'unit.ozon-warehouse-clusters',
    x: 0,
    y: 20,
    w: 12,
    h: 6,
    // Разрез «по складам» (а не по кластерам) — основной сценарий селлера:
    // видно каждый склад, включая выбитые в ноль (см. Этап 2a).
    config: { groupBy: 'warehouse' },
  },
  { id: 'dash-ozon-abc', type: 'unit.ozon-abc', x: 0, y: 26, w: 6, h: 7 },
  {
    id: 'dash-ozon-data-health',
    type: 'unit.ozon-data-health',
    x: 6,
    y: 26,
    w: 6,
    h: 7,
  },
  // Примеры «своих» блоков — точка входа в кастомизацию кабинета.
  {
    id: 'dash-custom-data',
    type: 'custom.data',
    x: 0,
    y: 33,
    w: 6,
    h: 4,
    appearance: { title: 'Свои данные' },
  },
  {
    id: 'dash-excel-cell',
    type: 'excel.cell',
    x: 6,
    y: 33,
    w: 3,
    h: 2,
    appearance: { title: 'Своя формула' },
  },
];

const SELLER_OZON_DASHBOARD: PageLayout = {
  pageKey: 'dashboard',
  blocks: SELLER_OZON_DASHBOARD_BLOCKS,
  hiddenSections: [],
};

/** Дефолтные layout'ы для страниц — используются если у пользователя нет своего */
export const DEFAULT_LAYOUTS: Record<string, PageLayout> = {
  dashboard: SELLER_OZON_DASHBOARD,
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
  // Раздел «Склад» (docs/STOCK_MODULE_DESIGN.md §7). Порядок сверху вниз —
  // порядок работы: сначала видно, что есть и что заканчивается, потом лента
  // документов, куда вводится новая поставка.
  warehouse: {
    pageKey: 'warehouse',
    blocks: [
      { id: 'default-stock-balances', type: 'stock.balances', x: 0, y: 0, w: 12, h: 10 },
      { id: 'default-stock-docs', type: 'stock.docs', x: 0, y: 10, w: 12, h: 8 },
    ],
    hiddenSections: [],
  },
};

// ============================================================================
// WORKSPACE_TEMPLATES — стартовое наполнение кабинета
// ============================================================================

export const WORKSPACE_TEMPLATE_IDS = ['seller-ozon', 'blank'] as const;
export type WorkspaceTemplateId = (typeof WORKSPACE_TEMPLATE_IDS)[number];

export type WorkspaceTemplate = {
  id: WorkspaceTemplateId;
  label: string;
  description: string;
  /** Lucide icon name (строкой — RSC-safe, как BLOCK_META.iconName). */
  iconName: string;
  /** Переопределения дефолтных раскладок конкретных страниц. */
  layouts: Record<string, PageLayout>;
  /**
   * true  — страницы без явного layout берут общий DEFAULT_LAYOUTS;
   * false — все прочие страницы пустые (шаблон 'blank').
   */
  inheritDefaults: boolean;
};

export const WORKSPACE_TEMPLATES: Record<WorkspaceTemplateId, WorkspaceTemplate> = {
  'seller-ozon': {
    id: 'seller-ozon',
    label: 'Селлер Ozon',
    description:
      'Дашборд с KPI Ozon, динамикой, аналитикой по SKU, остатками по складам, ABC и здоровьем данных.',
    iconName: 'Store',
    layouts: { dashboard: SELLER_OZON_DASHBOARD },
    inheritDefaults: true,
  },
  blank: {
    id: 'blank',
    label: 'Пустой',
    description: 'Кабинет без блоков — наполняете страницы сами.',
    iconName: 'Square',
    layouts: {},
    inheritDefaults: false,
  },
};

export const DEFAULT_WORKSPACE_TEMPLATE: WorkspaceTemplateId = 'seller-ozon';

export function isWorkspaceTemplateId(
  value: string,
): value is WorkspaceTemplateId {
  return (WORKSPACE_TEMPLATE_IDS as readonly string[]).includes(value);
}

/** Метаданные шаблона (без раскладок) — для UI переключателя кабинетов. */
export function listWorkspaceTemplates(): Array<{
  id: WorkspaceTemplateId;
  label: string;
  description: string;
  iconName: string;
}> {
  return WORKSPACE_TEMPLATE_IDS.map((id) => {
    const t = WORKSPACE_TEMPLATES[id];
    return {
      id: t.id,
      label: t.label,
      description: t.description,
      iconName: t.iconName,
    };
  });
}

function emptyLayout(pageKey: string): PageLayout {
  return { pageKey, blocks: [], hiddenSections: [] };
}

/**
 * Код-дефолт раскладки страницы для кабинета с шаблоном `template`.
 * Без template (или с неизвестным) — поведение как раньше: DEFAULT_LAYOUTS.
 */
export function getDefaultLayout(pageKey: string, template?: string): PageLayout {
  if (template && isWorkspaceTemplateId(template)) {
    const tpl = WORKSPACE_TEMPLATES[template];
    const own = tpl.layouts[pageKey];
    if (own) return own;
    if (!tpl.inheritDefaults) return emptyLayout(pageKey);
  }
  return DEFAULT_LAYOUTS[pageKey] ?? emptyLayout(pageKey);
}
