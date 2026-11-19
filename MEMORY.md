# MEMORY.md — Open Finance

> Handoff проекта. Читается **вторым** шагом bootstrap'а (после `START.md`): полный рабочий контекст без reverse-engineering.
> **Фактический размер: 372 строки / 43,4K символов ≈ 13,8K токенов** (измерено `js-tiktoken`, o200k_base — 2026-08-12). Бюджет по `.claude/skills/of-end-session/SKILL.md`: **`LC_ALL=en_US.UTF-8 wc -m` ≤ 50 000 символов (НЕ `wc -c` — он считает байты, кириллица = 2 байта)** (строки — вторичная метрика, ориентир ≤ 400), **ни одна строка файла > 1100 символов** (сигнал, что запись пора разбивать или архивировать). При превышении — выносить нарративы в `docs/memory-archive/`, а не занижать оценку в шапке.
> Историю и детальные нарративы смотри в `docs/memory-archive/` (индекс — `docs/memory-archive/README.md`; читать **только по запросу**, не на старте).

## Bootstrap новой сессии (триггер «загрузи контекст Open Finance»)

1. **`START.md`** — карта проекта, жёсткие правила, маршрутизация задач (~5K токенов).
2. **`MEMORY.md`** (этот файл) — текущее состояние, ключевые файлы, активные грабли (**~13,8K токенов**).
3. **`git log --oneline -20`** — последние коммиты (~0.5K токенов).
4. (Опц., вне обязательных 3 шагов) **agentmemory MCP `memory_smart_search`** — точечно для исторических вопросов («когда мы перешли с X на Y»). См. `docs/MEMORY_SETUP.md`.

После обязательных 3 шагов = **≈19K токенов** и можно работать любой сложности. Дальше — **только релевантное конкретной задаче** (см. таблицу маршрутизации в `START.md`).

## Что НЕ загружать по умолчанию

- `CHANGELOG.md` (~4K строк) — только при вопросах про историю; иначе `git log`.
- `PLAN.md` (~1.4K строк) — только при стратегических вопросах; читать через `Read offset+limit`.
- `docs/memory-archive/*.md` — детальные нарративы (v0.10-v0.42, по версиям и по темам). Грузить только когда нужны детали конкретного фикса/миграции; индекс — `docs/memory-archive/README.md`.
- `docs/*.md` — каждый файл подгружается по таблице маршрутизации.
- agentmemory — НЕ для bootstrap'а; только точечная археология через `memory_smart_search` (mempalace deprecated с v0.22.4).

## Перед работой с библиотеками

Context7: `mcp0_resolve-library-id` → `mcp0_query-docs`. Не более 3 вызовов на задачу.

## После значимых изменений

**Канон ритуала — `.claude/skills/of-end-session/SKILL.md` (7 шагов). Не пересказывать здесь — читать оттуда.**

Оглавление: верификация → `CHANGELOG.md` → `MEMORY.md` (+ `LC_ALL=en_US.UTF-8 wc -m`, бюджет ≤ 50 000 символов — НЕ `wc -c`: он считает байты) → **`LEARNING_LOG.md`** → инвариант-файлы + анти-дрейф чек → (опц.) agentmemory `memory_save` → коммит + пуш (**сам**, без секретов — решение владельца 2026-11-19).

## Идентичность проекта

> **Цель пересмотрена 2026-11-17:** приватный хаб продавца на Pi, не публичный SaaS — канон `docs/HUB_PLAN.md`; роли моделей — `.claude/ORCHESTRATION.md`; сервер — `docs/SERVER.md`. Рабочая машина — Windows-ПК: абсолютных путей в доках не писать.
> **Решение владельца 2026-11-18 — хаб голова и центр по остаткам:** физический остаток и запись остатков в Ozon/WB — только хаб; сайты читают остатки и отдают хабу заказы. Канон — `docs/SITES_HUB_ARCHITECTURE.md`; хэндоффы по этапам 0, 3, 4 — в `docs/HUB_PLAN.md`.

**Open Finance** — AI-первая модульная финансовая платформа для предпринимателей РФ (селлеры OZON/WB/ЯМ, ИП, фрилансеры, малый бизнес).

- **Сейчас:** Next.js 15 SaaS.
- **Phase 2:** Tauri 2.0 desktop.
- **Phase 3:** React Native + Expo mobile.
- **Новые разделы — обычные страницы с вкладками и таблицами (решение владельца 2026-11-18, `docs/HUB_PLAN.md` §4); готового образца в проекте нет — все нынешние страницы, включая склад, собраны на BlockGrid; первой обычной страницей станет «Аналитика». Конструктор BlockGrid остаётся только на сводной и на уже существующих страницах; новые блоки — лишь плитки-витрины поверх общего слоя метрик.**
- **Источник правды версии:** первый заголовок `## [X.Y.Z]` в `CHANGELOG.md` + `git log` (`package.json` остался на `0.5.0`, не используется). UI читает версию через `src/lib/version.ts` (`APP_VERSION`), значение инжектируется в build-time из `CHANGELOG.md` через `next.config.mjs` → `env.NEXT_PUBLIC_APP_VERSION`. В доках версию НЕ хардкодить.

## Жёсткие правила

> Канон набора — `.cursor/rules/project-context.mdc`. Те же 14 пунктов в `CLAUDE.md`, `START.md`, `AGENTS.md`. **Меняешь одно — правишь все пять файлов.**

- **Git:** коммит + пуш делает агент сам в конце каждого этапа (решение владельца 2026-11-19) — после зелёной проверки и просмотра диффа на секреты; `.env*`, `*.local.md`, ключи и пароли не коммитить никогда (репозиторий открытый); без `--force`; сабагенты git не трогают.
- **БД-миграции:** не запускать автоматически (`db:push`/`db:migrate`) — давать команды.
- **Секреты:** не коммитить `.env`, ключи, пароли (см. `docs/SECURITY.md`).
- **Package manager:** только `pnpm`. Не `npm`/`yarn`.
- **ORM:** только Drizzle. **Не Prisma.**
- **AI SDK:** своя обёртка `src/lib/ai/providers/`. **Не Vercel AI SDK.**
- **Multi-tenant:** `tenant_id` в каждой таблице и каждом DB-запросе; `tenantId` — ТОЛЬКО из сессии (`requireTenant()`/`requireTenantRoute()`, `docs/TENANT_SCOPING.md`). Postgres RLS не используется.
- **AI-мутации:** только через Tools Layer (`src/lib/ai/tools/`). Не прямой SQL из AI.
- **Структура:** без `src/features/x/y/z`; домены — `src/lib/<домен>/` + `src/components/<домен>/` + `src/app/api/<домен>/` (`src/modules/` — исторический каркас, только README).
- **Импорты:** явные, без `import * as X`.
- **UI:** не использовать системные `alert/confirm/prompt` — только Dialog/AlertDialog.
- **Новые файлы:** начинать с `// PURPOSE: ...`.
- **Интерактивные CLI-команды:** `-y` / `--yes` / `--force` где возможно.
- **Удаление данных:** всегда с подтверждением пользователя + проверка `tenant_id` в запросе.

