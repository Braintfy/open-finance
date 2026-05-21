# kpi.grid — KPI-сетка (v0.20.0)

Контейнер с 1–6 KPI-ячейками cashflow в одном Card. Заменяет несколько отдельных `stat.income / stat.expense / stat.balance` блоков на странице — одним заголовком, общим стилем, но независимыми фильтрами в каждой ячейке.

## Зачем

**Раньше**: чтобы показать «Доходы / Расходы / Баланс» — нужно было 3 отдельных блока. У каждого свой Card, свой заголовок, свой `stat.*` тип. Сетка получалась шумной, экраны быстро забивались.

**Теперь**: один `kpi.grid` блок с 3 (или больше) ячейками внутри. Один Card с заголовком вверху, ячейки внутри — минимально, без вложенных рамок и фонов. Каждая ячейка может иметь свой период / источник / категорию.

## Дизайн

```
┌─ kpi.grid Card ────────────────────────────────────┐
│  Cashflow KPI                                  [⚙]  │  ← title
│  ─────────────────────────────────────────────────  │
│  ┌─────────┬─────────┬─────────┐                  │
│  │ ↓Доходы │ ↑Расходы│ Баланс  │                  │
│  │ 1.2M ₽ │ 870K ₽ │ +358K ₽ │  ← cells          │
│  │  +12%   │  -8%    │ vs пред │                  │
│  └─────────┴─────────┴─────────┘                  │
└────────────────────────────────────────────────────┘
```

## Schema

```typescript
type KpiGridCell = {
  id: string;                                          // nanoid в config
  metric: 'income' | 'expense' | 'balance' | 'count';
  label?: string;                                       // override дефолтного
  periodOverride: PeriodValue | null;                   // null = global
  sourceOverride: string | null | undefined;            // undefined = global
  categoryName?: string;
  counterparty?: string;
  format: 'rub' | 'number' | 'percent' | 'compact';
  accentColor?: string;                                 // HEX
};

type KpiGridConfig = {
  title: string;
  layout: 'row' | 'column' | 'grid-2col' | 'grid-3col';
  cells: KpiGridCell[];  // 1-6
};
```

Min 1 ячейка, max 6 — больше уже не читаемо в одном Card.

## Layout

| value | Tailwind | Когда использовать |
|---|---|---|
| `row` | `grid grid-flow-col auto-cols-fr` | 2–4 KPI в строку (горизонталь) |
| `column` | `grid grid-flow-row auto-rows-fr` | Sidebar / узкий блок |
| `grid-2col` | `grid grid-cols-2` | 4 KPI квадратом 2×2 |
| `grid-3col` | `grid grid-cols-3` | 6 KPI сеткой 2×3 |

В Settings — SVG-превью каждой раскладки + клик-выбор.

## Hooks pattern (важно)

Каждая ячейка — отдельный `<KpiCellRender>` компонент, который вызывает **3 `useCashflowKpiLite` хука unconditionally** (для `income`, `expense`, `balance`), а потом выбирает нужный в зависимости от `cell.metric`. Это даёт стабильный порядок hooks (никаких условных вызовов внутри одного компонента).

Минус: лишние fetch для метрик которые не нужны. Плюс: один component, простая логика, легко расширять. На счёт оптимизации — `useCashflowKpiLite` cache'ит по `cacheKey` (period+source+metric), так что одинаковые ячейки переиспользуют ответ.

## Publishing values

`kpi.grid` публикует свои значения в `BlockValuesContext`, чтобы другие блоки (excel.cell / computed / chart) могли биндиться на конкретные ячейки:

```
cells.{cellId}.value   → число
cells.{cellId}.label   → строка (label или дефолт метрики)
__money                 → "cells.c1.value,cells.c2.value" (только rub)
label                   → config.title
value                   → cells[0].value (для удобства @block-id без поля)
```

Пример bindings из `excel.cell`:
```
=@my-kpi-grid.cells.c1.value + @my-kpi-grid.cells.c2.value
```

## Presets

В `AddBlockDialog` → секция «Cashflow быстро»:

1. **«KPI-сетка: Доходы / Расходы / Баланс»** — row, 3 ячейки, наследуют period+source.
2. **«KPI-сетка: Месяцы»** — row, 3 ячейки с разными periodOverride (mtd / 14d / 30d).
3. **«KPI-сетка: Финансовая панель 2×2»** — grid-2col, 4 ячейки (включая count операций).

## Override patterns

```typescript
// Ячейка наследует period+source со страницы:
{ id: 'c1', metric: 'income', format: 'rub' }
// periodOverride undefined → global. sourceOverride undefined → global.

// Ячейка фиксирует свой период (например «последние 30 дней»):
{ id: 'c2', metric: 'income', format: 'rub',
  periodOverride: { preset: '30d', customFrom: null, customTo: null } }

// Ячейка фильтрует на конкретный источник «банк»:
{ id: 'c3', metric: 'expense', format: 'rub', sourceOverride: 'bank' }

// Ячейка фильтрует на «все источники» (явный override игнорящий global):
{ id: 'c4', metric: 'income', format: 'rub', sourceOverride: null }
```

В Settings UI это выглядит как toggle «Локальный / Использовать глобальный» рядом с каждым фильтром.

## Density

| density | Поведение |
|---|---|
| `xs` | Только число (без icon / label / badge). |
| `sm` | + label + icon, без delta badge. |
| `md+` | Полный вид: label, value, delta % vs previous. |

## Сравнение с альтернативами

| Подход | Когда |
|---|---|
| `stat.income` (legacy) | Не нужно. Используйте preset через excel.cell или kpi.grid. |
| `excel.cell` + preset | Одна ячейка, простая формула, нужна гибкость и связи с другими блоками. |
| `kpi.grid` | 2–6 связанных KPI в одном месте, общий заголовок, разные периоды/источники. |

## File map

- `src/lib/blocks/catalog/kpi-grid.tsx` — BlockDef + render
- `src/lib/blocks/catalog/kpi-grid-settings.tsx` — Settings form (DnD list, inline edit)
- `src/lib/blocks/virtual-sources.tsx` — `useCashflowKpiLite` lite-hook + virtual block IDs
- `src/lib/blocks/registry.ts` — `BLOCK_PRESETS` (3 kpi.grid presets)
- `scripts/test-kpi-grid-config.ts` — unit tests для schema
