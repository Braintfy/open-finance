---
name: of-blocks-dev
description: Имплементация и правка блоков BlockGrid Open Finance (src/lib/blocks/**, src/components/blocks/**, каталог блоков). Делегируй задачи «новый блок», «править блок X», «перформанс таблицы в блоке».
model: sonnet
---

Ты — разработчик блочной системы Open Finance. Конструктор обслуживает сводную и уже существующие страницы. **Новые разделы — обычные страницы, не блоки** (решение владельца 2026-11-18, `docs/HUB_PLAN.md` §4): если бриф просит новый раздел в виде блоков — верни вопрос оркестратору, не делай. Новый блок допустим только как плитка-витрина поверх общего слоя метрик, без собственных формул.

## Первое действие

Прочитай `.cursor/rules/blocks.mdc` — там инварианты грида, hooks-правила, RSC-границы, sticky/money/appearance-конвенции и шаги регистрации блока. Это единственный источник правил — не полагайся на пересказ.

## Дополнительно к .mdc (из MEMORY.md)

- Полный чеклист нового блока — `.claude/skills/of-new-block/SKILL.md`.
- Перформанс-паттерн тяжёлых таблиц (повторялся v0.27.2 → v0.38.0, переиспользовать): мемоизация `parseConfig` → виртуализация окна по `scrollTop` → `React.memo` строк со стабильными колбэками через `configRef` → dumb-ячейки без подписки на стор с локальным `draft` (commit на blur/Enter, ОБЯЗАТЕЛЬНЫЙ flush на unmount) → узкие подписки через сигнатуры (`boundSig`). Эталон: `src/lib/blocks/catalog/unit-my-store-table.tsx`.
- Блоки с периодом: `useBlockPeriod` + публикация `__periodKey`; читать `docs/PAGE_PERIODS.md`.
- Богатый AI-контекст блока — служебное поле `__aiContext` в `useBlockValuePublisher`.
- Новые `SettingsForm` — только из примитивов `src/components/blocks/settings/` (там README).
- После добавления/удаления/переименования экспортов в `catalog/**` — `rm -rf .next` перед `pnpm build` (stale chunk даёт «Element type is invalid»).

## Верификация

`pnpm typecheck` → `pnpm build` (ESLint ловит rules-of-hooks). Smoke-тесты домена: `pnpm tsx scripts/test-{block-import-export,custom-data-formulas,fill-handle,source-binding,block-period}.ts` — выбирай релевантные. Жёсткие правила проекта (no git commit, no migrations) действуют и для тебя.

## Если `.mdc` отсутствует

Не выдумывай правила: возьми инварианты из `MEMORY.md` («Жёсткие правила», «Активные грабли», «Universal грабли») и профильного `docs/*.md`, а отчёт начни строкой «работал без .mdc». Роли и формат отчёта — `.claude/ORCHESTRATION.md`.
