# PAGE_PERIODS — единая система периодов (v0.23)

Открытая платформа открытых финансов использует **двухслойную модель периода** для блоков:

1. **Page-level period** — единая «мастер-настройка» страницы (sticky `PagePeriodHeader` сверху). Изначально хранится в `localStorage` по ключу `page:${pageKey}:period:v1` и доступна через `PagePeriodContext` (`usePagePeriod`).
2. **Block-level override** — собственный период блока. Хранится либо в `localStorage` по ключу `block:${instanceId}:period:v2`, либо в layout `config.defaultPeriodOverride` (для блоков, где период должен быть виден другим пользователям дашборда).

Эффективный период вычисляется по правилу:

```
effective = override (если задан) → page-level (иначе)
```

UI обозначает блоки с override-режимом lock-badge `<Lock /> свой`.

---

## Подключение нового блока к системе периодов

### 1. Импорт хука

```typescript
import { useBlockPeriod } from '@/lib/blocks/use-block-period';
```

### 2. Вызов в `Render`-функции блока

```typescript
const {
  period,                // effective PagePeriodValue (для fetch / display)
  source,                // 'global' | 'override'
  override,              // PeriodOverride | null
  setOverride,           // (next: PeriodOverride | null) => void
  resetToGlobal,         // shortcut: setOverride(null)
  isOverride,            // shortcut: override !== null
} = useBlockPeriod({
  instanceId: instance.id,
  configOverride: cfg.defaultPeriodOverride ?? null,   // seed из layout config (опционально)
  onConfigChange: (next) =>                            // sync обратно в config (опционально)
    onConfigChange?.({ ...cfg, defaultPeriodOverride: next }),
  defaultMode: 'global',                               // блок по дефолту наследует global
});
```

### 3. Использовать `period` для fetch

```typescript
const params = new URLSearchParams({
  preset: period.preset,
  ...(period.customFrom && { from: period.customFrom }),
  ...(period.customTo && { to: period.customTo }),
});
const res = await fetch(`/api/something?${params}`);
```

Зависимости `useEffect`: `[period.preset, period.customFrom, period.customTo]`.

### 4. Inline UI: PeriodPicker + lock-badge

```tsx
<PeriodPicker
  value={{ preset: period.preset, customFrom: period.customFrom, customTo: period.customTo }}
  onChange={(v) =>
    setOverride({
      preset: v.preset,
      customFrom: v.customFrom ?? null,
      customTo: v.customTo ?? null,
    })
  }
  compact
/>
{isOverride && (
  <button
    type="button"
    onClick={resetToGlobal}
    className="inline-flex h-5 items-center gap-0.5 rounded bg-amber-50 px-1.5 text-[10px] ..."
    title="Локальный период этого блока. Клик — вернуться к периоду страницы."
  >
    <Lock className="h-2.5 w-2.5" />
    свой
  </button>
)}
```

### 5. Регистрация в `BlockDef.usesPeriod`

В `src/lib/blocks/registry.ts` в `BLOCK_META` добавьте `usesPeriod: true` для своего блока. Это нужно, чтобы:

- `PagePeriodHeader` автоматически появлялся на странице при наличии вашего блока (через `pageHasGlobalBoundBlocks`).
- Будущие тулзы могли быстро узнать какие блоки используют период.

---

## Mass-reset: «Сбросить локальные периоды (N)»

`useBlockPeriod` автоматически регистрирует блок в `PagePeriodContext.registerBlock(...)`. Когда блок в override-режиме (`override !== null`) — он попадает в counter `countOverridden()`. `PagePeriodHeader` показывает кнопку **«Сбросить локальные (N)»**, по клику вызывается `resetAllOverrides()` — все блоки получают `setOverride(null)` синхронно.

`unregisterBlock(instanceId)` вызывается автоматически при unmount.

---

## Архитектура (упрощённая диаграмма)

```mermaid
flowchart TB
  subgraph page ["Page"]
    Provider["PagePeriodProvider (pageKey)"]
    Header["PagePeriodHeader<br/>master picker + warning + reset btn"]
    Provider --> Header
  end

  subgraph block ["Block component"]
    UBP["useBlockPeriod"]
    UBP --> persisted["usePersistedPeriodWithGlobal<br/>(localStorage block-level)"]
    UBP --> effective["useEffectivePeriod<br/>(merge с PagePeriodContext)"]
    UBP --> registry["PagePeriodContext.registerBlock"]
  end

  Provider <-- effective
  Header <-- registry

  UBP --> API["API: /api/...?preset=...&from=...&to=..."]
```

---

## Migration cheat-sheet (для существующих блоков)

| Старый код                             | Новый код                                              |
|----------------------------------------|--------------------------------------------------------|
| `usePersistedPeriodValue({ initial })` | `useBlockPeriod({ instanceId, defaultMode: 'global', configOverride })` |
| `period.preset`/`.customFrom`/`.customTo` | `period.preset`/`.customFrom`/`.customTo`              |
| `setValue(v)`                          | `setOverride({ preset, customFrom, customTo })`        |
| —                                      | `isOverride && <LockBadge />` для UI                   |

---

## Что НЕ изменилось

- `PagePeriodContext` API основной (`value`, `setValue`, `reset`) — обратная совместимость.
- `useEffectivePeriod(instanceId, override)` всё ещё работает напрямую — для блоков, которые управляют override'ом сами (например `kpi.grid` с per-cell override).
- `usePersistedPeriod` / `usePersistedPeriodValue` / `usePersistedPeriodWithGlobal` — публичные, но новый код должен идти через `useBlockPeriod`.

---

## История

- **v0.23** — введён `useBlockPeriod`, registry + mass-reset, warning chip, `usesPeriod` flag.
- **v0.22.x** — `usePersistedPeriodValue` (local), `usePersistedPeriodWithGlobal` (hybrid).
- **v0.20.x** — введён `PagePeriodProvider`.