## Актуальный стек

| Слой | Технология |
|---|---|
| Frontend/API | Next.js 15 App Router, React 18, TypeScript, RSC |
| UI | Tailwind, shadcn/ui/Radix, Lucide, next-themes (light) |
| State | Zustand + TanStack Query |
| DB SaaS | PostgreSQL 16 + pgvector, Drizzle ORM |
| Auth | Свой JWT-cookie (`jose` + `bcryptjs`, `authDriver='minimal'`). **NextAuth НЕ установлен** — совместимы только имена экспортов; Google OAuth нет |
| Cache/Queue | **In-memory shim** `src/lib/redis.ts` (`ioredis`/`bullmq` НЕ установлены). Контейнер `redis:7` в compose поднимается, приложение к нему не ходит |
| AI | Ollama local + OpenAI-compat (Claude/OpenRouter/VseGPT/Custom) + YandexGPT + GigaChat через свою обёртку |
| Email | Свой IMAP поверх `net`/`tls` + `mailparser` (in), `nodemailer` (out). `node-imap` НЕ установлен |
| Markdown | `@mdxeditor/editor` (не TipTap) |
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
│   ├── app/              authenticated shell (`/app/*`, обычный сегмент — не route-group)
│   ├── (auth)/           login/register/forgot
│   └── api/              auth, blocks, cashflow, inbox, ai, boards, marketplaces, currency
├── components/
│   ├── blocks/           BlockGrid shell, chrome, dialogs, relations overlay
│   ├── micro-agent/      AI micro-agent dialog
│   ├── unit-economics/   калькуляторы, sync UI, biding picker
│   ├── marketplaces/     OzonSyncDialog, GlobalSyncIndicator
│   ├── workspaces/       workspace-switcher («кабинеты»)
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
│   ├── workspaces/       «кабинеты»: scope, active, queries
│   └── env.ts            typed env
├── modules/              business modules (cashflow, inbox, communications)
drizzle/init/             manual SQL: pgvector, boards, inbox, unit-economics, currency, marketplaces, analytics, sku-backfill
docs/memory-archive/      исторические разделы MEMORY.md (по запросу)
```

## Агентная обвязка `.claude/`

Карта — `.claude/README.md`; **актуальный состав смотреть через `ls .claude/{skills,agents,workflows}`** (числа и версии здесь НЕ хардкодим). Покрытие скилами: верификация, ритуал конца сессии (**канон** — `of-end-session`), smoke-тесты, новый блок / изменение схемы БД / **применение миграций** / AI-маршрут / AI-tool / колонка Ozon, маршрутизация памяти, **прод-деплой на Raspberry Pi** (`of-deploy-pi`) и **технический гейт публичного запуска** (`of-launch-check`). Сабагенты — доменные `of-*-dev` + read-only `of-code-reviewer`/`of-security-reviewer`. Воркфлоу — `of-test-sweep`, `of-review`, `of-rules-audit`. `settings.json` (permissions + hooks) **активен**; агент его сам не правит — изменения предлагает пользователю текстом. PreToolUse-хук `scripts/claude-rules-hint.sh` — аналог path-scoped правил Cursor (дедуп раз в сессию на домен).

**Инварианты обвязки (не нарушать):**
- Доменные правила живут ТОЛЬКО в `.cursor/rules/*.mdc` — скилы/агенты на них ссылаются, копии текста правил запрещены (уже было 4 дрейфующих копии до v0.41.0).
- Версии/счётчики строк нигде не хардкодить — источник версии: первый `## [X.Y.Z]` в `CHANGELOG.md`.
- Ритуал конца сессии каноничен в `of-end-session`; CLAUDE.md/AGENTS.md/START.md держат только резюме со ссылкой.
- mempalace/`sync-mempalace.sh` deprecated → agentmemory MCP (`memory_save`/`memory_smart_search`, только археология).
- Глобальный скил `/ship` в этом репо запрещён (коммитит сам).
- Контроль дрейфа — воркфлоу `of-rules-audit` на минорный релиз.

## Block-Grid — фундамент UI

Существующие страницы построены на `<BlockGrid />`; новые разделы на нём НЕ строим (см. «Идентичность проекта»). Ниже — как устроен конструктор.

### Ключевые файлы
- `src/lib/blocks/types.ts` — `BlockDef`, `BlockInstance`, `BlockDependencies`, `BlockAppearance`, `PageLayout`.
- `src/lib/blocks/registry.ts` — `ALL_BLOCKS`, `DEFAULT_LAYOUTS`, `BLOCK_META` (iconName для RSC), `BLOCK_PRESETS`.
- `src/components/blocks/block-grid.tsx` — drag/resize/save, переключатель `viewMode` Грид↔Карта (кнопка `Карта`), AI dialog, auto-mount providers.
- `src/components/blocks/{block-mindmap,block-node,ghost-node}.tsx`, `src/components/blocks/map-previews/`, `src/lib/blocks/mindmap-layout.ts` (v0.30-v0.31.1) — режим «Карта» на `@xyflow/react` v12 (ленивый `next/dynamic(ssr:false)`): узлы/рёбра из `collectBlockRelationEdges`, collapsed → read-only превью из реестра `MAP_PREVIEWS`, expanded → живой блок, призрачные узлы блоков соседних разделов. Детали (seed-and-persist раскладки, `sizeOf`, билдеры превью, `computeCompactLayout`, snap-16) — `docs/memory-archive/v0.30-v0.31-mindmap.md`.
- **Деньги в превью карты:** дефолт КОПЕЙКИ→рубли (`KOPECK_SCALE=0.01`); исключения (уже рубли) — `unit.ozon-top-ads`/`-search-phrases`/`-abc`; money-флаг читается из `__money`. `excel.cell` НИКОГДА не показывает сырую формулу `=…`; `custom.data` — live-агрегаты с фолбэком на config-таблицу.
- **`__spark` (мини-графики карты):** чарт/KPI-блоки публикуют CSV-серию через `serializeSpark(values, max=40)` (`src/lib/blocks/values.tsx`), превью рисует area-спарклайн. Источники: `unit-ozon-chart`, `chart-cashflow`, `unit-ozon-kpi`. `unit.ozon-analytics` серию не публикует (только per-SKU rows).
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

### Воркспейсы («кабинеты») — ГОТОВО (v0.48.0, Этап 3 LK_V2_PLAN; миграции 0010+0011 применяет пользователь)

- **Схема:** `workspaces` (`src/lib/db/schema/workspaces.ts`: uniq `(tenant_id,user_id,slug)`, template `seller-ozon|blank`); `block_layouts.workspace_id NOT NULL` + uniq `(workspace_id,page_key)`; `unit_economics_tabs.workspace_id NOT NULL` (0011) + uniq `(workspace_id,page_key)`; `block_ai_reports`/`section_ai_reports.workspace_id` **nullable** (legacy NULL-отчёты видны только в default-кабинете, правило `includeLegacy`); `users.settings jsonb` (`activeWorkspaceId`). Миграции: `drizzle/0010_workspaces.sql` (двухфазная, бэкфилл «Кабинет 1») + `0011_workspace_ue_tabs.sql` (UE-вкладки NOT NULL + swap uniq; **накатывать вместе с 0010**) + идемпотентный миррор `drizzle/init/16-workspaces.sql`.
- **Скоупинг-ядро:** `src/lib/workspaces/scope.ts` (pure: `WORKSPACE_COOKIE='of_active_workspace'`, `isSharedPageKey` = `nav`+`board-*` → ВСЕГДА default-кабинет, `pageWorkspaceScope`/`activeWorkspaceScope`) + `active.ts` (React `cache()`: кука → users.settings → default) + `queries.ts` (CRUD, клон копирует раскладки+UE-вкладки и пропускает общие, `workspaceScopeCondition`). **AI-отчёты роуты используют `getPageWorkspaceScope`** (board-* отчёты общие); `getActiveWorkspacePageScope` — только UE-вкладки.
- **API/UI:** `/api/workspaces` CRUD + `/api/workspace/active` (httpOnly-кука+settings); `workspace-switcher.tsx` в шапке `src/app/app/layout.tsx` (Dialog rename, AlertDialog delete, создание пустой/шаблон/клон). `blocks/layout/[pageKey]` принимает `?workspaceId=` с валидацией принадлежности — BlockGrid шлёт его во всех вызовах (`layoutUrl`), это защита от `flushSave()` на unmount ПОСЛЕ смены куки (один ремоунт по `key={workspaceId+pageKey}` не спасал). Изоляция @-ссылок: sources/relations/UE-импорты перечисляют страницы только активного кабинета + общие `board-*`.
- **Шаблоны:** `WORKSPACE_TEMPLATES` в `src/lib/blocks/default-layouts.ts` (вынос DEFAULT_LAYOUTS из registry, импортируемо без client-catalog; `getDefaultLayout(pageKey, template?)`); `seller-ozon` = новый дефолт-дашборд (ozon-kpi/chart/analytics/warehouse-clusters(warehouse)/abc/data-health + примеры), `blank` — все страницы пустые. Smoke `scripts/test-workspace-templates.ts` (38).
- **Инварианты:** upsert раскладки target = uniq `(workspace_id,page_key)` — tenant_id в target невозможен (ON CONFLICT обязан совпадать с индексом), защита = валидация workspaceId вызывающим (`resolveWorkspaceId`→default либо `getWorkspaceById` tenant+user). `BlockInstanceSchema` НЕ содержит workspace_id (он вне блока).

### Текущий каталог блоков

**Cashflow** (`stat.income`, `stat.expense`, `stat.balance` помечены `tags:['legacy']`): `stat.income`, `stat.expense`, `stat.balance`, `stat.custom`, `cashflow.top-categories`, `cashflow.transactions`, `chart.cashflow`, **`kpi.grid`** (v0.20.0).

**Generic**: `sheet`, `excel.cell`, `custom.data`, `navigate.card`, `computed.sum`, `ai.micro-agent`, **`note.markdown`** (v0.28.0).

**Inbox**: `inbox.channel-feed`, **`inbox.dashboard`** (v0.19.0).

**Unit Economics**: `unit.ozon-calculator`, `unit.ozon-multi-table`, `unit.yandex-calculator`, `unit.my-store-table`.

**Ozon Analytics** (v0.17.2+): `unit.ozon-analytics`, `unit.ozon-kpi`, `unit.ozon-chart`, `unit.ozon-top-ads`, `unit.ozon-stock-clusters`, `unit.ozon-warehouse-clusters`, `unit.ozon-search-phrases`, `unit.ozon-campaigns`, `unit.ozon-data-health`, `unit.ozon-abc`, `unit.ozon-ai-insights`.

**Финансы**: `currency.rates`.

## Реализованные страницы

> Все внутренние страницы — под префиксом **`/app/*`** (с v0.42.0). Актуальный список — `find src/app/app -name page.tsx`.

- **BlockGrid-разделы:** `/app/dashboard`, `/app/cashflow` (CRUD/импорт транзакций), `/app/inbox`, `/app/boards` + `/app/boards/[boardId]` (`pageKey = board-{boardId}`), `/app/unit-economics` (4 default-вкладки + custom через `unit_economics_tabs`), `/app/marketplace` (каталог блоков, browse-only), `/app/marketplaces/ozon` (`SyncAllButton` → `OzonSyncDialog`).
- **Настройки:** `/app/settings` (видимость блоков, форматирование, разделы), `/app/settings/integrations` (Ozon Seller API, тогглы sync, тест/sync/история job'ов, «Догрузить»), `/app/settings/ai` (BYOK-ключи провайдеров).
- **Админка:** `/app/admin`, `/app/admin/deletion-requests`, `/app/admin/ai/{local-models,providers,system-prompt}`.
- **Вне `/app`:** `/app/onboarding` (визард после регистрации) — внутри; на корне `/login`, `/register`, `/forgot-password`, `/reset-password` (`src/app/(auth)/`; reset — Suspense + `useSearchParams`), лендинг `/`, публичная `/privacy`.
## Активные грабли (последние версии)

> Диапазон в заголовке НЕ хардкодим — записи ниже отсортированы по убыванию версии.
> Исторические нарративы вынесены в `docs/memory-archive/` (индекс — `docs/memory-archive/README.md`): пер-версионные `v0.10-v0.16`, `v0.17`, `v0.18`, `v0.19-v0.20`, `v0.21-v0.22` + тематические `v0.21-v0.27-ui-blocks`, `v0.22-v0.40-my-store`, `v0.30-v0.31-mindmap`, `v0.32-v0.36-ai-analysis`, `v0.42-app-prefix`. Здесь — только то, что действует сегодня.

- **Молчаливые деградации синка Ozon (v0.54.0)** — три дефекта одного класса, каждый рапортовал успех. (1) **Упавший синк двигал `lastSyncAt`**, а пресет `auto` строил от него окно и схлопывался в «только вчера» → на проде дыра 01–18.08, дашборд показывал −51,7% выручки вместо +17,2%. Правило: `lastSyncAt` = «когда последний раз ПЫТАЛИСЬ», покрытие данными = `max(date)` в таблице; **инкрементальный загрузчик обязан определять окно по факту наличия данных, а не по журналу своих запусков**. Теперь при ошибке `lastSyncAt` не двигается (`src/lib/marketplaces/last-sync-plan.ts` — чистый, тестируемый), окно `auto` берёт более раннюю из «от lastSyncAt» и «от покрытия». Ограничение: `max(date)` ловит только **хвостовую** дыру; внутреннюю надо закрывать вручную произвольным диапазоном (детект пропусков внутри окна дал бы ложные срабатывания — день без продаж легитимно пуст). (2) **`realization` не грузился ни разу**: слали `{date:'YYYY-MM'}` вместо `{year, month}` числами → 400, ошибка тонула в `console.warn`, а схема была от v1 и `.passthrough()` со всеми `.optional()` — приняла бы чужую форму и записала нули. **Денежные поля схем внешних API делать обязательными**; `.passthrough()` + сплошные `.optional()` = отключённая проверка. Маппинг проверять независимым источником (сверка с `ozon_transactions` дала долю вознаграждения 36,21% против 36,19%). (3) **`/v3/posting/fbs/list` не проходит схему на каждом синке** (`delivering_date: null`, ждём строку) — данные не теряются, клиент lenient и отдаёт raw, но лог зашумлён; схему стоит поправить. **Мета-грабля:** 11 проверок в `test-ozon-{perf-period,analytics}` были красными с v0.18.3 — на фоне привычных красных строк новая не выделяется, и это то условие, при котором дефект `realization` выжил месяцами. Красный прогон чинить сразу, разбирая каждую проверку (все 11 оказались устаревшими ожиданиями, код был прав). До v0.54.0 **автозапуска синка не было вовсе** — только кнопка в браузере.
- **Склад: движения и продажи каналов (v0.53.0, Релиз 2)** — `transfer`/`accept`/`regrade`/`sale` + импорт продаж WB и ЯМ. **Парные ноги решены ССЫЛКОЙ, а не сохранённой суммой:** `stock_moves.pair_move_id` + `stock_doc_lines.pair_line_no`, приходная нога берёт стоимость пары из ТОГО ЖЕ прогона реплея. Причина: расходная нога переоценивается при вводе поставки задним числом, и снимок суммы перестал бы гасить оригинал → Σ по документу уехала бы молча. Флаг `isPaired` (как `isReversal`): парная нога НЕ гасит дефицит, НЕ обновляет lastCost, НЕ пересматривает базис НДС — каждый пункт по отдельности ломает Σ=0. Перемещение между journaled-местами НЕ трогает партии. Реплей стал мультитоварным (донор пересортицы в чужой ленте) и замыкается по парам. Чистый планировщик — `src/lib/stock/doc-plan.ts`. Продажи каналов — отдельный тип `sale`, НЕ `writeoff` (иначе COGS попадает в потери, §1.8). Идемпотентность импорта — ключ «канал+день», не файл (недельные выгрузки перекрываются); `voidDoc` обнуляет `source_ref`, иначе исправленный файл за тот же день не загрузить. Миграция 0015. Тесты: `test-stock-doc-plan` (118), `test-stock-sales-import` (80) — всего по модулю 467.
  **Грабли ревью (повторяются — проверять в новом коде):** витринные денежные метрики нельзя считать `reduce`'ом по LIMIT-выборке (было в «Деньгах под риском» и в карантине) — только отдельным агрегатом без LIMIT + честный `truncated`; `unit_cost_kopecks` — витринное поле, для оценки брать `coalesce(cost_override, avg_cost)`; `mpShortage ⊆ loss` — публиковать непересекающуюся пару, иначе двойной счёт в KPI; юникод-минус нормализовать в `money.ts` (ломал выручку, не количества); полупрозрачные sticky-шапки — канон `bg-card` + `isolate`, дефект дважды приходил в новый код.
- **Склад · Поставки · Себестоимость (v0.52.0)** — модуль, убравший бумажный учёт закупок. Канон дизайна — `docs/STOCK_MODULE_DESIGN.md` (§12 — решения владельца). 9 таблиц (`schema/stock.ts`, `stock-ledger.ts`), склад ОДИН общий (`workspace_id` нет нигде), миграции 0013+0014. **Инварианты:** единственный источник правды по подконтрольным местам — `stock_moves` (остаток = `SUM(qty_delta)`); остатки складов Ozon мы НЕ ведём (их отдаёт `ozon_warehouse_stocks`); стоимость хранится СУММОЙ, списание — доля от остаточной стоимости пула (при исчерпании берётся остаток целиком → нулевой дрейф); потери ≠ COGS; расход без покрытия → карантин, а не «бесплатный товар»; ни одной операции без документа, удаления проведённого нет — только сторно. **Стоимость проставляет полный реплей после записи документа**, а не вставка: документ вводят задним числом, и он меняет среднюю по всей последующей цепочке; сторно берёт ПЕРЕСЧИТАННУЮ стоимость оригинала. Базис НДС (`gross`/`net`) живёт НА ДОКУМЕНТЕ и В ПАРТИИ, глобальная настройка — только дефолт: переключение действует вперёд, старые партии остаются читаемыми. Writeback пишет только `cost_kopecks`/`cost_source`/`cost_updated_at` и только у строк `cost_source='inventory'`; количества — территория синка Ozon. Тесты: `test-stock-{costing,matching,replay,money}` — 251 проверка. **Грабля:** парсер денег обязан быть ОДИН (`src/lib/stock/money.ts`) — превью со «своим» парсером показывало 0 ₽ там, где документ проводился на 1200 ₽.
- **Юнит-экономика: расчётные инварианты после сверки с эталоном (v0.51.0)** — калькуляторы считали неверно, сверка с «Синим Рассветом» дала 20+ подтверждённых расхождений. Действующие правила: логистика **делится на % выкупа** (её платят и невыкупленные заказы); НДС **извлекается** из цены (`× r/(100+r)`), не начисляется сверху; база УСН Д-Р — реальные расходы расчёта + минимальный налог 1%; соинвест/СПП — **справочная величина и налоговая база, в P&L не входит**; скорость отгрузки FBS — **скидка** к комиссии (две сетки по точке сдачи), приёмка FBS зависит от точки сдачи и делится на выкуп, приёмка FBO — разово на единицу; локальность — 3 п.п. к **комиссии** (не к логистике). Яндекс: выручка = цена **продавца**, спецтариф **заменяет** комиссию, «фулфилмента» в тарифах ЯМ нет. **Главная грабля процесса: UI импортировал лейблы из старого тарифного пака и врал на экране** («+2% ком.» при фактической скидке −2%; тумблер приёмки в чужой вкладке) — после бампа пака ОБЯЗАТЕЛЬНО грепом проверять импорты. Актуальные паки: `ozon/tariffs-2026-08-30.ts`, `yandex/tariffs-2026-07-01.ts` (апрельские заморожены). Тесты-эталоны: `scripts/test-unit-economics.ts` (114), `scripts/test-yandex-calc.ts` (54). Канон правил — `.cursor/rules/unit-economics.mdc`; открытые вопросы и следующий этап (полная матрица логистики) — `docs/ROADMAP_V2.md`.
- **Сырой NUL-байт в исходнике + грабли ревю-инфраструктуры (v0.48.0)** — в `cluster-agg.ts` разделитель составного ключа попал в файл сырым байтом 0x00: typecheck/рантайм молчат, но `file` детектит «data», grep отвечает «Binary file matches», git показывает диффы как «Binary files differ». Управляющие символы в строках — ТОЛЬКО эскейпами (`\x00`/`\0`). Проверка (bash НЕ умеет передавать NUL в аргументе, поэтому `grep $'\x00'` = пустой паттерн и матчит всё): `file <файл>` → «data» вместо «UTF-8 text», либо `tr -d '\0' < файл | cmp -s - файл || echo "есть NUL"`. Вторая грабля той же сессии: verify-агенты воркфлоу `of-review` могут умирать по лимитам — тогда реальные находки выпадают из финального отчёта как «неверифицированные»; при `<failures>` в нотификации читать `journal.jsonl` воркфлоу и доверифицировать руками.
- **Ротация секрет-ключей + fire-and-forget sync (v0.47.1)** — смена `INBOX_SECRET_KEY`/`MARKETPLACE_SECRET_KEY` ломает расшифровку сохранённых кредов (AES-GCM auth fail: «Unsupported state or unable to authenticate data») → `runFullSync` падал до `setSyncJobRunning`, job висел `pending` навсегда («подготовка к синхронизации» в UI). Фиксы: try/catch-обёртка `runFullSync` (финализация error), кандидаты ключей в `decryptSecret` (primary→legacy→dev-fallback dev-only), `failStaleSyncJobs` (>10 мин pending→error) в `GET /jobs/active`. После ротации ключей — `pnpm admin:reencrypt-secrets` (`scripts/reencrypt-secrets.ts`, старые ключи в `LEGACY_SECRET_KEYS`; покрывает marketplace_accounts + inbox_channels).
- **`/app`-префикс, глобальные скелетоны, TanStack Query (v0.42.0)** — все внутренние страницы под `/app/*`; старые закладки живы через `redirects()` в `next.config.mjs`. Действующие контракты: `skeletonVariant` — **строка** в `BLOCK_META`/`BlockDef` (RSC-safe, как `iconName`; компонент в `BlockDef` НЕ класть), `BlockChrome` рисует overlay-скелет только на **первую** загрузку (сиблинг контента, `z-[5]`), `useReportBlockLoading` ставим ТОЛЬКО в client-fetch блоки (Ozon ×11, inbox-feed, currency — cashflow/`kpi.grid` гидрируются из RSC, там no-op); **route `loading.tsx` НЕ покрывает холодный вход**, пока async-`layout.tsx` сам `await`'ит БД. TanStack Query — `src/components/query-provider.tsx` (`staleTime 60с`, `gcTime 5мин`). Отложен Этап 3c (per-block `useQuery`-кэш тяжёлых Ozon-блоков) — `PLAN.md` → «Отложенные задачи». Детали — `docs/memory-archive/v0.42-app-prefix.md`.
- **Блок «Мой магазин»: Excel-режим, условное форматирование, перформанс (v0.38.0-v0.40.0)** — `src/lib/blocks/catalog/unit-my-store-table.tsx` + чистое ядро `src/lib/unit-economics/my-store-compute.ts` (тест `scripts/test-my-store-compute.ts`, 15 кейсов). Действующие правила: (1) **per-cell override формульной колонки — ТОЛЬКО `=`-строка**; сырые числа в `row.values` формульной колонки «осиротевшие» и ИГНОРИРУЮТСЯ; (2) **перф-паттерн тяжёлых таблиц** — виртуализация окном по `scrollTop` (`ROW_H=30`, порог 60), `React.memo` строки со своим `computeRowValues`, стабильные row-колбэки через `configRef`/`onConfigChangeRef`, узкая подписка на стор через сигнатуру привязок (`boundSig`), dumb-ячейка с локальным draft и **flush на unmount**; переиспользовать в любых новых больших таблицах; (3) цветовая шкала колонки — ТОЛЬКО цвет текста; тинты Tailwind писать ЛИТЕРАЛАМИ (`bg-${k}-50` purge'ится); (4) `isCellFormulaValue` НЕ type-guard (иначе TS сужает else-ветку до `number`). Детали и история — `docs/memory-archive/v0.22-v0.40-my-store.md`.
- **AI-анализ разделов и блоков (v0.32.0-v0.36.0)** — `/api/ai/analyze-section`, `/api/ai/analyze-block`, `/api/marketplaces/ozon/ai-insights`; отчёты в `section_ai_reports` / `block_ai_reports` / `ozon_ai_insight_reports`. Действующие правила: **trust boundary** — блоки и разделы, не смонтированные на клиенте, резолвятся ТОЛЬКО на сервере из БД по ref'ам `{pageKey, blockId, mode}` (клиенту не доверяем тело); **лимит 10 отчётов** на блок/раздел → `409 {needsOverwrite, oldest}`; **паритет токенов** держится единой сборкой контекста `assembleSectionContext` (`src/lib/ai/section-insights.ts`) для клиент-счётчика и сервер-промпта; конвенция `__aiContext` (богатый текст блока для ИИ, служебное `__`-поле); `key={blockId}` в shell-модалках (иначе «прилипает» прошлый результат); `js-tiktoken` + ранги грузить лениво client-only. Детали — `docs/memory-archive/v0.32-v0.36-ai-analysis.md`.
- **Блоки и UI v0.21.0-v0.27.2** (Universal Import/Export, `custom.data` sheet-style + fill-handle, единая система периодов, дизайн-система настроек, конвенция копеек, Ozon dashboard polish, source binding, `unit_economics_tabs`) — нарратив в `docs/memory-archive/v0.21-v0.27-ui-blocks.md`; живые правила из этого пласта перенесены в «Universal грабли» ниже.

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
- **Версионирование тарифов unit-economics** — никогда не редактировать существующий tariff pack inplace; добавлять НОВЫЙ ФАЙЛ `tariffs-YYYY-MM-DD.ts` рядом со старым (`src/lib/unit-economics/{ozon,yandex}/`) и бампать константу; её ЗНАЧЕНИЕ имеет вид `ozon_YYYY_MM_DD` — это не имя файла.
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
- **`parseConfig`/Zod в теле Render-компонента = input lag.** Всегда `const config = useMemo(() => parseConfig(instance.config), [instance.config])` — иначе новые ссылки на `columns/rows/moneyRefs` бьют все `useMemo` ниже по дереву. Поля названий — локальный draft + commit на blur/Enter. `Intl.NumberFormat` кэшировать на модульном уровне.
- **Копейки в паблишере:** любое денежное поле в `useBlockValuePublisher` публикуется в КОПЕЙКАХ (×100); `formatRublesWithSettings` всегда делит на 100. Дисплейные цепочки блоков (напр. `formatCustomDataRubles`) — отдельны и принимают рубли.
- **Любая настройка из шапки блока ОБЯЗАНА персиститься** через `onConfigChange` (`compareMode`, режимы, тогглы) — иначе сбрасывается на дефолт при ре-рендере.
- **Live-значение всегда выигрывает у snapshot'а:** `liveValues[name] ?? config.blockRefs[name] ?? null` (snapshot — только фолбэк, когда блок-источник не смонтирован).
- **`__periodKey` конвенция** — блоки с периодом публикуют `__periodKey: formatPeriodKey(period)`; пикеры и оверлеи показывают тег. Добавлять в каждый новый period-блок (`useBlockPeriod`, `docs/PAGE_PERIODS.md`).
- **Корневым контейнерам секций внутри `DialogContent`** (это `display:grid`, у grid-item `min-width:auto`) ставить `min-w-0` — иначе длинный неразрывный токен (формула, артикул) распирает модалку.
- **Recharts:** для любых осей с `hide:true` передавать в layout ширину 0 (`src/components/blocks/chart-shell.tsx`) — `hide` НЕ убирает зарезервированные 56px, несколько скрытых осей съедают видимую.
- **`PeriodPicker` в шапке блока — только `collapsed compact`** (в SettingsForm — обычный).
- **Inline-редактирование ячеек** (custom.data, Excel-режим «Мой магазин»): канонический паттерн — `cardRef`-smart-blur (focus внутри блока / открыт picker → не коммитим) + `useLayoutEffect` с `pendingCaretRef` для восстановления каретки после programmatic-вставки. `setTimeout(0)` НЕ работает.
- **В новых SettingsForm — только примитивы из `src/components/blocks/settings/`** (`SettingsToggleRow`, `KopecksRow`, `SettingsSegmented`, `SettingsSliderRow`, `SettingsSection`, `SourceBlockPicker`).

## VPN / VLESS (v0.50.0, Этап 4 LK_V2_PLAN)

- **Ядро:** `src/lib/ai/vpn/{vless,subscription,ip-guard,spool,admin}.ts` — парсер vless:// и подписок, `buildXrayConfig` (inbound строго `http 127.0.0.1:10809`, `log.access:"none"`), SSRF-гард, атомарная запись spool, гейт/шифрование/аудит. Смоук `scripts/test-vless-parse.ts` (14).
- **API/UI:** `/api/admin/ai/vpn{,/apply,/subscription,/status}` (super_admin + rate-limit + `aiAuditLog`), карточка `src/app/app/admin/ai/providers/vpn-card.tsx` (режимы «Ссылка | Подписка»). Настройки — `tenants.settings.aiVpn` (ссылка/URL шифрованы; `servers[]` только метаданные). Ссылка наружу НИКОГДА не отдаётся.
- **Хост-путь:** `deploy/xray/{of-xray-apply.sh,.path,.service,README.md}` — web пишет spool, root-овый path-юнит валидирует и применяет. Инварианты и грабли (TOCTOU, symlink, allowlist, SSRF hex-IPv6, `mktemp --suffix=.json`) — в `.cursor/rules/security.mdc` §VLESS/Xray.
- **Vision через прокси:** `src/lib/ai/vision/proxy-fetch.ts` для провайдеров с `requiresVpn` (claude/openai); yandex/tesseract/mock — напрямую. Доки: `docs/VPN_FOR_AI.md` (актуален), `deploy/xray/README.md`.
- **На Pi установлено и проверено сквозным прогоном** (v0.50.0): юниты enabled, spool `firay:firay 0700`, конфиг Xray `root:nogroup 0640`, `status.json → ok/applied`.

## AI Micro-Agent runtime

- `src/app/api/ai/chat/route.ts` — NDJSON streaming, `resolvePromptStack()`, `getActiveCredentials()`, `parseAction()`.
- `src/components/micro-agent/micro-agent-dialog.tsx` — dialog с streaming, Stop, token counter.
- `src/lib/ai/providers/{ollama,openai-compat,proxy,yandex-gpt,gigachat}.ts` — provider layer.
- `src/lib/ai/prompt-resolver.ts` — `resolvePromptStack()` (все AI-routes).
- `src/lib/ai/user-keys.ts` — `getActiveCredentials()` (user > tenant > Ollama).
- `src/lib/ai/sections.ts` — 6 SECTION_GROUPS + `resolveSectionGroup()`.
- `src/lib/ai/prompts/` — block-skills (по типу блока, см. `src/lib/ai/prompts/block-skills/`), section-defaults, pointwise.
- `src/components/blocks/section-ai-button.tsx` + `section-ai-dialog.tsx` — AI Анализ раздела.
- `src/app/api/ai/analyze-section/route.ts` — section analysis NDJSON stream.
- `src/app/app/settings/ai/` — per-user AI настройки (ключи).
- `src/app/api/ai/credentials/route.ts` — CRUD per-user ключей.
- События: `start`, `token`, `done`, `error`, `aborted`.
- Приоритет промптов: `aiPromptSupplement (max 500) > aiPrompt (deprecated) > legacy config.blockPrompt`.
- Приоритет credentials: `user_ai_credentials (enabled) > tenants.settings.aiExternal > Ollama`.
- `parseAction()` понимает fenced/unfenced JSON, `update_block`, `create_block`, `text_only`.

## Аккаунт / 152-ФЗ (краткая навигация, v0.44.0)

- **Согласие на ПДн:** `users.consent_version`/`consent_at`; версия и реквизиты оператора (плейсхолдеры!) — `src/lib/legal.ts` (`PRIVACY_POLICY_VERSION`). Обязательный чекбокс на `/register` + валидация `consent` в `/api/auth/register` → пишется в `register()` action.
- **Privacy policy:** публичная `/privacy` (`src/app/privacy/page.tsx`), добавлена в `PUBLIC_PATHS` middleware.
- **Удаление аккаунта (ручное подтверждение super_admin):** таблица `account_deletion_requests` (FK `SET NULL` + email-снапшот → строка-аудит переживает удаление), queries `src/lib/account/deletion-queries.ts`. Self-service — settings `danger-zone.tsx` + `/api/account/{deletion-request,ai-data}`. Очередь — `/app/admin/deletion-requests` + `/api/admin/deletion-requests` (POST=super_admin, каскад tenant+user через FK CASCADE).
- **Очистка AI-данных:** `clearUserAiData()` — отчёты блоков/разделов + Ozon AI-инсайты + BYOK (`user_ai_credentials`), скоуп tenant+user.
- **Миграция:** `drizzle/0009_conscious_squirrel_girl.sql` / `drizzle/init/15-account-deletion.sql` (НЕ применять автоматически — команды пользователю).

## Marketplace Integrations (краткая навигация)

- **Foundation (v0.17.0):** `src/lib/db/schema/marketplaces.ts`, `src/lib/marketplaces/{types,crypto,queries}.ts`, `src/lib/marketplaces/ozon/{client,endpoints,types,upsert,upsert-plan}.ts`, `sync/{products,prices,stocks,orders,realization,transactions,turnover,analytics-data,clusters,warehouse-stocks,fbs-warehouse-stocks,perf-{campaigns,sku-stats,cpo-daily,expense-daily}}.ts`.
- **Остатки FBO+FBS (v0.49.0, Этап 2b/2c):** `ozon_warehouse_stocks.source ('FBO'|'FBS') + warehouse_id + warehouse_type`, uniq `(account,sku,warehouse_name,source)` (миграция 0012 + init/17). Стейдж `fbsWarehouseStocks`; окно снапшота чистится по `(tenant,account,source)` ТОЛЬКО через `replaceWarehouseStocksWindow()` (транзакция, батчи 500, дедуп). Блок остатков: сегмент «Все|FBO|FBS» (`config.source`), FBS — псевдо-кластер «FBS (свои склады)» (не «Без кластера»), `meta.bySource`. `/v1/product/info/stocks-by-warehouse/fbs` без пагинации (чанки SKU по 500). Детали-грабли — `marketplaces.mdc` §Seller API.
- **Settings:** `src/app/app/settings/integrations/{page,integrations-client}.tsx`.
- **Блоки sync UI:** `src/components/unit-economics/{ozon-sync-button,ozon-sync-settings-form,ozon-sync-preview-dialog,ozon-sync-section}.tsx` + `ozon-sync-diff.ts`.
- **Universal sync dialog:** `src/components/marketplaces/ozon-sync-dialog.tsx` + `ozon-sync-presets.ts` (v0.22.1+).
- **Global sync indicator:** `src/components/marketplaces/global-sync-indicator.tsx` (mount в `src/app/app/layout.tsx`).
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

- **Inbox MVP** (v0.10-v0.19, parser v0.24.4, render v0.29.0): `src/lib/inbox/*` + `src/lib/db/schema/inbox.ts`, `src/lib/blocks/catalog/inbox-{channel-feed,dashboard}.tsx`. IMAP test/sync (Beget STARTTLS fallback). AES-256-GCM (`INBOX_SECRET_KEY`). **Парсинг через `mailparser.simpleParser`** (v0.24.4) — nested multipart, charset, encoded-words, QP/base64. **`body_html` колонка**. **Рендер HTML письма — sandboxed `<iframe srcdoc>`** (v0.29.0): `sanitizeEmailHtml` (DOMPurify, разрешены `<style>`/class/id/font для достоверной вёрстки + скрытия preheader) + `buildEmailSrcDoc` (charset utf-8, `<base target=_blank>`, гейтинг картинок). `sandbox` без `allow-scripts`/`allow-same-origin` — JS писем не исполняется. Картинки on-demand с внешних URL по кнопке (в DB не хранятся). **`lib/inbox/clean-text.ts`** — `decodeEntities`/`cleanPreview`/`cleanPlainTextBody` против preheader-мусора `&zwnj;`. Sync default 200, `?limit=N` clamp 1..500. AI Vision: `AiRecognizePanel` + `/api/inbox/messages/[id]/recognize`.
- **Currency** (v0.16.0): `src/lib/{db/schema/currency,currency}/*`, `src/lib/blocks/catalog/currency-rates.tsx`. ЦБ через `cbr-xml-daily.ru`, lazy-refresh 23h. **Курс НЕ money-формат.**
- **Boards** (foundation): `src/lib/{db/schema,boards}/*`, `src/app/app/boards/*`, `boardPageKey(id) → 'board-{id}'`.

## Дизайн-система

- Linear/Notion-inspired: плотная типографика, тонкие borders, минимум теней.
- `html { font-size: 14px }`, компактные shadcn variants.
- Toolbar `size="sm"`/`xs`, icons 14/16/20px.
- Не использовать системные `alert/confirm/prompt`.
- Empty states всегда с CTA.

## AI memory — agentmemory

> Канон установки/диагностики — `docs/MEMORY_SETUP.md`; маршрутизация «куда писать / где искать» — `.claude/skills/of-memory/SKILL.md`. Старый mempalace **deprecated с v0.22.4** (`docs/MEMPALACE_RUNBOOK.md`).

- Сервер `agentmemory` на localhost:3111 (viewer 3113), launchd-агент `com.agentmemory.server`, локальный SQLite в `~/.agentmemory/`, поиск BM25 + local embeddings + KG через RRF. Health: `curl http://localhost:3111/agentmemory/health`.
- MCP tools: `memory_save` / `memory_smart_search` / `memory_recall` / `memory_sessions` (51 в proxy mode; если сервер лёг — 7 fallback-tools, работа не блокируется).
- **Назначение — только семантическая археология** («когда/почему перешли с X на Y»). НЕ источник правды и НЕ часть bootstrap'а: текущее состояние = `MEMORY.md` + `git log`.
## Команды

```bash
pnpm install && pnpm docker:up          # зависимости + Postgres/Redis в Docker
pnpm dev                                # Next.js
pnpm typecheck && pnpm build && pnpm lint
pnpm check:tenant-isolation             # cross-tenant гейт (docs/TENANT_SCOPING.md)
pnpm tsx scripts/test-<name>.ts         # smoke-тест; список — ls scripts/test-*.ts
```

- **Схема БД и миграции — командами пользователю, самому не запускать.** Канон: `.claude/skills/of-db-change/SKILL.md` (схема) и `.claude/skills/of-db-migrate/SKILL.md` (применение, dev/прод, baseline журнала при рассинхроне).
- Все init-файлы разом: `for f in drizzle/init/*.sql; do docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < "$f"; done`.
- **Прод-деплой на Raspberry Pi** — канон `.claude/skills/of-deploy-pi/SKILL.md` (+ `docs/DEPLOY_RPI5.md` как справочник по фазам и реестру граблей).
- Карта «домен → тесты» и прогон всех — `.claude/skills/of-run-tests/SKILL.md`; параллельно — воркфлоу `of-test-sweep`. **Грабля:** `pnpm tsx` в песочнице падает с `EPERM listen` — запускать без sandbox.
## Что отложили (канон — `PLAN.md` → «Отложенные задачи»)

- **Синхронизация:** BullMQ-cron авто-синка Ozon, Ozon Push API (вебхуки), incremental sync по `updated_at` (частично в v0.22.1), AI-tool `sync_ozon` для Cmd+K.
- **Интеграции:** коннекторы Yandex Market / Wildberries; аналитические блоки `ozon.sales-by-sku`, `ozon.commissions-vs-tariff` и др. — `docs/MARKETPLACES_FUTURE_PLAN.md`.
- **AI:** RAG-память и hybrid search в `src/lib/ai/memory/`, Telegram Bot канал, Whisper transcription, Cmd+K AI action.
- **Юнит-экономика:** парсер `СЕБЕС озон.xlsx`, сохранение `unit_calculations` из блоков, экспорт CSV/XLSX и share/permalink для калькуляторов.
- **Перформанс:** Этап 3c — per-block `useQuery`-кэш тяжёлых Ozon-блоков (нужен живой сервер для проверки sync-refresh/period).
## Файлы документации (по запросу задачи)

- `START.md`, `MEMORY.md`, `CLAUDE.md`, `AGENTS.md` — bootstrap + правила (читаются при загрузке контекста).
- `.cursor/rules/*.mdc` — path-scoped правила Cursor 2026 (auto-attach по globs).
- `CHANGELOG.md`, `PLAN.md` — только по запросу.
- `docs/memory-archive/*` — историческая память.
- `docs/MEMPALACE_RUNBOOK.md` — legacy mempalace (deprecated с v0.22.4; актуальная память — `docs/MEMORY_SETUP.md`).
- `docs/SECURITY.md` — **обязательно** при работе с секретами/сетью/биллингом.
- `docs/DEPLOY_RPI5.md` — справочник по минисерверу Raspberry Pi 5 16GB: фазы A-H первого деплоя, реестр граблей §11. **Канон рутины обновления — скил `.claude/skills/of-deploy-pi/SKILL.md`** (rsync → build → бэкап → migrate → restart → health → откат). Роли: пользователь прошивает ОС/даёт SSH, Claude настраивает и деплоит.
- `docs/CASHFLOW_BLOCKS.md`, `docs/KPI_GRID.md`, `docs/CUSTOM_DATA_BLOCK.md`, `docs/UNIT_ECONOMICS_TABS.md` — блочные системы.
- `docs/AI_TOOLS.md`, `docs/AI_VISION.md` — AI integration.
- `docs/MARKETPLACES_OZON_PERFORMANCE.md`, `docs/MARKETPLACES_FUTURE_PLAN.md`, `docs/OZON_ADS_GAP.md` — Ozon.
- `docs/LK_V2_PLAN.md` — **канон ЛК v2**: воркспейсы («кабинеты»), переработка блоков, VLESS-VPN (этапы).
- `docs/TENANT_SCOPING.md`, `docs/SECURITY_AUDIT.md`, `docs/SMARTCAPTCHA.md` — tenant-гейт I1 и аудит безопасности.
- `docs/AI_PROMPT_LAYERS.md`, `docs/AI_ENVIRONMENT_BLUEPRINT.md` — иерархия промптов и перенос схемы «памяти и правил».
- `docs/PAGE_PERIODS.md` — единая система периодов.
- `docs/BILLING.md`, `docs/LICENSING.md`, `docs/DESKTOP_STRATEGY.md`, `docs/DESKTOP_PLAN.md`, `docs/PERSONAL_USE.md`, `docs/ONBOARDING.md` — продуктовое.
- `docs/EMAIL_BEGET.md`, `docs/LOCAL_AI.md`, `docs/VPN_FOR_AI.md`, `docs/ARCHITECTURE.md` — инфраструктура (`docs/ARCHITECTURE.md` — целевая карта, часть блоков ещё план).
- `docs/MODULES.md` — исторический (описывает `src/modules/` + tRPC, которых в проекте нет); реальный реестр — `src/lib/modules/registry.ts`.
- `LEARNING_LOG.md` — append-only AI learnings (новые грабли пишутся сюда, раз в неделю → MEMORY.md).
