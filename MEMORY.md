# MEMORY.md — Open Finance

> Compact handoff проекта. Читается **вторым** шагом bootstrap'а (после `START.md`). Цель — ~5K токенов, полный рабочий контекст без reverse-engineering.
> Историю версий смотри в `docs/memory-archive/` (читать **только по запросу**, не на старте).

## Bootstrap новой сессии (триггер «загрузи контекст Open Finance»)

1. **`START.md`** — карта проекта, жёсткие правила, маршрутизация задач (~3K токенов).
2. **`MEMORY.md`** (этот файл) — текущее состояние, ключевые файлы, активные грабли (~5K токенов).
3. **`git -C /Users/firay/open-finance/open-finance log --oneline -20`** — последние коммиты (~0.5K токенов).
4. (Опц.) **`mempalace search "..." --wing open-finance`** — точечно для исторических вопросов («когда мы перешли с X на Y»). См. `docs/MEMPALACE_RUNBOOK.md`.

После 3 шагов = ~8-9K токенов и можно работать любой сложности. Дальше — **только релевантное конкретной задаче** (см. таблицу маршрутизации в `START.md`).

## Что НЕ загружать по умолчанию

- `CHANGELOG.md` (2981 строк) — только при вопросах про историю; иначе `git log`.
- `PLAN.md` (1427 строк) — только при стратегических вопросах; читать через `Read offset+limit`.
- `docs/memory-archive/*.md` — детальные нарративы по версиям v0.10-v0.22. Грузить только когда нужны детали конкретной миграции/фикса.
- `docs/*.md` — каждый файл подгружается по таблице маршрутизации.
- `mempalace wake-up --wing open-finance` — индекс содержит и устаревшие версии (Tauri-only, Prisma, Python sidecar). Использовать `mempalace search` точечно.

## Перед работой с библиотеками

Context7: `mcp0_resolve-library-id` → `mcp0_query-docs`. Не более 3 вызовов на задачу.

## После значимых изменений

1. `pnpm build` — должен пройти.
2. Обновить `MEMORY.md` (если изменились ключевые файлы/инварианты/грабли).
3. Добавить запись в `CHANGELOG.md`.
4. Дать пользователю git-команды (`git add -A && git commit -m "..." && git push origin main`) — **не выполнять самому**.
5. (Опц.) Синхронизировать sources: `./scripts/sync-mempalace.sh` (если mempalace работает).

## Идентичность проекта

**Open Finance** — AI-первая модульная финансовая платформа для предпринимателей РФ (селлеры OZON/WB/ЯМ, ИП, фрилансеры, малый бизнес).

- **Сейчас:** Next.js 15 SaaS.
- **Phase 2:** Tauri 2.0 desktop.
- **Phase 3:** React Native + Expo mobile.
- **Главная идея:** почти каждая страница = настраиваемый **BlockGrid** (Lego из блоков). Новая фича обычно = новый block type в `src/lib/blocks/catalog/`, а не статичная страница.
- **Источник правды версии:** `CHANGELOG.md` + `git log` (`package.json` остался на `0.5.0`, не используется). Текущая версия — **v0.39.0** (2026-06-02). UI читает версию через `src/lib/version.ts` (`APP_VERSION`), значение инжектируется в build-time из `CHANGELOG.md` через `next.config.mjs` → `env.NEXT_PUBLIC_APP_VERSION`.

## Жёсткие правила

- **Package manager:** только `pnpm`. Не `npm`/`yarn`.
- **ORM:** только Drizzle. **Не Prisma.**
- **AI SDK:** своя обёртка `src/lib/ai/providers/`. **Не Vercel AI SDK.**
- **Multi-tenant:** `tenant_id` в каждой таблице и каждом DB-запросе.
- **AI-мутации:** только через Tools Layer (`src/lib/ai/tools/`). Не прямой SQL из AI.
- **Git:** не делать `git add/commit/push` — давать команды пользователю.
- **БД-миграции:** не запускать автоматически — давать команды.
- **Секреты:** не коммитить `.env`, ключи, пароли (см. `docs/SECURITY.md`).
- **Новые файлы:** начинать с `// PURPOSE: ...`.
- **Импорты:** явные, без `import * as X`.
- **Структура:** плоско в `src/modules/{name}/`, не `src/features/x/y/z`.
- **UI:** не использовать системные `alert/confirm/prompt` — только Dialog/AlertDialog.

## Актуальный стек

| Слой | Технология |
|---|---|
| Frontend/API | Next.js 15 App Router, React 18, TypeScript, RSC |
| UI | Tailwind, shadcn/ui/Radix, Lucide, next-themes (light) |
| State | Zustand + TanStack Query |
| DB SaaS | PostgreSQL 16 + pgvector, Drizzle ORM |
| Cache/Queue | Redis 7 + BullMQ |
| AI | Ollama local + OpenAI-compat (Claude/OpenRouter/VseGPT/Custom) через свою обёртку |
| AI streaming | NDJSON from `/api/ai/chat` |
| Spreadsheet | `fast-formula-parser` + custom |
| Charts | Recharts |
| Grid | `react-grid-layout` |
| DnD | `@dnd-kit/*` |
| Node | `>=20`, package manager `pnpm@9.12.3` |

## Структура проекта

```
src/
├── app/                  Next.js App Router + API routes
│   ├── (app)/            authenticated shell
│   ├── (auth)/           login/register/forgot
│   └── api/              auth, blocks, cashflow, inbox, ai, boards, marketplaces, currency
├── components/
│   ├── blocks/           BlockGrid shell, chrome, dialogs, relations overlay
│   ├── micro-agent/      AI micro-agent dialog
│   ├── unit-economics/   калькуляторы, sync UI, biding picker
│   ├── marketplaces/     OzonSyncDialog, GlobalSyncIndicator
│   └── ui/               shadcn primitives
├── lib/
│   ├── ai/               providers, micro-agent, tools, vision, memory (TODO)
│   ├── blocks/           types, registry, catalog/, values, relations, source-binding
│   ├── boards/           Boards CRUD
│   ├── currency/         CBR fetch, queries
│   ├── db/               Drizzle client/schema
│   ├── inbox/            IMAP, MIME, crypto, queries
│   ├── marketplaces/     Ozon Seller API + Performance API
│   ├── unit-economics/   tariffs, calculate, bindings, store-formula
│   └── env.ts            typed env
├── modules/              business modules (cashflow, inbox, communications)
drizzle/init/             manual SQL: pgvector, boards, inbox, unit-economics, currency, marketplaces, analytics, sku-backfill
docs/memory-archive/      исторические разделы MEMORY.md (по запросу)
```

## Block-Grid — фундамент UI

Каждая страница приложения должна строиться через `<BlockGrid />`, а не статичный layout.

### Ключевые файлы
- `src/lib/blocks/types.ts` — `BlockDef`, `BlockInstance`, `BlockDependencies`, `BlockAppearance`, `PageLayout`.
- `src/lib/blocks/registry.ts` — `ALL_BLOCKS`, `DEFAULT_LAYOUTS`, `BLOCK_META` (iconName для RSC), `BLOCK_PRESETS`.
- `src/components/blocks/block-grid.tsx` — drag/resize/save, переключатель `viewMode` Грид↔Карта (кнопка `Карта`), AI dialog, auto-mount providers.
- `src/components/blocks/block-mindmap.tsx` (v0.30→v0.31.1) — режим «Карта» (React Flow `@xyflow/react` v12): узлы/рёбра из `collectBlockRelationEdges`, controlled nodes, `onNodeDragStop`→persist, snap-to-grid по умолчанию (`ControlButton`-магнит), призрачные узлы соседей + пунктирные edges, тёмный canvas. **v0.31.1:** seed-and-persist раскладки при первом входе (`seededRef`, фиксирует позиции блоков без `mindmap` через `onMindmapMove` → нет разлёта «в кучу»); `sizeOf` учитывает collapsed/expanded размер. Грузится лениво через `next/dynamic(ssr:false)`.
- `src/components/blocks/block-node.tsx` (v0.31) — узел карты: collapsed → кастомный `MapPreview` (read-only), expanded → живой блок в `expandedSize` per-type; `HiddenPublisher` скрыто монтирует data-блок offscreen чтобы опубликовать метрику в store. `dragHandle: '.block-node-drag-handle'`, `MindmapContext` прокидывает handlers.
- `src/components/blocks/map-previews/` (v0.31, доработан v0.31.1) — `primitives.tsx` (Metric/MultiMetric/MiniTable/ListSummary/Status/IconTitle/TextExcerpt; Metric поддерживает sparkline через StatCard) + `index.tsx` реестр `MAP_PREVIEWS`. Билдеры: `buildMetric({money,sparkField,...})`, `buildChart` (sparkline из `__spark`), `buildMulti`, `buildGeneric({moneyScale})`. **Деньги per-block:** дефолт КОПЕЙКИ→рубли (`KOPECK_SCALE=0.01`); исключения (уже рубли): `unit.ozon-top-ads`/`-search-phrases`/`-abc`. Money-флаг читается из `__money` (`isMoneyField`). `excel.cell` НИКОГДА не показывает сырую формулу `=…`. `custom.data` — live-агрегаты (строки+колонки), фолбэк config-таблица.
- **`__spark` (мини-графики карты):** чарт/KPI-блоки публикуют CSV-серию через `serializeSpark(values, max=40)` (`lib/blocks/values.tsx`); превью рисует area-спарклайн. Источники: `unit-ozon-chart` (revenueRub по точкам), `chart-cashflow` (income−expense), `unit-ozon-kpi` (sparklineRevenue). `unit.ozon-analytics` — без серии (только per-SKU rows), показывает money-метрику.
- `src/components/blocks/ghost-node.tsx` (v0.31) — призрачная карточка соседнего блока из другого раздела (полупрозрачная, клик → `router.push(pageHref)`). Данные из `CrossPageLink` (добавлен `type`).
- `src/lib/blocks/mindmap-layout.ts` (v0.30→v0.31) — `blockMindmapPosition`/`isBlockCollapsed`/`initialMindmapPosition` + `computeCompactLayout`/`computeInitialPositions` (компактная раскладка рядами) + `snapTo`/`MINDMAP_SNAP=16`.
- `src/components/blocks/block-relations-overlay.tsx` — СТАРЫЙ SVG-overlay связей, **больше не используется** (заменён картой); оставлен ради reuse-логики (цвета рёбер, cross-page popover).
- `src/components/blocks/block-grid.css` — координатная сетка-фон (1:1 с RGL-cells), resize handle CSS-only через `:has([data-resize-hotzone]:hover)`.
- `src/components/blocks/block-chrome.tsx` — wrapper, hover controls, settings/delete/AI, **рамка через absolute-overlay z-20** (не `boxShadow inset`).
- `src/components/blocks/block-settings-dialog.tsx` — 5 табов (params → links → style → io → ai).
- `src/components/blocks/settings/import-export-tab.tsx` — UI вкладки «Импорт / Экспорт» (JSON всегда + XLSX для табличных).
- `src/lib/blocks/import-export/` — модуль I/O: `types`, `json-adapter` (универсальный), `refs-scrubber` (зачистка cross-block ссылок), `xlsx-utils` (sheetjs helpers с `cellFormula: true`), `registry` (`getImportExportAdapter`/`supportsXlsx`), `adapters/{sheet,custom-data,kpi-grid,excel-cell,my-store-table}.ts`.
- `src/app/api/blocks/layout/[pageKey]/route.ts` — persist layout.
- `src/app/api/blocks/sources/route.ts` — sources для `@связать`, Sheet formula evaluation, server-side aggregates для cross-page bindings.
- `src/app/api/blocks/relations/route.ts` — cross-page outgoing detection (lightweight).
- `src/lib/blocks/catalog/markdown-note.tsx` (v0.28.0) — блок `note.markdown`: два режима (Текст WYSIWYG / MD raw) на одном `config.content`, счётчики, импорт/экспорт `.md`/`.txt`, публикует `chars/words/lines/tokens/title/updatedAt`. Ввод дебаунсится (250ms counters / 700ms commit + flush на blur).
- `src/components/blocks/markdown/{InitializedMDXEditor,ForwardRefEditor}.tsx` (v0.28.0) — обёртка MDXEditor v4 по App Router паттерну: `ForwardRefEditor` = `next/dynamic(ssr:false)` + forwardRef → редактор (~850 kB) в async-чанке; режим через `diffSourcePlugin` + controlled bridge на `viewMode$` (без remount). CSS — `globals.css` (`.note-md-editor`, тёмная тема через класс `dark-theme`).

