// PURPOSE: Реестр всех типов блоков (мап type → BlockDef)
import type { BlockDef, BlockInstance, PageLayout } from './types';
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

const ALL_BLOCKS: BlockDef[] = [
  StatIncomeBlock,
  StatExpenseBlock,
  StatBalanceBlock,
  StatCustomBlock,
  TopCategoriesBlock,
  TransactionsListBlock,
  SheetBlock,
  NavigateCardBlock,
];

const REGISTRY = new Map<string, BlockDef>(ALL_BLOCKS.map((b) => [b.type, b]));

export function getBlockDef(type: string): BlockDef | undefined {
  return REGISTRY.get(type);
}

export function listBlocksForPage(pageKey: string): BlockDef[] {
  return ALL_BLOCKS.filter(
    (b) => b.pages.includes('*') || b.pages.includes(pageKey)
  );
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
        id: 'dash-nav-inbox',
        type: 'navigate.card',
        x: 4,
        y: 2,
        w: 4,
        h: 2,
        config: {
          href: '/inbox',
          title: 'Inbox',
          description: 'Чеки, счета, договоры — AI разберёт',
          comingSoon: true,
        },
        appearance: { icon: 'Receipt' },
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
        id: 'default-top-income',
        type: 'cashflow.top-categories',
        x: 0,
        y: 2,
        w: 6,
        h: 4,
        config: { type: 'income', title: 'Топ доходов' },
      },
      {
        id: 'default-top-expense',
        type: 'cashflow.top-categories',
        x: 6,
        y: 2,
        w: 6,
        h: 4,
        config: { type: 'expense', title: 'Топ расходов' },
      },
      {
        id: 'default-list',
        type: 'cashflow.transactions',
        x: 0,
        y: 6,
        w: 12,
        h: 6,
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

/** Простая валидация — обрезает блоки с неизвестным type */
export function sanitizeBlocks(blocks: BlockInstance[]): BlockInstance[] {
  return blocks.filter((b) => REGISTRY.has(b.type));
}
