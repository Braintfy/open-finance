// PURPOSE: Реестр AI skill-промптов для всех 28 типов блоков.
// Skill-промпт = бизнес-контекст блока для AI (что блок делает, какие данные, типичные вопросы).
// Уровень иерархии: global → section → page → block-type (здесь) → user supplement.
//
// Как добавить новый блок:
// 1. Найти нужный семейный файл или создать новый в этой папке.
// 2. Добавить запись вида: 'block.type': `Ты работаешь с блоком... Помогай: ...`.
// 3. Экспортировать из этого index.ts.

import { cashflowBlockSkills } from './cashflow';
import { sheetBlockSkills } from './sheet';
import { ozonBlockSkills } from './ozon';
import { unitEconomicsBlockSkills } from './unit-economics';
import { genericBlockSkills } from './generic';

/**
 * Глобальный реестр skill-промптов по типу блока.
 * Ключ = `BlockDef.type`, значение = системный промпт (1-3 предложения).
 * Admin может переопределить любой prompt через tenants.settings.aiPrompts.blocks[type].
 */
export const BLOCK_SKILLS: Record<string, string> = {
  ...cashflowBlockSkills,
  ...sheetBlockSkills,
  ...ozonBlockSkills,
  ...unitEconomicsBlockSkills,
  ...genericBlockSkills,
};

/**
 * Получить skill-промпт для типа блока.
 * @param blockType - ключ из BlockDef.type
 * @param override - override из tenants.settings.aiPrompts.blocks[type]
 */
export function getBlockSkill(blockType: string | undefined, override?: string): string {
  if (!blockType) return '';
  if (override?.trim()) return override.trim();
  return BLOCK_SKILLS[blockType] ?? '';
}

/**
 * Серверно-безопасный список всех типов блоков с человекочитаемыми названиями.
 * НЕ импортирует client-only catalog файлы — используется в API routes.
 * При добавлении нового блока: добавить запись сюда + в BLOCK_SKILLS.
 */
export const BLOCK_TYPE_META: Array<{ type: string; displayName: string }> = [
  // Cashflow / KPI
  { type: 'stat.income',              displayName: 'Доходы (KPI)' },
  { type: 'stat.expense',             displayName: 'Расходы (KPI)' },
  { type: 'stat.balance',             displayName: 'Баланс (KPI)' },
  { type: 'stat.custom',              displayName: 'KPI (настраиваемый)' },
  { type: 'cashflow.top-categories',  displayName: 'Топ категорий' },
  { type: 'cashflow.transactions',    displayName: 'Транзакции' },
  { type: 'chart.cashflow',           displayName: 'График денежного потока' },
  { type: 'kpi.grid',                 displayName: 'Сетка KPI' },
  // Spreadsheet
  { type: 'sheet',                    displayName: 'Таблица (Excel-style)' },
  { type: 'excel.cell',               displayName: 'Ячейка (Excel-style)' },
  { type: 'custom.data',              displayName: 'Данные (универсальный)' },
  // Generic
  { type: 'computed.sum',             displayName: 'Агрегация' },
  { type: 'navigate.card',            displayName: 'Навигационная карточка' },
  { type: 'ai.micro-agent',           displayName: 'AI Микроагент' },
  { type: 'currency.rates',           displayName: 'Курсы валют' },
  // Inbox
  { type: 'inbox.channel-feed',       displayName: 'Входящие (канал)' },
  { type: 'inbox.dashboard',          displayName: 'Входящие (сводка)' },
  // Ozon Analytics
  { type: 'unit.ozon-kpi',            displayName: 'Ozon KPI' },
  { type: 'unit.ozon-chart',          displayName: 'Ozon График' },
  { type: 'unit.ozon-analytics',      displayName: 'Ozon Аналитика (SKU)' },
  { type: 'unit.ozon-top-ads',        displayName: 'Ozon Топ рекламы' },
  { type: 'unit.ozon-campaigns',      displayName: 'Ozon Кампании' },
  { type: 'unit.ozon-stock-clusters', displayName: 'Ozon Остатки FBO/FBS' },
  { type: 'unit.ozon-warehouse-clusters', displayName: 'Ozon Кластеры складов' },
  { type: 'unit.ozon-search-phrases', displayName: 'Ozon Поисковые фразы' },
  { type: 'unit.ozon-abc',            displayName: 'Ozon ABC-анализ' },
  { type: 'unit.ozon-data-health',    displayName: 'Ozon Диагностика данных' },
  { type: 'unit.ozon-ai-insights',    displayName: 'Ozon AI Инсайты' },
  // Unit Economics
  { type: 'unit.ozon-calculator',     displayName: 'Юнит-экономика Ozon' },
  { type: 'unit.ozon-multi-table',    displayName: 'Ozon Мульти-таблица' },
  { type: 'unit.yandex-calculator',   displayName: 'Юнит-экономика Яндекс' },
  { type: 'unit.my-store-table',      displayName: 'Мой магазин' },
];
