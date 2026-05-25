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