### Ключевые инварианты
- Grid: 12 колонок, `rowHeight=40`, `margin=[10,10]`.
- `BlockDef` обязан иметь `defaultSize`, `minSize`, `iconName` (для RSC), `appearance` respect.
- Адаптивный render через `useBlockDensity()` (`xs/sm/md/lg`).
- Publishing значений через `useBlockValuePublisher(instance.id, {value, __money, __labels})` — для `@связать`.
- **`useBlockValuePublisher` ВЫШЕ early-returns** (rules-of-hooks).
- **`useMemo`/`useState` ВЫШЕ early-returns** в Block-Render компонентах.
- **Не использовать `sanitizeBlocks` на сервере** — client-only catalog пуст в server bundle.
- **`BlockDef` НЕЛЬЗЯ передавать через RSC props** — catalog файлы `'use client'` → opaque proxy. Использовать `b.iconName` (string из `BLOCK_META`), не `b.icon.displayName`.
- **`DndContext` обязан иметь `id={useId()}`** при >1 на странице (иначе hydration mismatch через `aria-describedby`).
- **Позиция тулбара блока (v0.28.1):** `ИИ`+`Настройки` — в **левом нижнем** углу (`block-toolbar` на `bottom-1 left-1`), `data-toolbar-hotzone` тоже `bottom-0 left-0`. `X` (удалить, edit-mode only) — в **правом верхнем** углу отдельным `block-toolbar`. Шапки блоков (refresh/sync/mode-toggle) кладём **справа-сверху** — там тулбар чрома больше не пересекается. Класс `block-toolbar-shift` удалён (не использовать).
- **Источник правды для cross-page связей** — `block.dependencies.sources` + `@`-refs из config (`collectRefsFromConfig` рекурсивно).
- **Раскладка карты — отдельное поле `BlockInstance.mindmap { x, y, collapsed }`**, независимо от грид-полей `x/y/w/h`. ОБЯЗАТЕЛЬНО дублировать в zod `BlockInstanceSchema` (`api/blocks/layout/[pageKey]`), иначе PUT вырежет координаты при jsonb round-trip. Координаты canvas (float, могут быть < 0).

### Текущий каталог блоков

**Cashflow** (`stat.income`, `stat.expense`, `stat.balance` помечены `tags:['legacy']`): `stat.income`, `stat.expense`, `stat.balance`, `stat.custom`, `cashflow.top-categories`, `cashflow.transactions`, `chart.cashflow`, **`kpi.grid`** (v0.20.0).

**Generic**: `sheet`, `excel.cell`, `custom.data`, `navigate.card`, `computed.sum`, `ai.micro-agent`, **`note.markdown`** (v0.28.0).

**Inbox**: `inbox.channel-feed`, **`inbox.dashboard`** (v0.19.0).

**Unit Economics**: `unit.ozon-calculator`, `unit.ozon-multi-table`, `unit.yandex-calculator`, `unit.my-store-table`.

**Ozon Analytics** (v0.17.2+): `unit.ozon-analytics`, `unit.ozon-kpi`, `unit.ozon-chart`, `unit.ozon-top-ads`, `unit.ozon-stock-clusters`, `unit.ozon-warehouse-clusters`, `unit.ozon-search-phrases`, `unit.ozon-campaigns`, `unit.ozon-data-health`, `unit.ozon-abc`, `unit.ozon-ai-insights`.

**Финансы**: `currency.rates`.

## Реализованные страницы

- **`/dashboard`** — BlockGrid с KPI и navigation cards.
- **`/cashflow`** — CRUD/import транзакций, KPI, top categories, chart.
- **`/inbox`** — BlockGrid с двумя `inbox.channel-feed` блоками.
- **`/boards`**, **`/boards/[boardId]`** — персональные доски, `pageKey = board-{boardId}`.
- **`/unit-economics`** — 4 default-вкладки + custom через `unit_economics_tabs` (v0.22.0).
- **`/marketplace`** — каталог всех блоков (browse-only, кнопки disabled).
- **`/marketplaces/ozon`** — header `SyncAllButton` → `OzonSyncDialog` (v0.22.2).
- **`/settings`** — visibility toggles, форматирование, разделы.
- **`/settings/integrations`** — подключение Ozon Seller API, тогглы sync, тест/sync/история job'ов + AccountCard «Догрузить» через `OzonSyncDialog` (v0.22.2).
- **`/admin/ai/{local-models,providers,system-prompt}`** — admin AI.
- **`/reset-password`** — Suspense + useSearchParams.

## Активные грабли (последние версии v0.21-v0.25)

> Исторические грабли (v0.10-v0.20) — в `docs/memory-archive/`.

