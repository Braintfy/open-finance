---
name: of-ozon-column
version: 1.0.0
description: |
  Synchronized 4-file update procedure for Ozon analytics columns (types + table + settings form + test factory) — skipping any file breaks TS or silently hides the column.
  TRIGGER when: user asks to add/remove/rename a column or metric in Ozon analytics blocks (unit.ozon-analytics and friends).
  DO NOT TRIGGER when: changes to Ozon sync stages or API clients (delegate to of-ozon-dev agent).
allowed-tools:
  - Read
  - Edit
  - Grep
  - Bash
---

# Колонка Ozon-аналитики: 4 файла синхронно

> Контекст домена — `.cursor/rules/marketplaces.mdc` (раздел «После изменений Ozon API формы»). **Прочитать первым шагом.**

## Обновить ВСЕ 4 файла одновременно

1. `src/lib/blocks/catalog/unit-ozon-analytics-types.ts` — тип строки + `visibleColumns` enum.
2. `src/components/unit-economics/ozon-analytics-table.tsx` — `TableColumnKey` + `COLUMN_DEFS` + `getCellValue`.
3. `src/components/unit-economics/ozon-analytics-settings-form.tsx` — `COLUMN_GROUPS`.
4. `scripts/test-ozon-analytics.ts` — test row factory.

Пропуск любого = TS error на required field или колонка молча не появляется.

## Дополнительно

- **Bump `CACHE_VERSION`** в analytics-cache — иначе старые закэшированные строки без нового поля.
- Деньги — копейки + money-конвенции; per-unit метрики в строке «Итого» → `—` (см. `computeAnalyticsTotals`).
- Если колонка должна импортироваться в «Мой магазин» — дополнить `OZON_TO_MY_STORE_COLUMN_MAP` (`src/lib/unit-economics/ozon-to-my-store.ts`) + `extractOzonValue`.

## Верификация

`pnpm typecheck` → `pnpm tsx scripts/test-ozon-analytics.ts` → `pnpm build`.
