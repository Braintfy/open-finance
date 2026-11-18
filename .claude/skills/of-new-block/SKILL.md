---
name: of-new-block
version: 1.0.0
description: |
  Full checklist for adding a new BlockGrid block type to Open Finance (catalog file → registry → sources API → publisher → settings → AI skill → verify).
  TRIGGER when: user asks for a new block, a new widget/card on a BlockGrid page, or a new feature that should be a block type.
  DO NOT TRIGGER when: editing an existing block (delegate to of-blocks-dev agent with blocks.mdc), or the feature is a new section/page — since 2026-11-18 new sections are plain pages, not blocks (docs/HUB_PLAN.md §4); a new block is only a dashboard tile over the shared metrics layer.
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Bash
---

# Новый блок BlockGrid

> Инварианты (grid, hooks, RSC, sticky, money, appearance) — в `.cursor/rules/blocks.mdc`. **Прочитать его первым шагом.** Здесь — расширенная процедура.

## Чеклист

1. **Каталог:** `src/lib/blocks/catalog/my-block.tsx` — `'use client'` если client-only, шапка `// PURPOSE: ...`. `BlockDef` обязан иметь `defaultSize`, `minSize`, `iconName` (string!).
2. **Регистрация:** `src/lib/blocks/registry.ts` — `ALL_BLOCKS` + `BLOCK_META` (iconName для RSC).
3. **Sources API:** `TYPE_LABELS`/`CATEGORY_ORDER` в `src/app/api/blocks/sources/route.ts` (новая категория добавляется именно сюда).
4. **Publisher:** если блок публикует значения — `useBlockValuePublisher(instance.id, {...})` **ВЫШЕ early-returns** + поля в `fieldsForBlock(...)`. Конвенции:
   - деньги — **копейки (×100)** + `__money: 'field1,field2'`;
   - человекочитаемые метки — `__labels: "key=Label,..."`;
   - блок с периодом — `useBlockPeriod` + `__periodKey` (читать `docs/PAGE_PERIODS.md`);
   - богатый контекст для ИИ — `__aiContext`.
5. **Конфиг:** zod-схема + `const config = useMemo(() => parseConfig(instance.config), [instance.config])`. Любой пользовательский выбор (режим, сравнение, таб) персистить через `onConfigChange` — голый `useState` тихо сбрасывается.
6. **SettingsForm:** только примитивы из `src/components/blocks/settings/` (README там). Выпадающие — `DropdownSelect`, не нативный `<select>`.
7. **AI-skill блока:** файл в `src/lib/ai/prompts/block-skills/` + регистрация в `BLOCK_SKILLS` — иначе «AI Анализ блока» будет с дефолтным промптом.
8. **Empty state** с CTA (дефолт `sourceBinding: 'empty'` для биндящихся блоков).
9. **Тест:** если есть pure-логика — smoke-скрипт `scripts/test-<name>.ts` по конвенции (`.claude/skills/of-run-tests/SKILL.md`), логика в модуле без импорта db client.

## Верификация

`/of-verify`. Помнить: менялись экспорты `catalog/**` → `rm -rf .next` перед build. Затем `/of-end-session` (MEMORY.md — новый блок в «Текущий каталог блоков», CHANGELOG).