- **Excel-режим блока «Мой магазин» (v0.39.0)** — `src/lib/blocks/catalog/unit-my-store-table.tsx`. Тоггл `config.excelMode` (кнопка `Excel` в шапке, персистится) включает sheet-style редактирование любой ячейки — портирован проверенный UX блока «Данные» (custom.data v0.23.x). **Ключевой контракт: per-cell формула = строковое значение `row.values[colId]`, начинающееся с `=`** (тот же `cell.v`-контракт, что и в custom.data; XLSX-адаптер `import-export/adapters/my-store-table.ts` уже её сохраняет/читает — раньше она НЕ вычислялась, показывала 0). Переменные — id колонок ТОЙ ЖЕ строки + `vatPct`/`taxRatePct`, движок — общий `evalRowFormulas` (не A1, как у custom.data — My-Store-формулы row-relative по id, поэтому drag-fill копирует строку формулы как есть). **`computeRowValues`** (единый helper строки/агрегатов) детектит `=`-строки в не-формульных колонках → `effectiveFormulas = {...formulasMap, ...cellFormulas}` per-row. **`isCellFormulaValue` НЕ type-guard** (`: boolean`, не `v is string`) — иначе TS сужал false-ветку до `number` и ломал `raw===''` для text-значений. **Единый `EditSession`** (один `draft` между inline-input ячейки и formula bar) + `dirty`-флаг (commit пишет, только если был ввод → проход Tab'ом не затирает привязку пустым draft). Паттерн фокуса/каретки 1:1 с custom.data: `cardRef`-smart-blur (focus внутри блока → не коммитим; picker открыт → `pickerCellRef.current` → не коммитим), `useLayoutEffect`+`pendingCaretRef` (восстановление каретки после programmatic-вставки), focus-эффект по `navFocusRef`+`data-cell-input="rowId|colId"` (scroll-into-view для виртуализации, rAF-ретрай пока строка не смонтируется). **Перф сохранён:** активная ячейка и formula bar — единственные, кто ре-рендерится на keystroke (`activeColId`/`sessionDraft` = null у неактивных строк → `React.memo` бейлит); все session-колбэки стабильны (deps на стабильных колбэках). **Редактируются ЛЮБЫЕ ячейки, включая формульные КОЛОНКИ** (это была главная цель — импортированные формульные колонки): клик по формульной ячейке показывает действующую `col.formula` и даёт **per-cell override** (формула/литерал ТОЛЬКО для этой строки) в `row.values[colId]`; пустой ввод или совпадение с `col.formula` → override снимается. `computeRowValues`: `=`-override → `cellFormulas` (перекрывает column-formula в `effectiveFormulas`); литерал-override на формульной колонке → `manual` + удаление её формулы из `effectiveFormulas` (литерал побеждает); зависимости считаются через граф `evalRowFormulas` (зависимые колонки строки пересчитываются от override). **Обычный режим без изменений**: ячейка-формула read-only (computed + `fx`); формульные колонки column-driven. **БД:** override персистится в `row.values` (jsonb) как обычная строка/число — без миграций; XLSX-экспорт-адаптер отдаёт override, а не общую `col.formula`. Nav: Enter↓/Shift+Enter↑/Tab→/Shift+Tab←/Esc (включает identity + формульные колонки). **Грабли:** (1) `isCellFormulaValue` НЕ type-guard; (2) при привязке активной ячейки через picker — обязательно `setSession(null)` в onSave (иначе commit перетёр бы свежую привязку); (3) привязка (`привязать`) скрыта для identity и формульных колонок (`activeAllowsBinding`).
- **Перформанс блока «Мой магазин» + Excel-протяжка (v0.38.0)** — `src/lib/blocks/catalog/unit-my-store-table.tsx`. Лаги на 100+ строках были от: (1) рендера ВСЕХ строк, (2) per-cell подписки `LinkableNumberCell` на стор (`useAllBlockValuesFlat` пересобирает всю мапу в КАЖДОЙ ячейке), (3) `computedRows` на весь `liveValues` (пересчёт всех формул на любой publish), (4) отсутствия мемоизации строк. **Фиксы (паттерн, переиспользовать в других тяжёлых таблицах):** ① **виртуализация** — ручное окно по `scrollTop` (фикс. `ROW_H=30`, порог `VIRTUALIZE_THRESHOLD=60`), спейсеры сверху/снизу, sticky-шапка/«Итого» вне окна; ② **`React.memo` строки** `MyStoreRow` — сама считает значения через `computeRowValues` (единый helper для строки и агрегатов), ре-рендер только при смене своего `row`; ③ **стабильные row-колбэки** через `configRef`/`onConfigChangeRef` (persist + updateRow* читают `configRef.current`, deps `[persist]`); ④ **узкая зависимость от стора** — `boundSig` (сигнатура разрешённых block_ref-привязок) → `boundByRow` (deps `[boundSig]`, eslint-disable) → `computedRows`; чужой publish/печать не пересчитывают таблицу; ⑤ **dumb-ячейка `MyStoreNumberCell`** (НЕ подписывается на стор; значение/формат пропсами) с **локальным `draft` (commit на blur/Enter)** → печать не дёргает persist/ре-рендер; модалка привязки (`UnitCellBindingDialog`) поднята в блок (одна, через `pickerCell`). **Drag-fill (task 2):** fill-хэндл (`data-fill-handle`) в углу number/text ячеек, `data-fill-row={absIdx}` на строке, **document-level pointer listeners** (не pointer-capture — переживают авто-скролл/виртуализацию), копирует значение+привязку по видимому порядку → `persist({rows})`. Формульные/identity — без хэндла. Bulk-fill в `ColumnEditDialog` остаётся для «все строки». **Грабля:** dumb-ячейка должна флашить `draft` на unmount (строка ушла из окна) — иначе теряется ввод.
- **Грабли модалок на `DialogContent` (`display:grid`) (v0.38.0)** — у grid-item дефолт `min-width:auto` → не даёт `truncate`/`overflow` сжиматься ниже min-content; длинный неразрывный токен (формула, артикул) распирает модалку. **Правило:** корневым контейнерам шагов/секций внутри `DialogContent` ставить `min-w-0`. Применено в `smart-import-dialog.tsx`.
- **Глобальный «AI Анализ раздела» v2 (v0.34.0)** — кнопка `SectionAiButton` (шапки cashflow/dashboard/inbox/marketplaces-ozon/unit-economics/boards) → `SectionAiDialog` → `POST /api/ai/analyze-section`. **ИИ видит контент блоков:** кнопка живёт ВНЕ `BlockValuesProvider`, поэтому live-значения собирает `PageSnapshotPublisher` (`src/components/blocks/page-snapshot-publisher.tsx`, монтируется ВНУТРИ провайдера в `block-grid.tsx`) → внешний store `src/lib/blocks/page-snapshot.ts` (Map по pageKey) → модалка читает на open. **Конвенция `__aiContext`:** блок может опубликовать богатый текст для ИИ в `useBlockValuePublisher` (служебное `__`-поле, скрыто от пикеров); Ozon KPI/Analytics/AI-insights его публикуют (= «глубокие данные Ozon»). **Токенайзер:** `src/lib/ai/tokenizer.ts` (`useTokenizer`) — точный `js-tiktoken` (o200k_base, lazy `import('js-tiktoken/lite')` + `import('js-tiktoken/ranks/o200k_base')`, client-only) + эвристика-fallback. **Общая логика:** `src/lib/ai/section-insights.ts` (`SectionInsight`/`SectionReport`, `assembleSectionContext` — ЕДИНАЯ сборка для клиент-счётчика и сервер-промпта, `extractSectionReport`, `SECTION_TEMPLATES`, `filterSubgraph`, zod-схемы). **БД:** `section_ai_reports` (`src/lib/db/schema/section-ai-reports.ts`, SQL `drizzle/init/13-section-ai-reports.sql`, зарегистрирована в `schema/index.ts`), лимит 10/раздел, queries `src/lib/ai/section-reports-queries.ts`, API `/api/ai/section-reports[/[reportId]]`. **UI:** резюме + `InsightCard` (обобщён до `InsightCardData`) с tabs по kind, шаблоны-табы, чекбоксы «добавить отчёт в контекст», счётчик токенов/символов, сохранение с AlertDialog-перезаписью. **Грабли:** `js-tiktoken` ранги тянуть динамически (client-only) — не в initial bundle; счётчик точен для OpenAI-совместимых, для Yandex/GigaChat/Ollama «≈».
- **«AI Анализ раздела» — кросс-раздельный контекст + история (v0.35.0)** — кнопка **«Контекст»** (`Layers`) в модалке → мини-модалка `src/components/blocks/section-context-dialog.tsx` (data-driven: `sources/loading/error` пропсами, родитель `SectionAiDialog` делает ОДИН fetch). Список разделов из `GET /api/ai/context-sources` (`src/lib/ai/context-sources-queries.ts` → `listSectionContextSources`: `block_layouts` ∪ `section_ai_reports` ∪ текущий; config блоков из `loadLayout` + последний отчёт). Каждый раздел — `Switch` + превью токенов; **умный режим** `resolveMode`: текущий/есть отчёт → `report`, иначе `blocks`. Резолв для промпта — серверный `resolveExternalSources` (тело из БД, клиент шлёт только `{pageKey, mode}` → не доверяем). `assembleSectionContext` расширен `extraSections` (`buildExternalSourcesContext`). Labels — `src/lib/ai/page-labels.ts` (`resolvePageLabel`). **UI:** убран scope-тоггл (`scope`/`filterSubgraph` больше не в модалке), чекбоксы → `Switch`, история «ИИ-отчёты (N)» раскрываемый модуль (последний раскрыт по умолчанию через `openReports` init-effect, остальные сворачиваемы, как в блоке «AI инсайты»). `analyze-section` принимает `externalSources` вместо `includeReportIds`. **Грабли:** другие разделы не смонтированы → их live-значения недоступны на клиенте, поэтому ТОЛЬКО серверный резолв из БД; паритет токенов держится единым `assembleSectionContext` + одинаковыми данными (context-sources ↔ resolveExternalSources).
- **«AI Анализ блока» (ИИ Микроагент v2) (v0.36.0)** — кнопка блока (`onOpenAi` в `block-grid.tsx` → `MicroAgentDialog`) теперь shell с двумя режимами: `BlockAnalysisPanel` (анализ-отчёт, дефолт) + `BlockMutatePanel` (прежняя мутация, вынесена без изменений). **Анализ:** `POST /api/ai/analyze-block` (зеркало analyze-section, промпт = `getBlockSkill(blockType)` + строгий JSON-контракт), целевой блок берётся из `getPageSnapshot(pageKey)` по `blockId`. **БД:** `block_ai_reports` (`src/lib/db/schema/block-ai-reports.ts`, SQL `drizzle/init/14-block-ai-reports.sql`, зарегистрирована в `schema/index.ts`), скоуп tenant×user×pageKey×blockId, лимит 10/блок, queries `src/lib/ai/block-reports-queries.ts` (+`getLatestBlockReportsForPage` — карта blockId→последний отчёт), API `/api/ai/block-reports[/[reportId]]`. **Контекст проекта:** `BlockContextDialog` (пикер блоков всех разделов), endpoint `/api/ai/block-context-sources` + `src/lib/ai/block-context-sources-queries.ts` (`listBlockContextSources`/`resolveBlockContextSelections`). Грабля: блоки текущего раздела доверяем live-снапшотом клиента (`liveContextBlocks`), блоки других разделов — ТОЛЬКО ref-ы `{pageKey,blockId,mode}` → резолв из БД. **«Все блоки»:** `AnalyzeAllBlocksDialog` (внутри `SectionAiButton`) — concurrency-пул 3, прогон analyze-block по значимым блокам (skip `ai.micro-agent`/`navigate.card`), сохранение с `overwriteOldest:true`. **Анализ раздела (п.4):** `analyze-section` принимает `blockSource: 'reports'|'raw'` (дефолт reports) → `applyBlockReports` подменяет сырой контент блока на текст его последнего отчёта; паритет токенов через общий `GET /api/ai/block-reports?pageKey=`. Общие хелперы — в `section-insights.ts` (`assembleBlockContext`, `buildTargetBlockContext`, `applyBlockReports`, `BLOCK_ANALYSIS_TEMPLATES`). Грабля: панели в shell `key={blockId}` — иначе результат прошлого блока «прилипает» при переоткрытии.
- **Ozon AI инсайты v2: per-SKU + tabs + markdown (v0.33.0)** — `unit-ozon-ai-insights-types.ts`: тип `Insight` расширен опц. `kind` (action/observation/opportunity/info — для tabs), `sku`/`productName`/`tags`/`recommendation` (per-SKU, как yoolip). `generatePerSkuInsights` (рекомендации по товарам), `generateAllInsights` (агрегат+per-SKU), `buildInsightTabs`/`filterInsightsByTab`/`resolveInsightKind`. `InsightCard` (`ozon-insight-card.tsx`) — раскрываемая (заголовок+теги+метрика → описание+рекомендация). Блок: tabs-фильтр `Все/Действие/Наблюдение/Возможности/Инфо` (persist в config `insightTab`; fallback на 'all' если у tab 0 шт). **Markdown:** `src/components/unit-economics/inline-md.tsx` (`renderInlineMd`) рендерит `**bold**`/`*italic*` (ИИ часто оборачивает числа в `**`); применён в card/summary/reports; ИИ-промпт запрещает markdown в summary/description. `InsightSchema` (reports route) + `extractJson` (модалка) принимают новые опц. поля → backward-compatible со старыми отчётами в БД. **Грабли:** после удаления/переименования экспортов в catalog-блоках обязательно `rm -rf .next` перед билдом — иначе stale-chunk даёт «Element type is invalid: got undefined» на `/_not-found` и страницах через registry (command-palette).
- **Ozon sync: persist тогглов стейджей (v0.33.0)** — `ozon-sync-dialog.tsx` сохраняет выбор стейджей по-аккаунтно в `localStorage` (`of:ozon-sync-stages:<accountId>`), `manuallyEditedRef` блокирует сброс при смене пресета после ручной правки; ссылка «Сбросить по пресету» (`clearSavedStages`). SSR-safe: localStorage только в effect/handlers.
- **Ozon AI инсайты + ИИ-отчёты в БД (v0.32.0)** — блок `unit.ozon-ai-insights` переписан на раскрываемые модули. Pure-логика/типы (`Insight`, `generateInsights`, `computeInsightMetrics`, `summarizeAnalytics`, config-схема) вынесены в `src/lib/blocks/catalog/unit-ozon-ai-insights-types.ts` (НЕ `'use client'`, shared с server). Карточка инсайта — `src/components/unit-economics/ozon-insight-card.tsx`. ИИ-генерация: модалка `ozon-ai-insights-dialog.tsx` → `POST /api/marketplaces/ozon/ai-insights` (NDJSON-стрим, строгий JSON summary+insights; провайдер резолвится как в `analyze-section`). **История отчётов — в БД, не в config:** таблица `ozon_ai_insight_reports` (`src/lib/db/schema/ozon-ai-insights.ts`, SQL `drizzle/init/12-ozon-ai-insights.sql`), queries `src/lib/marketplaces/ozon/ai-insights-queries.ts`, **лимит 10 на блок** (tenant+user+block_id), при превышении `POST .../reports` отдаёт `409 {needsOverwrite, oldest}` → UI подтверждает перезапись старого. **Грабли:** типы из API-routes импортировать только `import type` (route-файлы server-only); rule-based логика держится в общем types-файле, чтобы и блок, и (потенциально) server её использовали; expandedModules/showMetrics в config, отчёты — в БД.
- **Ozon KPI compareMode (v0.32.0)** — `compareMode` ОБЯЗАН персиститься в config (`onConfigChange`), иначе сбрасывается на дефолт при ре-рендере. Дефолт теперь `week-ago`; добавлен `month-ago` (`shiftOzonQueryPeriodMonths`). В шапке — `DropdownSelect`, не нативный `<select>` (грабля пустой метки на macOS).
- **Ozon Analytics строка «Итог» (v0.32.0)** — `<tfoot sticky bottom-0>` в `ozon-analytics-table.tsx` (`computeAnalyticsTotals` + `totalCellContent`): суммы где осмысленно, %/₽-за-единицу из сумм, per-unit (цена/себест/маржа/дни) → «—». Sticky-pinned колонки в tfoot дублируют логику cellStyle. Config `showTotalsRow` (default on), тоггл в шапке + настройках.

- **Input lag в блоках — мемоизировать разбор конфига (v0.27.2)** — `parseConfig(instance.config)` / `SheetConfig.parse(...)` НЕЛЬЗЯ вызывать прямо в теле Render-компонента: Zod валидирует весь конфиг (большие массивы ячеек) на каждый рендер И возвращает новые ссылки на `config.columns`/`config.rows`/`moneyRefs`/`blockRefs` → тяжёлые `useMemo` (`computeAll`, `autoValueWidths`/`autoLabelWidth` canvas-measure, `evaluatedCells`/`blockValues`) бьются на каждый keystroke. **Правило: `const config = useMemo(() => parseConfig(instance.config), [instance.config])`** во всех Render-функциях блоков. Применено в `custom-data`, `sheet`, `excel-cell`, `unit-my-store-table`, `unit-ozon-multi-table`. Поля названий (метка строки `custom.data`, header-метка `sheet`) — локальный draft + commit на blur/Enter, иначе ввод по символу пишет в config (полный ре-рендер сетки + сетевой save). `Intl.NumberFormat` кэшировать на модульном уровне (`getNumberFormat`), не создавать per-cell. **TODO (Phase 2, отложено):** `React.memo` на строки (`SheetRow`/`SortableRowGroup`) — требует стабилизации callback-пропсов (риск stale-closure в focus-логике v0.23.1/v0.23.2); сейчас не нужно т.к. таблицы >50 строк виртуализируются.
- **Universal Block Import/Export (v0.25.0 + v0.25.1 формула-фиксы)** — модуль `src/lib/blocks/import-export/` с адаптерным паттерном. JSON-универсальный (config + appearance + size + dependencies + aiPromptSupplement, schema `open-finance.block-export.v1`). XLSX-адаптеры для `sheet`/`custom.data`/`kpi.grid`/`excel.cell`/`unit.my-store-table` (формулы через `cell.f`, мета-листы для config). `refs-scrubber.ts` зачищает все cross-block ссылки (`dependencies.sources`, `blockRefs`, `sourceBinding`, cell-level bindings). UI — вкладка «Импорт / Экспорт» в `BlockSettingsDialog` (между `style` и `ai`), доступна всем блокам. Preview-режим с pills/scrubbed/conflict-баннер. Кнопки «Перезаписать» (destructive если есть данные) / «Объединить» (только табличные). **Грабли:** не передавать `def.icon` через RSC-границу в адаптеры (используем `iconName`); `cellFormula: true` ОБЯЗАТЕЛЕН при `XLSX.read`; формулы в sheetjs хранятся без `=` — адаптер добавляет/убирает; merge-режим в custom-data ремаппит cols по `label`-сопоставлению чтобы новые данные легли на старые колонки. **Формулы (v0.25.1):** (1) `custom.data` использует block-A1 (A=первая user-колонка, row 1=первая data-строка), но XLSX добавляет колонку «Строка» + header-row — все A1-адреса нужно сдвигать `(+1, +1)` при экспорте, `(-1, -1)` при импорте — `formula-utils.ts:shiftA1Addresses`. (2) `@blockId.field` Excel НЕ понимает (трактует как `#ИМЯ?`/structured ref) → подставляем numeric value из `BlockValuesContext` (`useLiveValuesSnapshot` в `import-export-tab.tsx`) через `formula-utils.ts:substituteAtRefs`. Без значения → `0`. (3) `unit.my-store-table` bindings (`row.bindings[colId]`) тоже резолвятся через `liveValues` в число (raw export раньше писал @-text → `#ИМЯ?`). Тесты: `pnpm tsx scripts/test-block-import-export.ts` (100 проверок).
- **UI polish batch (v0.24.4)** — 4 точечных фикса + inbox overhaul.
  1. **Sticky-bleed в `unit.my-store-table`** — `MyStoreSortableHeaderCell` после v0.24.2 навешивал `bg-card` только на `isPinned`, не-pinned заголовки прозрачны → текст «просвечивал» под `Артикул`/`Название` при скролле. Плюс `hover:bg-accent/30` на pinned делал её полупрозрачной. **Грабли:** ВСЕ sticky-headers должны быть `bg-card` всегда (не только pinned), `hover:*` только на не-pinned. `PIN_SHADOW` = `'1px 0 0 0 var(--border)'` (project invariant).
  2. **`LinkableNumberCell` integer vs float форматирование** — `Number.isInteger(v) → String(v)` (без разделителей) vs `Intl.NumberFormat` (с разделителями) → каша в одной колонке. **Грабли:** всегда `Intl.NumberFormat` для отображения, никогда `String(v)`. Проп `money={true}` респектируется через `formatRublesWithSettings(rublesToKopecks(v), showKopecks)` с обрезкой ` ₽` (badge уже в шапке).
  3. **Сохранение активной вкладки `/unit-economics`** — `?tab=<slug>` через `window.location.search` + `history.replaceState`. Slug = `defaultKey` для built-in (`ozon`, `ozon-multi`, `yandex`, `my-store`) или `pageKey` для custom. Тот же паттерн в `admin/ai/local-models/page.tsx`. **Грабли:** избегать `useSearchParams` (требует Suspense, M.L220) — `window.location.search` достаточно. **НИКОГДА не читать `window` в `useState`-инициализаторе** (v0.24.5 hotfix): SSR-default разойдётся с client-state → hydration mismatch + регенерация поддерева. Правильно: `useState(ssrSafeDefault)` + `useEffect(() => { if (urlValue !== default) setActive(urlValue); }, [])`. См. `unit-economics-client.tsx` L113-130.
  4. **Inbox encoding bug** — кастомный `mime.ts` не умел nested multipart → сырые QP/MIME-блоки в DB. Фикс: `mailparser.simpleParser` (battle-tested). **Грабли:** для email-парсинга всегда `mailparser`, не кастомный код. `mime.ts` deprecated, оставлен для legacy.
  5. **Inbox HTML rendering** — новая колонка `body_html` (`text`, optional). Sanitize через `src/lib/inbox/sanitize-html.ts` (DOMPurify + `<img src>` → `data-src` + placeholder). Картинки в DB НЕ хранятся, грузятся on-demand по клику на «Загрузить». Рендерер `EmailHtmlBody` в `inbox-channel-feed.tsx` (prose container). Sync limit 50→200 (`?limit=N` clamp 1..500). Existing messages чинятся через upsert по `external_id` одним кликом «Синхронизировать (200)» — отдельный backfill-скрипт не нужен. **Грабли:** `@tailwindcss/typography` plugin теперь обязателен для `prose` классов в email rendering. **`isomorphic-dompurify` тащит `jsdom` → Next.js webpack ломается на `browser/default-stylesheet.css`** (mangled `__dirname`); используем `dompurify` (browser-only) с SSR-guard `if (typeof window === 'undefined') return no-op`.
- **AI layer (v0.24.0)** — центральный composer `resolvePromptStack()` в `src/lib/ai/prompt-resolver.ts`. 4-уровневая иерархия (global → section → block-skill → user supplement). 28 block skills в `src/lib/ai/prompts/block-skills/`. Per-user ключи в `user_ai_credentials` (таблица, `pnpm db:push`). `getActiveCredentials()` в `src/lib/ai/user-keys.ts` — user > tenant > Ollama. `BlockInstance.aiPromptSupplement` (max 500) — новый user-input; `aiPrompt` deprecated как fallback. AI слой: `/api/ai/chat` использует `resolvePromptStack()` + `getActiveCredentials()`. **Новые провайдеры:** DeepSeek (openai-compat), Yandex GPT (`src/lib/ai/providers/yandex-gpt.ts`), GigaChat OAuth2 (`gigachat.ts`). **Section AI:** `<SectionAiButton>` в headers 6 разделов → `SectionAiDialog` → `POST /api/ai/analyze-section`. `PROVIDER_META[]` содержит `requiresVpn` для UI-ярлыков. Документация: `docs/AI_PROMPT_LAYERS.md`. **Правило: все новые AI-маршруты используют `resolvePromptStack()`, не прямой `buildMicroAgentSystemPrompt()`**.
- **Block settings UI design system (v0.23.15)** — `src/components/blocks/settings/` содержит shared примитивы (`SettingsToggleRow`, `KopecksRow`, `SettingsSegmented`, `SettingsSliderRow`, `SettingsSection`) и `SourceBlockPicker` (единый пикер с period badge, collapsible cells, lazy loading). Все `SettingsForm` компоненты (computed, sheet, cashflow KPI, stat-custom, chart-cashflow, custom-data) мигрированы. `BlockReferencePicker` перешёл от UUID → labels через `cand.labels[field]`. Одиночный `_sourceBlockPickerCache` вместо двух модульных кэшей. **Правило: в новых SettingsForm — только примитивы из settings/**. README в папке.
- **Per-cell linking from «Данные» (v0.23.14)** — `custom.data` публикует ячейки как `rowId.colId` поля. `__cellFields` маркер перечисляет ключи. Лимит 200. API route тоже добавляет per-cell поля с `group: 'Ячейки'`. Пикер показывает их в раскрываемой секции «Ячейки». Общий cache `_sourceBlockPickerCache` (из settings/source-block-picker.tsx).
- **Kopecks convention (v0.23.13)** — Единое правило: все деньги в `useBlockValuePublisher` публикуются в КОПЕЙКАХ (× 100). `formatRublesWithSettings` всегда делит на 100. Нарушители до v0.23.13: `custom-data` (рублёвые колонки), `unit-ozon-kpi` (revenue/ads/aov/cpo), `unit-ozon-campaigns` (expenseRub/ordersRub). Исправлены. `custom-data` дисплей (`formatCustomDataRubles`) принимает рубли без ÷100 — эта цепочка отдельна от publisher-а и остаётся верной. **Правило для новых блоков: если колонка/поле = деньги → × 100 перед публикацией.**
- **Block relations stale data ИСПРАВЛЕНО (v0.23.12)** — В `excel-cell.tsx` и `sheet.tsx` при вычислении `@block.field` ссылок, `config.blockRefs` содержит числовой snapshot сохранённый при связывании. Раньше snapshot перекрывал live значение (`val ?? liveValues[name]`). Фикс: `liveValues[name] ?? val ?? null` — live всегда выигрывает. Snapshot остаётся для fallback когда блок-источник не смонтирован.
- **computed.tsx formulaExpression ИСПРАВЛЕНО (v0.23.12)** — SettingsForm сохраняет формулу в `config.expression`, но `useBlockDependencyResult` читал `deps.formulaExpression`. Через `effectiveDeps` в `RenderComputedSum` они объединены: `formulaExpression: deps.formulaExpression ?? cfg.expression`. Теперь formula aggregation работает.
- **`__periodKey` конвенция (v0.23.12)** — Блоки с периодом публикуют `__periodKey: formatPeriodKey(period)` через `useBlockValuePublisher`. `useAvailableBlockSources()` возвращает `periodKey: string | null`. Picker и overlay отображают тег. Добавить в новые period-блоки.
- **Cycle protection в BlockValuesStore (v0.23.12)** — `inFlightRef: Set<string>` предотвращает повторную publish того же blockId в одном sync-call. Primary — `shallowEqual`. Вместе: A→B→A зацикливание невозможно т.к. значения не меняются → shallowEqual breaks the chain; edge case sync recursion — inFlightRef.

- **Recharts `<YAxis hide>` всё ещё резервирует ширину (v0.23.6)** — `hide=true` НЕ убирает `width` из layout. По умолчанию Recharts резервирует 56px даже для скрытой оси. Если в чарте несколько скрытых осей с одной стороны (`unit.ozon-chart`: `rubRight` + `orders` + `aov`), они в сумме сожрут весь правый gutter и видимая ось (pct) уедет за viewport блока. Фикс — в `src/components/blocks/chart-shell.tsx` width: `ax.hide ? 0 : (ax.width ?? 56)`. **Правило: для любых hide:true осей передавать ширину 0 в layout-движок Recharts.**
- **`PeriodPicker.collapsed` (v0.23.6)** — для in-block headers использовать `<PeriodPicker collapsed compact>`. Свёрнутый режим — одна кнопка `[Calendar] <preset-label> ↓` с Popover'ом всех пресетов. Без `collapsed` 6 chips + Произвольный (~700px) на узких блоках выдавливают granularity / metrics / KPI-бейджи на вторую строку. SettingsForm — без `collapsed` (горизонтального места там хватает).
- **Ozon dashboard UX polish (v0.23.5)** — 4 правки на одной странице `/marketplaces/ozon`:
  1. **`OzonSyncDialog` sticky header/footer** — `DialogContent` теперь `flex max-h-[85vh] flex-col`, тело — `flex-1 min-h-0 overflow-y-auto`, секция «Стейджи» — `max-h-[50vh] overflow-y-auto`. До этого 15 чекбоксов вытягивали модалку за viewport, кнопки «Отмена/Запустить» уходили за экран.
  2. **`unit.ozon-chart` native `<select>` → `DropdownSelect`** — повторное проявление грабли из MEMORY (macOS показывает пустую метку при заполненном value). Селектор «по дням / по неделям» в header блока был пустым; теперь через `DropdownSelect` из `unit-economics/dropdown-select`. **Правило: любой `<select>` в header'ах блоков → `DropdownSelect`, даже если на твоей машине работает.** То же применено в SettingsForm для гранулярности и chartType.
  3. **`unit.ozon-chart` — отдельная скрытая `aov` ось.** AOV ~2-5K на одной шкале с выручкой 100K-1M+ лежал у нуля и был невидим. Расход (`rubRight`) теперь тоже скрытая ось (контейнер масштаба, без визуальной шкалы); цифра в верхнем KPI-badge. `rubW`/`pctW` уменьшены (48/34, tinyAxis 36/30), `chartMargin.right=4` всегда. Domain `rubLeft` — `[0, dataMax * 1.1]` чтобы area не упиралась в край.
  4. **`unit.ozon-kpi` — sparkline у карточки «ДРР»** через `byDay.map(d => d.revenueRub > 0 ? (d.adsRub / d.revenueRub) * 100 : 0)`. Раньше у ДРР sparkline'а не было, у остальных был.
  5. **`unit.ozon-campaigns` — sort + onlyActive + period only в шапке.** `SortableHeader` компонент с `ArrowUpDown / ArrowUp / ArrowDown` индикатором, comparator по 7 колонкам (state → ordinal `RUNNING < PAUSED < FINISHED`). Новое `config.onlyActive: boolean` фильтрует rows перед сортировкой; `widths` и empty-state считаются по отфильтрованным. `PeriodPicker` убран из SettingsForm — теперь только в шапке блока (через `useBlockPeriod`, синхронно с глобальным периодом страницы). Поля `periodPreset/customFrom/customTo` оставлены в схеме как fallback для legacy-инстансов.
- **`custom.data` Excel-like fill-handle (v0.23.4)** — маленький handle (2×2px) в правом-нижнем углу каждой ячейки, видим на hover. Drag вверх/вниз/влево/вправо копирует source-ячейку в промежуточные:
  - Формула — A1-ссылки сдвигаются relative (`=A1*B1` в C2 → `=A2*B2` в C3). Реализация — `shiftFormulaRefs` в `src/lib/blocks/custom-data-fill.ts`. Парсер пропускает `@blockId.field`, `[Row Label].col`, идентификаторы функций (`SUM`/`MIN`), строковые литералы.
  - Binding (`cell.ref`) копируется absolute (binding на другой блок — явная abs-ссылка).
  - Литерал копируется как есть.
  - Out-of-bounds A1 → `#REF!`.
  - Pointer capture + `elementFromPoint` (нативный API, без либ). Каждая ячейка получает `data-cell-coord="rIdx,cIdx"` для hit-test. Источник UX — Handsontable `fillHandle`, семантика relative-refs — HyperFormula copy-paste.
  - Visual: source — `ring-2 ring-primary/70`, промежуточные — `bg-primary/10 ring-1 ring-primary/40`.
  - Skip-условия рендера handle: ячейка в режиме edit (`isActive`), pick-mode формулы, drag активен и эта не source.
  - Тесты — `scripts/test-fill-handle.ts` (35 кейсов: shift, `#REF!`, SUM-range, @-tokens, [Row].col, направления, binding/литерал).
- **UI polish (v0.23.3)** — 4 правки:
  1. **`custom.data` showKopecks теперь работает для всех числовых форматов** (раньше — только rubles). `formatColumnValue` обновлён: `number/percent` теряют дробную часть при `showKopecks=false`. **v0.23.3 fix:** text-колонки с формульными числами тоже форматируются (раньше `String(16.666…)` с точкой). Per-column / per-row override через `Column.showKopecks?: boolean | null` и `Row.showKopecks?: boolean | null` (3-state). Резолвер — `resolveShowKopecks(row, col, blockDefault)`, block-level — `resolveBlockShowKopecks` (default `true`, `null` → global). UI — bulk-toolbar: «Десятичные» popover (Show/Hide/Inherit) когда выделены строки/колонки.
  2. **Sticky-сайдбар** в `src/app/(app)/layout.tsx` (`<aside>` → `sticky top-0 self-start h-screen overflow-y-auto`). Document скроллится, нав остаётся видна.
  3. **Автоверсия из CHANGELOG.md** — `next.config.mjs` парсит `^##\s*\[?(x.y.z)` и инжектит `NEXT_PUBLIC_APP_VERSION`. UI читает через `src/lib/version.ts` (`APP_VERSION`). Сайдбар и лендинг (`src/app/page.tsx`) обновлены — хардкод убран.
  4. **AI/Settings hotzone-reveal** — `block-chrome.tsx` toolbar (AI/Settings/Delete) переведён с JS `showControls`-стейта на CSS-pattern (зеркало resize-hotzone): `data-toolbar-hotzone` в правом верхнем углу + правило `:has([data-toolbar-hotzone]:hover) .block-toolbar { opacity: 1 }` в `block-grid.css`. Drag-handle остался на JS-hover.
- **Unified period system (v0.23.0)** — `src/lib/blocks/use-block-period.ts` — единый хук для блоков с периодом. `period`/`isOverride`/`setOverride`/`resetToGlobal` API. `PagePeriodContext` расширен `registerBlock`/`unregisterBlock`/`countOverridden`/`resetAllOverrides` — registry в `useRef` чтобы не вызывать re-render всего поддерева. `PagePeriodHeader` показывает warning «Мастер-настройка» (dismissable через `localStorage`) + кнопку «Сбросить локальные (N)» через `useSyncExternalStore`. 9 Ozon-блоков + `cashflow.transactions` + `kpi.grid` мигрированы. `cashflow.transactions` теперь применяет `effectivePeriod` к fetch (раньше игнорировал). `BlockDef.usesPeriod?: boolean` flag в registry → `pageHasGlobalBoundBlocks` auto-show панели. Lock-badge `<Lock /> свой` на каждом overridden-блоке. Документация — `docs/PAGE_PERIODS.md`.
- **`custom.data` sheet-style formula UX (v0.23.0)** — полностью переработан: popover убран (включая `Tabs` и `CurrencyInput`, который блокировал ввод операторов через `preventDefault`). Inline `<input>` в активной ячейке + sticky formula bar с operator toolbar (`+ - * / ( ) , :`). `EditSession` shape: `rowId/columnId/draft/caretPos/lastFocused` — `isFormula` derived из `draft.startsWith('=')`. Cell-click в formula-mode → `insertIntoDraft(addr)`. Binding picker (Link2) — компактный `CellRefPickerDialog` справа от formula bar. Документация — `docs/CUSTOM_DATA_BLOCK.md`.
- **`custom.data` cell-pick focus management (v0.23.1)** — после миграции на sheet-style клик по другой ячейке в режиме формулы сбрасывал редактор. Корневая причина: `<button>` ячейки крал focus → blur коммитил session → `deactivateCell` срабатывал раньше `handleCellClick`. Фикс — паттерн как в `sheet.tsx`: `cardRef` + smart `handleInputBlur` (skip commit когда `relatedTarget ∈ cardRef` или `pickerCell != null`), `onMouseDown preventDefault` на `CellTriggerButton`, явный commit в `activateCell` при переключении ячейки. Файл `src/lib/blocks/catalog/custom-data.tsx`. Если будут странные регрессии с focus — проверь блокировки в этих местах.
- **`custom.data` caret jump после cell-pick (v0.23.2)** — даже после фикса 0.23.1 пользователь видел `*60=B1` вместо `=B1*60`: каретка после programmatic insert падала в начало `<input>` (или в конец, дефолт браузера для controlled inputs), а следующий ввод печатался не там. Корневая причина: `setTimeout(0)` для `setSelectionRange` расходился с React commit + browser default. Фикс — `useLayoutEffect` + `pendingCaretRef` для синхронного восстановления курсора после commit + DOM-mutation, до paint. Плюс `insertIntoDraftWithSession` теперь читает caret из DOM (`input.selectionStart`), а не из React state (state может отставать после `setSelectionRange`, который не всегда триггерит `onSelect`).
- **`custom.data` подсветка и multi-select (v0.23.2)** — добавлено `row.highlight` / `column.highlight` (ID цвета из палитры `yellow|green|blue|red|purple|orange`) + множественное выделение строк/колонок через клик на drag-handle (Shift = диапазон, Cmd/Ctrl = toggle, drag-as-usual = реордер). Bulk-toolbar появляется при ≥1 выделенных — «Подсветить» (палитра), «Удалить», «Снять». Реализация через `HighlightPalettePopover` (использует shadcn `Popover`) и helper `getHighlight(id) → {bg, dark, ring, label}`. Backward-compatible: старые configs без `highlight` парсятся без проблем.
- **`SourceBindingPicker` (v0.22.2)** — кнопка «Из блока» использует локальный `uiMode` state (UI-only до выбора реального `blockId`). `value` НЕ перетирается невалидным `{ mode: 'block', blockId: '' }` — иначе round-trip через `readSourceBinding()` сбросит в `empty`. Warning под чипами с инструкцией если нет кандидатов на странице.
- **`OzonSyncDialog` smart `auto` preset (v0.22.2)** — резолвится из `account.lastSyncAt`: null/недоступно → 30d; ≤1d → только вчера; 2–90d → от lastSync до вчера; >90d → fallback 30d; будущее → from=yesterday. Чип `auto` с `<Sparkles>` иконкой. `describePreset('auto', lastSyncAt)` показывает «Догрузим N дн.: YYYY-MM-DD → YYYY-MM-DD» в hint и tooltip. Pure helpers в `src/components/marketplaces/ozon-sync-presets.ts` (26 тестов).
- **Date-override в Ozon sync (v0.22.1)** — `POST /api/marketplaces/accounts/[id]/sync` принимает `{fromDate, toDate, force}`. Date-aware стейджи (`analyticsData`, `orders`, `transactions`, `perf-*`) honor override. Catalog/snapshot стейджи (`products`, `prices`, `stocks`, `turnover`, `clusters`, `warehouseStocks`, `realization`) игнорируют. Perf-стейджи в override-режиме single attempt без retry.
- **`PagePeriodHeader` chevron (v0.22.1)** — chevron в отдельной Row 1 (`flex` без wrap, `ml-auto shrink-0`); PeriodPicker в Row 2 с `flex-wrap`. На узком экране chevron не тянется вниз вместе с picker'ом.
- **`EmptySourcePlaceholder` compact (v0.22.1)** — `title` (truncate, short) + `subtitle` (line-clamp-1, muted). Compact: иконка `h-6 w-6`, `p-1.5`, `description` скрыт. Callers передают `title` отдельно от `subtitle`.
- **`custom.data` formula UX (v0.22.0)** — *Устаревшее, v0.23.0 целиком переписан в sheet-style.* Общий `FormulaSession` state, draggable popover, editable formula bar, cell-pick mode, settings toggle `cellPopoverEnabled`, hint-плашка.
- **`BlockGrid` auto-mount providers (v0.22.0)** — outer-wrapper проверяет `useContext(PagePeriodContext) === null` → conditional `PagePeriodProvider`/`PageSourceProvider`/`VirtualSourcesBridge`. `cashflow-client.tsx` упрощён.
- **`unit_economics_tabs` (v0.22.0)** — tenant+user scoped CRUD. Default seed'ятся (4 шт.), custom `unit-economics-custom-{nanoid8()}`. Block marketplace wildcard `unit-economics-custom-*`. Миграция `drizzle/0003_outstanding_energizer.sql`.
- **`unit.my-store-table` header v3 fixes (v0.24.3)** — DnD исправлен: `PopoverTrigger asChild` → `PopoverAnchor asChild` (Radix больше не перехватывает pointerDown). `isDragging → closeNow()` в useEffect. Визуал ячейки: unit и grip в одном relative-слоте с fade-переходом. Сортировка (По убыванию/По возрастанию/Сбросить) перенесена в выпадающее меню. Formula protection: `getFormulaUsages()` + `DEFAULT_COL_IDS` + `handleDeleteColumn()` + `deleteWarnCol` dialog. Встроенные referenced колонки — `onDelete=null`, пользовательские — предупреждение с перечнем зависимых формул.
- **`unit.my-store-table` header menu refactor (v0.24.2)** — заголовок чистый в idle, на hover ячейки появляется одна drag/menu-кнопка (`HeaderActionsMenu`). Click/hover (400ms delay) открывает Popover с действиями: pin/unpin, hide/show, settings, delete. mousedown + 5px → DnD reorder (@dnd-kit). Артикул/Название стали `type: 'identity'` колонками в `config.columns` с reserved id `'article'`/`'name'`, по умолчанию pinned (`pinnedColumns: ['article', 'name']`). Migration в `parseConfig` prepend'ит identity для старых конфигов. `#` единственная hardcoded sticky-cell без меню. `stickyOffsets` стартует от `STICKY_INDEX_W` (32). `PIN_SHADOW` только на last pinned (`lastPinnedId` via useMemo) — фикс overlap между sticky-блоками. Body identity-cells = `<input>` бинд на `row.article`/`row.name`, totals identity = empty (лейбл «Итого» уходит в первую видимую identity). `ColumnEditDialog` скрывает type/unit/positive/bulk-fill/delete для identity. Publisher r_<slug>_article/name идут через общий цикл visibleColumns. **Грабли**: `flex + min-w-0` обязательно (не `inline-flex`) для рабочего truncate в sticky-cells, иначе текст вылезает за границы.
- **`unit.my-store-table` UX upgrades (v0.24.1)** — паритет с `unit.ozon-analytics`: DnD reorder (`@dnd-kit` + `arrayMove(config.columns)`), drag-resize (overlay `widthOverrides` → `persist` по mouseup, min 40px), sort cycle (`null → desc → asc → null`, локальный state, применяется ПОСЛЕ формул, `'#CYCLE'`/`'#ERR'` → конец), sticky pinned columns (`config.pinnedColumns: string[]`, cumulative left). Per-row publishing top-50 строк по revenueMonth DESC: `r_<slug>_<colId>`, money в копейках, `__labels` `<rowLabel> · <colLabel>`. Pinned колонки исключены из DnD (`disabled` в `useSortable`).
- **`unit.my-store-table` import из `unit.ozon-analytics` (v0.22.0)** — `importSource: {blockId, pageKey, columns, matchBy, mode, syncOnMount}`. Mapping `OZON_TO_MY_STORE_COLUMN_MAP` (29 колонок). Live-sync throttle 30s через `lastSyncRef`.
- **Source binding v0.21.0** — KPI/chart/top-categories/kpi.grid: `sourceBinding: 'empty' | 'global' | {block, blockId, pageKey?}`. Дефолт для НОВЫХ = `empty` (placeholder с CTA). Existing auto-migrate. `cashflow.transactions` публикует `__txFilters` через `useBlockValuePublisher`. `useCashflowKpiLite` не поддерживает counterparty/categoryName-фильтры (только period+source). Cross-page bindings показывают `'missing'` (server-side endpoint готов, runtime не подключён).

### Universal грабли (не привязаны к версии)
- **`sanitizeBlocks` на сервере** выкидывает блоки из-за client-only catalog.
- **Sheet sources** обязаны включать computed formulas + linked cells, не только raw saved cells.
- **Money formatting (копейки)** только при явном `format: money` / `moneyRefs` — иначе обычные числа делятся на 100. Курс — НЕ money (90.5 / 100 = 0.91₽).
- **Ollama fallback** не должен выбирать embedding-only модели (`isChatCapableModel()`).
- **`useSearchParams` в Next 15** требует `<Suspense>`.
- **`bcryptjs`** нельзя импортировать в edge/middleware.
- **`tsx` через pnpm в sandbox** падает с `EPERM listen`. Запускать через Shell с `required_permissions: ["all"]`.
- **postgres.js + raw `sql\`...\``: НЕ передавать `Date` через `${}`.** Сначала `from.toISOString()` + `::timestamp` cast. Все Ozon routes используют этот паттерн.
- **HTML-500 на unhandled route exception** → frontend падает `Unexpected end of JSON input`. ВСЕ routes с top-level try/catch + `NextResponse.json({ ok: false, error })`. На клиенте `parseJsonResponse(response)` helper.
- **Async fetch + setState после unmount** — `mountedRef = useRef(true)` + cleanup в useEffect.
- **In-memory rate-limit карты (Ozon 40 RPS per-clientId, currency 1/min per tenant)** НЕ переживают перезагрузку. Для одного инстанса OK; horizontal scale → Redis.
- **`useBlockValuePublisher` ВЫШЕ early-returns.** Иначе rules-of-hooks падает в build.
- **`useMemo`/`useState`/`useEffect` ВЫШЕ density early-returns** в Block-Render.
- **`DndContext` с `id={useId()}`** при >1 на странице.
- **Версионирование тарифов unit-economics** — никогда не редактировать существующий tariff pack inplace; добавлять новый `ozon_2026_05_xx.ts`.
- **Sticky cells** `bg-card` (НЕ `/95`), `overflow:hidden isolate`, z-index header `45`, totals `35`, body `30`, sticky totals `36`. На последней sticky-колонке `boxShadow: '1px 0 0 0 var(--border)'`.
- **`appearance.borderColor` через `boxShadow inset` перекрывается** — использовать absolute-overlay `<div className="pointer-events-none absolute inset-0 z-20" style={{boxShadow: 'inset 0 0 0 2px {color}'}}>` (ниже z-30 chrome controls).
- **Палитры через `flex flex-wrap gap-1.5 shrink-0`** (НЕ `grid-cols-12 gap-1`).
- **Active-ring через `boxShadow: '0 0 0 Npx hsl(var(--background)), 0 0 0 Mpx {color}'`** (двойное кольцо).
- **`__money` metadata** обязателен у KPI-блоков, публикующих рубли. Без него picker не пометит source как money.
- **Money detection в формулах** — нельзя полагаться на эвристику по имени; сохранять `moneyRefs[ref] = sourceFieldIsMoney(...)` в config.
- **`minContentSize` блокирует ресайз** если блок умеет сам скроллиться (`overflow-auto` внутри).
- **Native `<select>` в шапке таблиц** — на macOS/iOS пустая метка при заполненном value. Использовать `DropdownSelect`.
- **`{` в JSX-тексте** — `&#123;` или `{'{id}'}` (TS+React парсит `{}` как expression даже в `<p>`).
- **`Pure-helper'ы для smoke-тестов** — выносить в отдельный модуль без импорта `db client`, иначе `pnpm tsx` падает на `ZodError: DATABASE_URL Required`.

## AI Micro-Agent runtime

- `src/app/api/ai/chat/route.ts` — NDJSON streaming, `resolvePromptStack()`, `getActiveCredentials()`, `parseAction()`.
- `src/components/micro-agent/micro-agent-dialog.tsx` — dialog с streaming, Stop, token counter.
- `src/lib/ai/providers/{ollama,openai-compat,proxy,yandex-gpt,gigachat}.ts` — provider layer.
- `src/lib/ai/prompt-resolver.ts` — `resolvePromptStack()` (все AI-routes).
- `src/lib/ai/user-keys.ts` — `getActiveCredentials()` (user > tenant > Ollama).
- `src/lib/ai/sections.ts` — 6 SECTION_GROUPS + `resolveSectionGroup()`.
- `src/lib/ai/prompts/` — block-skills (28 типов), section-defaults, pointwise.
- `src/components/blocks/section-ai-button.tsx` + `section-ai-dialog.tsx` — AI Анализ раздела.
- `src/app/api/ai/analyze-section/route.ts` — section analysis NDJSON stream.
- `src/app/(app)/settings/ai/` — per-user AI настройки (ключи).
- `src/app/api/ai/credentials/route.ts` — CRUD per-user ключей.
- События: `start`, `token`, `done`, `error`, `aborted`.
- Приоритет промптов: `aiPromptSupplement (max 500) > aiPrompt (deprecated) > legacy config.blockPrompt`.
- Приоритет credentials: `user_ai_credentials (enabled) > tenants.settings.aiExternal > Ollama`.
- `parseAction()` понимает fenced/unfenced JSON, `update_block`, `create_block`, `text_only`.
- `parseAction()` понимает fenced/unfenced JSON, `update_block`, `create_block`, `text_only`.

## Marketplace Integrations (краткая навигация)

- **Foundation (v0.17.0):** `src/lib/db/schema/marketplaces.ts`, `src/lib/marketplaces/{types,crypto,queries}.ts`, `src/lib/marketplaces/ozon/{client,endpoints,types,upsert,upsert-plan}.ts`, `sync/{products,prices,stocks,orders,realization,transactions,turnover,analytics-data,clusters,warehouseStocks,perf-{campaigns,sku-stats,cpo-daily,expense-daily}}.ts`.
- **Settings:** `src/app/(app)/settings/integrations/{page,integrations-client}.tsx`.
- **Блоки sync UI:** `src/components/unit-economics/{ozon-sync-button,ozon-sync-settings-form,ozon-sync-preview-dialog,ozon-sync-diff,ozon-sync-section}.tsx`.
- **Universal sync dialog:** `src/components/marketplaces/ozon-sync-dialog.tsx` + `ozon-sync-presets.ts` (v0.22.1+).
- **Global sync indicator:** `src/components/marketplaces/global-sync-indicator.tsx` (mount в `(app)/layout.tsx`).
- **Analytics:** `src/app/api/marketplaces/analytics/ozon/route.ts`, `src/app/api/marketplaces/ozon/{kpi,timeseries,top-ads,abc,campaigns,search-phrases,cluster-stocks-v2}/route.ts`. Все используют MSC `query-period.ts`.
- **Ads totals:** `src/lib/marketplaces/ozon/ads-totals.ts` (`getOzonAdsTotals`). Priority: `expense → performance (CPC+CPO) → transactions-heuristic → none`.
- **Подробности по версиям:** `docs/memory-archive/v0.17.md`, `v0.18.md`.

## Unit Economics (краткая навигация)

- **Types/calculate:** `src/lib/unit-economics/{types,ozon/{tariffs-2026-04-07,calculate,migrate},yandex/{tariffs-2026-04-01,calculate}}.ts`.
- **Bindings:** `src/lib/unit-economics/bindings.ts`, `src/lib/unit-economics/use-live-block-values.ts`.
- **Tabs CRUD:** `src/lib/db/schema/unit-economics-tabs.ts`, `src/app/api/unit-economics/tabs/*`.
- **Import Ozon Analytics → My Store:** `src/lib/unit-economics/ozon-to-my-store.ts`, `src/components/unit-economics/ozon-import-from-analytics-dialog.tsx`, `src/app/api/unit-economics/import/ozon-analytics/route.ts`.
- **Tariff versioning:** `OZON_TARIFF_VERSION = 'ozon_2026_04_07'`, `YANDEX_TARIFF_VERSION = 'yandex_2026_04_01'`. Никогда не редактировать inplace.

## Sheet / custom.data / Excel Cell

- **`sheet`** — мини-таблица с формулами, `@связать`, computed cells в sources API.
- **`excel.cell`** — компактная одиночная Excel-like ячейка `3×2`.
- **`custom.data`** (v0.18.26 + v0.22.0) — multi-column блок «Данные». Formula engine portable client+server. Notion-style popover с табами «Значение/Формула/Связь». Sticky formula bar, DnD-реордер, виртуализация при `rows > 50`. Draggable popover, cell-pick mode (v0.22.0).
- **Money metadata:** `sheet`/`excel.cell` сохраняют `moneyRefs: Record<string, boolean>` в config; `custom.data` — `cells[colId].isMoney`. KPI публикуют `__money: 'col1,col2'` через `useBlockValuePublisher`.

## RAG / AI Orchestrator (TODO)

- Schema готова: `src/lib/db/schema/ai.ts` (`memory_chunks`, `ai_usage`, `ai_audit_log`, `ai_agents`).
- `src/lib/ai/orchestrator.ts` пока scaffold.
- `src/lib/ai/memory/search.ts` TODO для hybrid semantic + full-text + RRF.
- Векторные индексы вручную: `drizzle/init/02-vector-indexes.sql`.

## Inbox / Currency / Boards (краткая навигация)

- **Inbox MVP** (v0.10-v0.19, parser v0.24.4, render v0.29.0): `src/lib/{inbox,db/schema/inbox}.ts`, `src/lib/blocks/catalog/inbox-{channel-feed,dashboard}.tsx`. IMAP test/sync (Beget STARTTLS fallback). AES-256-GCM (`INBOX_SECRET_KEY`). **Парсинг через `mailparser.simpleParser`** (v0.24.4) — nested multipart, charset, encoded-words, QP/base64. **`body_html` колонка**. **Рендер HTML письма — sandboxed `<iframe srcdoc>`** (v0.29.0): `sanitizeEmailHtml` (DOMPurify, разрешены `<style>`/class/id/font для достоверной вёрстки + скрытия preheader) + `buildEmailSrcDoc` (charset utf-8, `<base target=_blank>`, гейтинг картинок). `sandbox` без `allow-scripts`/`allow-same-origin` — JS писем не исполняется. Картинки on-demand с внешних URL по кнопке (в DB не хранятся). **`lib/inbox/clean-text.ts`** — `decodeEntities`/`cleanPreview`/`cleanPlainTextBody` против preheader-мусора `&zwnj;`. Sync default 200, `?limit=N` clamp 1..500. AI Vision: `AiRecognizePanel` + `/api/inbox/messages/[id]/recognize`.
- **Currency** (v0.16.0): `src/lib/{db/schema/currency,currency}/*`, `src/lib/blocks/catalog/currency-rates.tsx`. ЦБ через `cbr-xml-daily.ru`, lazy-refresh 23h. **Курс НЕ money-формат.**
- **Boards** (foundation): `src/lib/{db/schema,boards}/*`, `src/app/(app)/boards/*`, `boardPageKey(id) → 'board-{id}'`.

## Дизайн-система

- Linear/Notion-inspired: плотная типографика, тонкие borders, минимум теней.
- `html { font-size: 14px }`, компактные shadcn variants.
- Toolbar `size="sm"`/`xs`, icons 14/16/20px.
- Не использовать системные `alert/confirm/prompt`.
- Empty states всегда с CTA.

## AI memory integration (agentmemory)

> Старый mempalace **deprecated с v0.22.4** (Issue #832: chromadb concurrency повреждает индекс). Перешли на `agentmemory` MCP server. Полная инструкция — `docs/MEMORY_SETUP.md`.

- **Сервер:** `agentmemory` (порт 3111, viewer 3113), управляется через launchd-агент `~/Library/LaunchAgents/com.agentmemory.server.plist`. Auto-start на каждом login.
- **Runtime:** требует `iii-engine v0.11.2` (нативный бинарник `~/.local/bin/iii`).
- **Cursor wiring:** `~/.cursor/mcp.json` → `mcpServers.agentmemory` через `@agentmemory/mcp` shim.
- **MCP tools:** 51 в proxy mode (если сервер работает), 7 в standalone fallback.
- **Storage:** local SQLite в `~/.agentmemory/`, ~50MB на 1000 сессий.
- **Search:** BM25 + Vector (local `@xenova/transformers all-MiniLM-L6-v2`) + Knowledge Graph, fused через RRF. 95.2% R@5 на LongMemEval-S.
- **Auto-capture:** через MCP при значимых событиях. Manual в Cursor чате: «запиши в память: ...» → `memory_save`.
- **LLM провайдеры:** опц. Без них работает BM25 + local embeddings (достаточно для старта). С `ANTHROPIC_API_KEY` + `AGENTMEMORY_AUTO_COMPRESS=true` — auto-compression observations.
- **Виды использования:** только для **семантической археологии** («когда мы перешли с X на Y»). НЕ для bootstrap'а — приоритет всё ещё `START.md` + `MEMORY.md` + `git log`.
- **Управление:** `launchctl load/unload`, логи в `~/Library/Logs/agentmemory.{out,err}.log`, диагностика `agentmemory doctor`.
- **Установка:** `./scripts/install-agentmemory.sh` (интерактивный).
- **Импорт истории:** `./scripts/import-claude-transcripts.sh` (Claude Code JSONL). Cursor транскрипты — manual «прочитай и сохрани в памяти».
- **Backup:** `curl http://localhost:3111/agentmemory/export > backup.json` или `cp -R ~/.agentmemory ~/.agentmemory.backup`.

## Команды

```bash
# Установка
pnpm install
pnpm docker:up                          # PostgreSQL + Redis

# Применение SQL (manual)
pnpm db:push
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/02-vector-indexes.sql
# ... аналогично для 03-boards, 04-inbox, 05-unit-economics, 06-currency, 07-marketplaces,
#     09-marketplaces-analytics, 10-marketplaces-perf-cpo, 11-marketplaces-sku-backfill

# Dev
pnpm dev

# Проверка
pnpm typecheck
pnpm build
pnpm lint

# Smoke-тесты (через Shell с required_permissions: ["all"])
pnpm tsx scripts/test-{unit-economics,ozon-upsert,ozon-sync-diff,ozon-analytics,ozon-sync-presets,ozon-sync-incremental,source-binding,sheet-import-export,ozon-perf-{campaigns,period}}.ts
```

## Что отложили (см. PLAN.md)

- BullMQ cron для авто-синхронизации Ozon.
- Yandex Market / Wildberries коннекторы.
- Ozon Push API (вебхуки).
- Incremental sync через `updated_at` (частично сделано в v0.22.1).
- AI-tool `sync_ozon` (для Cmd+K).
- Аналитические блоки `ozon.sales-by-sku`, `ozon.commissions-vs-tariff`, etc. — см. `docs/MARKETPLACES_FUTURE_PLAN.md`.
- RAG memory / hybrid search в `src/lib/ai/memory/`.
- Telegram Bot канал, Whisper transcription, Cmd+K AI action.
- Парсер `СЕБЕС озон.xlsx`.
- Сохранение `unit_calculations` из блоков.
- Экспорт CSV/XLSX и share/permalink для калькуляторов.

## Файлы документации (по запросу задачи)

- `START.md`, `MEMORY.md`, `CLAUDE.md`, `AGENTS.md` — bootstrap + правила (читаются при загрузке контекста).
- `.cursor/rules/*.mdc` — path-scoped правила Cursor 2026 (auto-attach по globs).
- `CHANGELOG.md`, `PLAN.md` — только по запросу.
- `docs/memory-archive/*` — историческая память.
- `docs/MEMPALACE_RUNBOOK.md` — починка mempalace.
- `docs/SECURITY.md` — **обязательно** при работе с секретами/сетью/биллингом.
- `docs/CASHFLOW_BLOCKS.md`, `docs/KPI_GRID.md`, `docs/CUSTOM_DATA_BLOCK.md`, `docs/UNIT_ECONOMICS_TABS.md` — блочные системы.
- `docs/AI_TOOLS.md`, `docs/AI_VISION.md` — AI integration.
- `docs/MARKETPLACES_OZON_PERFORMANCE.md`, `docs/MARKETPLACES_FUTURE_PLAN.md`, `docs/OZON_ADS_GAP.md` — Ozon.
- `docs/BILLING.md`, `docs/LICENSING.md`, `docs/DESKTOP_STRATEGY.md`, `docs/ONBOARDING.md` — продуктовое.
- `docs/EMAIL_BEGET.md`, `docs/LOCAL_AI.md`, `docs/VPN_FOR_AI.md`, `docs/ARCHITECTURE.md`, `docs/MODULES.md` — инфраструктура.
- `LEARNING_LOG.md` — append-only AI learnings (новые грабли пишутся сюда, раз в неделю → MEMORY.md).
