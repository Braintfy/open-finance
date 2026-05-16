# MEMORY.md — Open Finance

> Актуальный handoff проекта. Читается вторым шагом bootstrap'а (после `START.md`). Должен давать полный рабочий контекст без reverse-engineering.

## Быстрый старт для AI-агента (bootstrap, ~6–8K токенов суммарно)
1. **`START.md`** — карта проекта, жёсткие правила, маршрутизация задач (~1.5K токенов).
2. **`MEMORY.md`** (этот файл) — текущее состояние, ключевые файлы, грабли (~5K токенов).
3. `git -C /Users/firay/open-finance/open-finance log --oneline -20` — последние коммиты.

После этих 3 шагов можно работать. Дальше — **только релевантное конкретной задаче** по таблице из `START.md`.

## Что НЕ загружать по умолчанию
- `CHANGELOG.md` (1199 строк) — только при вопросах про историю; иначе хватает `git log`.
- `PLAN.md` (1420 строк) — только при стратегических вопросах; читать через `Read offset+limit` нужный раздел, не файл целиком.
- `mempalace wake-up --wing open-finance` — индекс содержит и устаревшие версии проекта (Tauri-only, Prisma, Python sidecar). Использовать `mempalace search "конкретный вопрос" --wing open-finance` точечно для исторических вопросов.
- `docs/*` — каждый файл подгружается только когда задача его касается (см. таблицу маршрутизации в `START.md`).

## Перед работой с библиотеками
Context7: `mcp0_resolve-library-id` → `mcp0_query-docs`, не более 3 вызовов.

## После изменений
`pnpm build`, обновить `MEMORY.md` (если меняются ключевые файлы/инварианты/грабли) и `CHANGELOG.md`. **Никогда** не делать `git add/commit/push` самому — давать команды пользователю.

## Идентичность проекта
**Open Finance** — AI-первая модульная финансовая платформа для предпринимателей РФ.
- **Цель:** персональный AI-финансист уровня управляющего: анализирует, прогнозирует, предупреждает и помогает действовать.
- **Формат:** SaaS на Next.js сейчас; Local-First/Tauri 2.0 — Phase 2; mobile — Phase 3.
- **Аудитория:** селлеры OZON/WB/Я.Маркет, ИП, фрилансеры, самозанятые, малый бизнес РФ.
- **Главная фишка:** Block-Grid UI как Lego + AI поверх всех данных пользователя.
- **Продуктовый референс:** Notion + Linear по UX, Copilot Money/Cleo по AI, 1С-light/MPStats finance по рынку.

## Жёсткие правила проекта
- **Package manager:** только `pnpm`, не `npm`/`yarn`.
- **ORM:** только Drizzle ORM, **не Prisma**.
- **AI SDK:** своя обёртка/провайдеры, **не Vercel AI SDK**.
- **Multi-tenant:** `tenant_id` в каждой таблице и каждом DB-запросе.
- **AI-мутации:** только через Tools Layer (`src/lib/ai/tools/`), не прямой SQL из AI.
- **Git:** не выполнять `git add`, `git commit`, `git push`; только дать команды пользователю.
- **БД:** не запускать миграции автоматически; дать команды пользователю.
- **Секреты:** не коммитить `.env`, ключи, пароли, токены; читать `docs/SECURITY.md` при любой работе с секретами/сетью/биллингом.
- **Новые файлы кода:** начинать с `// PURPOSE: ...`.
- **Импорты:** явные, без `import * as X`.
- **Структура:** не делать глубокую вложенность `src/features/x/y/z`; бизнес-модули плоско в `src/modules/`.

## Актуальный стек
- **Frontend/API:** Next.js 15 App Router, React 18, TypeScript, RSC.
- **UI:** Tailwind CSS, shadcn/ui/Radix, Lucide, next-themes.
- **State:** Zustand + TanStack Query.
- **DB SaaS:** PostgreSQL 16 + pgvector, Drizzle ORM.
- **Cache/Queue:** Redis 7 + BullMQ.
- **AI:** Ollama local, OpenAI-compatible external providers, Claude/OpenRouter/VseGPT/custom through project provider layer.
- **AI streaming:** NDJSON from `/api/ai/chat`.
- **Spreadsheet/formulas:** `fast-formula-parser`, custom Sheet/Excel Cell blocks.
- **Charts:** Recharts.
- **Grid:** `react-grid-layout`.
- **Node:** `>=20`, package manager `pnpm@9.12.3`.

## Структура проекта
```text
src/
├── app/                  # Next.js App Router pages and API routes
│   ├── (app)/            # authenticated app shell
│   ├── (auth)/           # login/register/forgot
│   └── api/              # auth, blocks, cashflow, inbox, ai, boards
├── components/
│   ├── blocks/           # BlockGrid shell, chrome, dialogs, relation overlay
│   ├── micro-agent/      # AI micro-agent dialog
│   └── ui/               # shadcn primitives
├── lib/
│   ├── ai/               # providers, micro-agent, tools, memory stubs
│   ├── blocks/           # types, registry, catalog, values, relations
│   ├── boards/           # custom boards CRUD
│   ├── db/               # Drizzle client/schema
│   ├── inbox/            # IMAP, MIME, crypto, queries
│   └── env.ts            # typed env
└── modules/              # business modules: cashflow, inbox, communications
drizzle/init/             # manual SQL init: pgvector indexes, boards, inbox
```

## Block-Grid — фундамент UI
Open Finance = настраиваемый Lego-конструктор интерфейса. Почти каждая новая страница приложения должна строиться через `<BlockGrid />`, а не статичный layout.

### Ключевые файлы
- `src/lib/blocks/types.ts` — `BlockDef`, `BlockInstance`, `BlockDependencies`, `BlockAppearance`, `PageLayout`.
- `src/lib/blocks/registry.ts` — `ALL_BLOCKS`, `DEFAULT_LAYOUTS`, `getDefaultLayout`, `listBlocksForPage`.
- `src/components/blocks/block-grid.tsx` — drag/resize/save, relation overlay, AI dialog integration.
- `src/components/blocks/block-grid.css` — resize handle скрыт в обычном режиме; появляется через CSS `:has([data-resize-hotzone]:hover)` (40×40 hot-zone в правом нижнем углу `BlockChrome`) или сразу в edit mode. Анимация opacity 100мс, без задержек. Без JS-таймеров.
- `src/components/blocks/block-chrome.tsx` — wrapper, hover controls, settings/delete/AI.
- `src/components/blocks/block-settings-dialog.tsx` — настройки блока (4 таба: `params` → `links` → `style` → `ai`). Layout: `max-w-2xl` + `gap-0 p-0`, sticky header/footer. `StyleAndSizeForm` — двухколоночный header (preview-чип `200px` + title `1fr`), цвета `grid-cols-12` (расширенный `ACCENT_COLORS`: 25 цветов), иконки `grid-cols-12` (`ICON_NAMES`: 70 иконок, фон `bg-muted/40`, активная — `border-primary bg-primary/10`). `AiPromptForm` — uppercase-лейблы, textarea `rows=9`, badge `Тип·{blockType}`. Legacy `AppearanceForm` экспорт (для `AddBlockDialog`) синхронизирован с тем же стилем через `ColorSection` helper.
- `src/app/api/blocks/layout/[pageKey]/route.ts` — persist layout.
- `src/app/api/blocks/sources/route.ts` — sources для `@связать`, cross-page labels, Sheet formula evaluation.

### Инварианты Block-Grid
- Grid: 12 колонок, `rowHeight=40`, `margin=[10,10]`.
- Блоки должны иметь `defaultSize`, `minSize`, `minContentSize`.
- Render должен быть adaptive через `useBlockDensity()` (`xs/sm/md/lg`).
- Блок обязан уважать `instance.appearance`.
- Блоки публикуют значения через `useBlockValuePublisher`, если на них можно ссылаться.
- Связи обнаруживаются не только через `dependencies.sources`, но и через `config.blockRefs` и формулы с `@...`.
- **Не использовать `sanitizeBlocks` на сервере**: catalog/client exports могут быть пустыми в server bundle.
- **Координатная сетка-фон** (`.block-grid-surface`, [src/components/blocks/block-grid.css](src/components/blocks/block-grid.css), [src/components/blocks/block-grid.tsx](src/components/blocks/block-grid.tsx)): точки **строго совпадают с RGL-cells** (v0.15.0). `colW = (containerWidth - margin[0] * (cols - 1)) / cols`, `stepX = colW + margin[0]`, `stepY = rowHeight + margin[1]`, breakpoints/cols 1:1 как у RGL. ResizeObserver на surface пересчитывает inline-style `backgroundSize`/`backgroundPosition`. Радиальный градиент `circle at 5px 5px` + offset (colW, rowH) даёт дот в центре gap'а между ячейками. Контейнер имеет `data-edit` (режим редактирования) и `data-active` (drag/resize, через `onDragStart`/`onResizeStart` props RGL) — уровни видимости 0.18 → 0.30 → 0.50.
- **Cross-page связи в mindmap** (v0.15.0, refined v0.15.2, [src/components/blocks/block-relations-overlay.tsx](src/components/blocks/block-relations-overlay.tsx) + [src/lib/blocks/use-cross-page-relations.ts](src/lib/blocks/use-cross-page-relations.ts) + [src/app/api/blocks/relations/route.ts](src/app/api/blocks/relations/route.ts)): треугольнички ▶ зелёный (incoming, на левом ребре блока, apex внутрь) и ▶ индиго (outgoing, на правом ребре блока, apex наружу) появляются при включённом overlay'е «Связи». **Расположение (v0.15.2):** треугольники сидят НА ТОЙ ЖЕ ВЕРТИКАЛИ, что и anchor-кружочек edge-точки (`left = edgeX - TRI_SIZE/2`), но НИЖЕ кружочка по Y (`top = anchorCenterY + ANCHOR_R + ANCHOR_TRI_GAP = +10px`). Визуально читается как продолжение того же anchor-ряда: кружочек (локальные связи на странице) сверху, треугольник (cross-page связи) под ним. Кликабельные → popover со списком блоков-целей и `<Link href={pageHref(pageKey)}>`. Lightweight-эндпоинт `/api/blocks/relations` собирает `dependencies.sources` + `@`-refs из config (БЕЗ агрегаций). Хук `useCrossPageRelations(pageKey, enabled)` фетчит только при `enabled=true` (overlay видим), кэш per-pageKey.
- **`BlockChrome` рамка через absolute-overlay** (v0.15.2, [src/components/blocks/block-chrome.tsx](src/components/blocks/block-chrome.tsx)) — `appearance.borderColor` НЕ применяется через `boxShadow inset` на wrapper'е, потому что `bg-card` детей блока полностью перекрывает inset-shadow родителя. Вместо этого рендерится отдельный absolute-overlay `<div className="pointer-events-none absolute inset-0 z-20 rounded-lg" style={{ boxShadow: 'inset 0 0 0 2px {color}' }}>`. Он сидит на `z-20` поверх контента блока (z-0/z-10), но ниже chrome-контролов (`z-30`: drag-handle, AI/settings/X, CrossPagePin). `pointer-events-none` — клики проходят насквозь. Если добавляешь новый chrome-элемент с z-index — следи, чтобы было >20 для перекрытия рамки.
- **`BlockInstance.aiPrompt`** (master-промпт блока) обязан пробрасываться в `MicroAgentDialog.blockContext.aiPrompt` через `block-grid.tsx`. В `/api/ai/chat` приоритет: `aiPrompt > legacy config.blockPrompt > inline инструкция в диалоге`. Persistence: добавлено в `BlockInstanceSchema` API роута `/api/blocks/layout/[pageKey]`.

### Текущий каталог блоков
`stat.income`, `stat.expense`, `stat.balance`, `stat.custom`, `cashflow.top-categories`, `cashflow.transactions`, `sheet`, `excel.cell`, `navigate.card`, `computed.sum`, `custom.data`, `chart.cashflow`, `ai.micro-agent`, `inbox.channel-feed`, `unit.ozon-calculator`, `unit.ozon-multi-table`, `unit.yandex-calculator`, `unit.my-store-table`, `currency.rates`. Каждый `BlockDef` помечен `tags: string[]`, `recommendedFor?: string[]`, `source: 'builtin'|'user'|'paid'` и **`iconName: string`** через карту `BLOCK_META` в `registry.ts` (источник правды для маркетплейса, `AddBlockDialog` и серверного рендера в RSC).

## Реализованные страницы и модули
- **Dashboard `/dashboard`** — BlockGrid с KPI и navigation cards.
- **Cashflow `/cashflow`** — CRUD/import транзакций, KPI, top categories, transactions, chart.
- **Inbox `/inbox`** — BlockGrid с двумя дефолтными блоками `inbox.channel-feed` размером `6×12`.
- **Boards `/boards`, `/boards/[boardId]`** — персональные доски на BlockGrid, `pageKey = board-{boardId}`.
- **Unit Economics `/unit-economics`** — четыре вкладки (`unit-economics-ozon`, `unit-economics-ozon-multi`, `unit-economics-yandex`, `unit-economics-my-store`), каждый таб = свой `pageKey` с самостоятельным BlockGrid layout.
- **Marketplace «Маркет блоков» `/marketplace`** — каталог всех блоков (browse-only, без установки). `src/app/(app)/marketplace/{page,marketplace-client}.tsx`. Поиск, фильтр по категории и тегам, диалог детальной инфо. Кнопки «Создать блок» и «Купить блок» disabled (заглушки на будущее). Пункт sidebar `marketplace` с label «Маркет блоков» (`Store` icon). URL `/marketplace` сохранён ради ссылок и истории.
- **Settings `/settings`** — visibility toggles, форматирование, настройки разделов.
- **Admin AI pages** — local models, external providers/proxy/diagnostics, system prompt.

## Boards — персональные рабочие пространства
- `src/lib/db/schema/boards.ts` — таблица `boards`.
- `src/lib/boards/queries.ts` — CRUD, reorder, pinned.
- `src/lib/boards/utils.ts` — `boardPageKey(boardId)` → `board-{id}`.
- `src/app/api/boards/route.ts`, `src/app/api/boards/[boardId]/route.ts` — API.
- `src/app/(app)/boards/*` — pages/client UI.
- `drizzle/init/03-boards.sql` — manual SQL.
- Запиненные доски отображаются в sidebar; доски видны в `@связать` через `/api/blocks/sources`.

## Sheet / Excel Cell / Custom Data / связи
- `sheet` — мини-таблица с формулами, `@связать`, computed cells в sources API, `__money` metadata для денежных ячеек. Без `minContentSize` — таблица скроллится внутри блока любого размера (`minSize: 1×1`).
- `excel.cell` — компактная одиночная Excel-like ячейка `3×2`, формулы и `moneyRefs`.
- `custom.data` (v0.14.0, расширен v0.15.0) — **multi-column** блок «Данные» c `Config = { columns: Array<{id, label, format: 'rubles'|'number'|'percent'|'text', publish, width?}>, rows: Array<{id, label, cells: Record<colId, {v, ref?, isMoney?}>}>, publishMode, publishColumnId, showKopecks, labelColumnWidth? }`. Каждая ячейка может быть либо ручной (`v`), либо привязкой (`ref` + cached `v` + `isMoney` флаг — мигрировано из `excel.cell.moneyRefs`). На hover ячейки появляется `@`-кнопка для открытия picker'а. Per-column publish: каждая `publish:true` колонка публикует свой агрегат как `{column.id}` (доступен в `@связать` как `@блок.amount`/`@блок.stock`). Legacy `value` = агрегат основной колонки (`publishColumnId`). `parseConfig` мигрирует все старые конфиги (`rows[i].value` + top-level `format`) при чтении. **Адаптивные ширины колонок (v0.15.0):** label и value-колонки автоматически подгоняются по самому длинному значению через `canvas.measureText` (общий контекст модуля, SSR-safe, диапазон label 80-240px / value 72-220px); manual override через drag-handle на правом ребре header'а (pointer-капчер + локальный `dragState` без записи в config до pointerUp) или через `column.width`/`labelColumnWidth` в SettingsForm; кнопка **«A»** (`Maximize2`) в шапке блока сбрасывает все ручные widths.
- **Money detection через `moneyRefs`/`isMoney`**: `sheet`/`excel.cell` сохраняют `moneyRefs: Record<string, boolean>` в config; `custom.data` хранит флаг per cell в `cells[colId].isMoney`. Все используют общий `sourceFieldIsMoney(block, field)` при выборе через picker. То же mirror на server-side в `/api/blocks/sources/evaluateSheetCells`.
- **Публикация `__money`**: KPI-блоки (`stat.*`, `computed.sum`, `custom.data` с rubles-колонками, `excel.cell` с money формулой) публикуют `__money: 'col1,col2,...'` (включая `value` если основная колонка денежная) через `useBlockValuePublisher`. `__labels: 'amount=Сумма,stock=Остаток,...'` для красивого отображения в picker'ах.
- `/api/blocks/sources` server-side считает Sheet formulas, включая linked cells, чтобы вкладки страниц совпадали с live current-page values.
- `useAvailableBlockSources()` скрывает служебные поля вроде `__money`/`__labels`.
- Формат денег нельзя выводить из факта `@`; нужен explicit `format: money` (server) / сохранённый `moneyRefs`/`isMoney` (client), иначе обычные ячейки будут ошибочно делиться на копейки.

## AI Micro-Agent и AI runtime
### Ключевые файлы
- `src/app/api/ai/chat/route.ts` — NDJSON streaming endpoint, route Ollama vs External, `parseAction()`.
- `src/components/micro-agent/micro-agent-dialog.tsx` — dialog с streaming preview, Stop, token counter.
- `src/lib/blocks/catalog/ai-micro-agent.tsx` — standalone AI block.
- `src/lib/ai/micro-agent/block-capabilities.ts` — capability registry для block configs.
- `src/lib/ai/providers/ollama.ts` — installed models + `isChatCapableModel()`.
- `src/lib/ai/providers/openai-compat.ts` — SSE → NDJSON для OpenAI-compatible API.
- `src/lib/ai/providers/proxy.ts` — runtime `undici` ProxyAgent.

### Поведение
- `/api/ai/chat` отдаёт события `start`, `token`, `done`, `error`, `aborted`.
- Local Ollama: приоритет request `model` → tenant `aiModel` → env `OLLAMA_DEFAULT_MODEL` → первая chat-capable.
- Embedding-модели фильтруются; если установлены только embeddings, ошибка понятная.
- External: если `tenant.settings.aiExternal.enabled` и есть key/baseUrl, используется `streamOpenAICompat()`.
- `parseAction()` понимает fenced/unfenced JSON, `payload`/`config`, `update_block`, `create_block`, `text_only`.
- `BlockGrid` умеет применять `update_block` и создавать блок по `create_block`.

## AI Providers Hub
- `/admin/ai/local-models` — каталог 19 моделей по категориям, HF input, installed/running/details, выбор основной локальной chat-модели.
- `/admin/ai/providers` — external API presets: OpenAI, Claude, OpenRouter, VseGPT, Custom; proxy HTTP/HTTPS; diagnostics.
- `/admin/ai/system-prompt` — общий system prompt tenant'а.
- Tenant settings JSONB: `aiProvider`, `aiModel`, `aiSystemPrompt`, `aiExternal{enabled,provider,baseUrl,apiKey,defaultModel,useProxy}`, `aiProxy{enabled,url,type,username,password}`.
- В MVP внешние API keys/proxy password в `tenants.settings` plain JSONB и маскируются на клиенте; production TODO: AES-256-GCM/Vault.

## Inbox Channels MVP
### Ключевые файлы
- `src/lib/db/schema/inbox.ts` — `inbox_channels`, `inbox_messages`, tenant scoping, `created_by`, unique `(channel_id, external_id)`.
- `src/lib/inbox/queries.ts` — tenant-scoped CRUD/sync/list messages; channels scoped per block через `config.blockId`.
- `src/lib/inbox/crypto.ts` — AES-256-GCM secret encryption using `INBOX_SECRET_KEY`, dev-only fallback.
- `src/lib/inbox/imap.ts` — IMAP connect/test/sync, STARTTLS, Beget fallback.
- `src/lib/inbox/mime.ts` — MIME headers/body decode, Cyrillic fallback.
- `src/lib/blocks/catalog/inbox-channel-feed.tsx` — `inbox.channel-feed` block settings and feed UI.
- `src/app/api/inbox/channels/route.ts`, `src/app/api/inbox/messages/route.ts` — API.
- `src/lib/ai/tools/query-inbox-messages.ts` — read-only AI tool.
- `drizzle/init/04-inbox.sql` — manual SQL.

### Состояние
- Email IMAP MVP готов: test connection, sync recent messages, per-message FETCH для кириллицы/literal-length reliability.
- Пароль канала шифруется; UI показывает masked secret.
- SSL/TLS off использует STARTTLS; Beget `imap.beget.com:993` timeout retry → `143 + STARTTLS`.
- Telegram channel пока placeholder.
- Подключение каналов живёт в настройках конкретного `inbox.channel-feed` блока, не в общей settings-секции.

## Unit Economics (MVP, v0.13.0)
### Ключевые файлы
- `src/lib/unit-economics/types.ts` — `Marketplace`, `OzonMode`, `YandexMode`, `TaxMode` (4 опции, `'nds'` УДАЛЁН), `OzonFbsDropoffPoint` (2 опции: `sorting_center`/`pickup_point`), `OzonFbsShipmentSpeed`, `OzonFbsClusterShare = {key, sharePct}`, `OzonInputs/Results` (multi-cluster + `returnsPct/cancelPct/coInvestPct/freeAcceptance/supplyLeadWeeks/documentedExpensesMonth/indirectExpensesMonth`, в результатах `priceWithSpp/coInvestSavings/effectiveBuyoutPct`), `YandexInputs/Results`, `UnitCellBinding`, утилиты.
- `src/lib/unit-economics/ozon/{tariffs-2026-04-07,calculate,migrate}.ts` — версионированный тарифный пак (`OZON_TARIFF_VERSION = ozon_2026_04_07`) и pure-TS engine. **28 кластеров FBS** (`FBS_CLUSTERS` с `local: boolean` + `region`), 43-уровневый `VOLUME_BRACKETS` LUT для FBO/FBS, `OZON_CLUSTER_PRESETS` (`allRf/topRf5/topRf10/geography`), `NON_LOCAL_CLUSTER_MULTIPLIER = 1.25`, `PAID_ACCEPTANCE_FEE_PER_UNIT_RUB = 10`. `calculateOzon` использует **multi-cluster weighted-sum логистику**: `Σ baseLogistics × clusterMultiplier × share/totalShare` + fallback к single через `isLocalCluster` если `fbsClusters` пуст. `migrate.ts → migrateOzonRaw()` мигрирует старые конфиги (`fbsWarehouse → fbsClusters[]`, `taxMode 'nds' → 'osno'`, `taxDeductExpenses → documentedExpensesMonth=0`, `fbsDropoffPoint 'ozon_warehouse' → 'sorting_center'`).
- `src/lib/unit-economics/yandex/{tariffs-2026-04-01,calculate}.ts` — то же для Yandex, НДС от `customerPrice`.
- `src/lib/unit-economics/bindings.ts` — `isBindingActive`, `bindingScopedKey`, `resolveBindingValue` (kopecks→rubles по флагу `money`), `bindingHasValue`.
- `src/lib/unit-economics/use-live-block-values.ts` — `useAllBlockValuesFlat` (live из `BlockValuesContext`), `useRemoteBlockSources` (`/api/blocks/sources`).
- `src/lib/unit-economics/import/ozon-price-template.ts` — XLSX-парсер с SheetJS + fallback ZIP/XML.
- `src/lib/unit-economics/store-formula.ts` — evaluator формул для блока «Мой магазин»: `evalSingleFormula`, `evalRowFormulas`, защита от циклов (`'#CYCLE'`), идентификаторы заменяются по убыванию длины ключа.
- `src/lib/unit-economics/queries.ts` — tenant-scoped CRUD `unit_products`/`unit_calculations`/`unit_imports`, `bulkUpsertUnitProducts`.
- `src/lib/db/schema/unit-economics.ts` — Drizzle-таблицы (деньги в копейках `integer`).
- `drizzle/init/05-unit-economics.sql` — manual SQL.
- `src/app/api/unit-economics/{products,calculations,import/ozon-prices}/route.ts` — API.
- `src/lib/blocks/catalog/{unit-ozon-calculator,unit-ozon-multi-table,unit-yandex-calculator,unit-my-store-table}.tsx` — блоки. Оба Ozon-блока вызывают `migrateOzonRaw()` в `parseConfig`.
- `src/components/unit-economics/{unit-cell-binding-dialog,linkable-number-cell,dropdown-select,cluster-selector}.tsx` — UI привязок и multi-cluster селектор. `<ClusterSelector>` — DropdownMenu с popover-чекбоксами для всех 28 кластеров, % инпутами, индикатором суммы (зелёный 100% / оранжевый иначе), кнопкой «Нормализовать», quick-пресетами.
- `src/app/(app)/unit-economics/{page,unit-economics-client}.tsx` — server + client страница (4 таба).
- `scripts/test-unit-economics.ts` — smoke tests, **36 PASS** (запуск: `pnpm tsx scripts/test-unit-economics.ts [path-to-xlsx]`).

### Инварианты
- **Версионирование тарифов:** сохранённые `unit_calculations.tariff_version` ссылаются на конкретный pack (`ozon_2026_04_07`, `yandex_2026_04_01`); при добавлении нового pack — не перезаписывать старые расчёты.
- **Деньги:** в БД хранить в копейках (`integer`), в `inputs/results` JSONB — рубли с `money: true` пометкой при необходимости. UI форматирует через существующие helpers.
- **НДС vs Налог:** `vatPct/vat` — отдельная строка расхода, не зависит от taxMode. `taxRatePct/tax` — налог на прибыль (УСН/ОСНО). Не объединять. Налоговый режим `'nds'` УДАЛЁН (v0.13.0) — только `usn_income/usn_income_minus/osno/none`.
- **Multi-cluster FBS (v0.13.0):** `OzonInputs.fbsClusters: Array<{key, sharePct}>` — массив кластеров с долями, sum должна быть = 100. `calculateOzon` нормализует фактическую сумму, поэтому 50/30/20 при totalShare=100 работает корректно. Если массив пуст — fallback к single через `isLocalCluster`. **Старое** поле `fbsWarehouse` оставлено только в типе как `@deprecated` для миграции через `migrateOzonRaw()`. UI всегда пишет в `fbsClusters`.
- **Новые поля Ozon (v0.13.0):** `returnsPct + cancelPct` → derived `effectiveBuyoutPct = 100 - sum`; legacy `buyoutPct` используется только если оба = 0. `coInvestPct` — компенсация баллами Ozon (положительная P&L строка). `freeAcceptance: false` + FBS = +10₽/ед к логистике. `documentedExpensesMonth` (₽/мес) — для УСН Д-Р вычета на единицу через `salesPerMonth`. `priceWithSpp` (== buyerPrice) — явная метрика «Цена с СПП».
- **FBS shipment speed (v0.12.0):** `OzonInputs.fbsShipmentSpeed='fast'` даёт `+FBS_FAST_SHIPMENT_COMMISSION_BUMP_PCT(=2)` к комиссии (только при `mode='fbs'`). Все FBS-поля опциональные.
- **Linkable cells:** money-флаг обязателен для денежных привязок, иначе будет повторение бага «деление/не деление на 100». Fallback хранится при пропадании источника, показывается warning state. Внутри ячейки **всегда** `<input>` (в linked — readOnly + onClick → picker), иначе вернётся сдвиг между manual и linked.
- **Sticky cells в unit-таблицах (v0.12.1):** background всегда **solid** `bg-card` (без `/95`, без `backdrop-blur`); каждая sticky-ячейка имеет `overflow:hidden isolate` (новый stacking-context). Геометрия фиксируется явно: sticky widths `32/110/220`, `HEADER_H=42`, `ROW_H=30`, `minWidth/maxWidth/boxSizing` на header/body/totals. z-index: header sticky `45`, totals row `35`, body sticky `30`, sticky totals `36`. На последней sticky-колонке — `boxShadow: '1px 0 0 0 var(--border)'`. Важно: **не возвращать** `[&:hover_[data-sticky]]:bg-accent/5` или другой полупрозрачный hover на sticky-cells — он снова покажет скроллящийся текст под `Артикул/Название`. Inputs Артикул/Название имеют `truncate`.
- **Select-ы в юнит-блоках (v0.12.2):** ВСЕ выпадающие списки (FBS-параметры, Налог, Спецтариф) — через `DropdownSelect` (`src/components/unit-economics/dropdown-select.tsx`, обёртка над Radix `DropdownMenu`). Не возвращать нативные `<select>` — на macOS/iOS они рендерят пустую метку в закрытом состоянии при заполненном value, даже с `text-foreground [color-scheme:light]`.
- **Bulk fill колонок (v0.12.2):** Ozon multi — `MoreVertical` в `SortableHeaderCell` (только для input-колонок), открывает `DropdownMenu` с input + Apply. My Store — секция «Массовое заполнение» в `ColumnEditDialog` (disabled для type=`formula`). Оба обработчика обязаны **пропускать** строки с активным `bindings[field]` (биндинг приоритетнее) и возвращать `{ applied, skipped }` для inline-фидбэка.
- **Column DnD (Ozon multi-table):** порядок input-колонок и result-колонок хранится отдельно в `config.global.columnOrder = { inputs: string[]; results: string[] }`. `resolveColumnOrder<T>()` мерджит сохранённый порядок с дефолтом — новые колонки идут в конец, удалённые — выкидываются. Sticky `#`/Артикул/Название/Действия не drag'аются. Drag handle (`GripVertical`) внутри `SortableHeaderCell` появляется при hover, активируется через `PointerSensor` с `distance: 5`. Input и result колонки нельзя смешивать (отдельные `DndContext`). У каждого `DndContext` должен быть стабильный `id` на основе `instance.id`, иначе `@dnd-kit` может дать hydration mismatch по `aria-describedby`.
- **XLSX-импорт Ozon:** маппинг колонок по заголовкам, не индексам. SheetJS читать с `cellStyles: false`. Fallback ZIP/XML парсер обходит «битый» stylesheet от Ozon. Фильтровать служебные строки-метки.
- **Tenant isolation:** все API под `auth()`, все DB-запросы фильтруются по `tenant_id`. `unit_products` upsert по `(tenant_id, marketplace, article)`.
- **Aggregate outputs:** все unit-блоки публикуют через `useBlockValuePublisher` с `__money` для денежных полей и **`__labels`** convention `"key=Human Label,..."` для picker привязок. Ozon multi: `rowsCount`, `avgMargin`, `avgRoi`, `totalProfitMonth`, `totalStockValue`, `totalMoneyInGoods`. My Store: `rowsCount`, `totalRevenue`, `totalProfit`, `avgMargin`, `stockTotal`. Calculators: `profitPerUnit`, `profitPerMonth`, `margin`, `roi`. `useAvailableBlockSources()` парсит `__labels` в `Record<string,string>`; `unit-cell-binding-dialog` использует `labels[field] ?? sourceFieldLabel(field)`.
- **`/api/blocks/sources`:** `unit-economics-*` page labels и `unit.*` type labels (включая `unit.my-store-table`) в `DEFAULT_PAGE_KEYS`/`PAGE_LABELS`/`TYPE_LABELS`. `fieldsForBlock` возвращает publishable поля.
- **My Store column model:** `{ id, label, type: 'number'|'percent'|'money'|'text'|'formula', unit?, default?, width?, formula?, positive?, hidden? }`. `formula`-колонки read-only, не биндятся. Доступные переменные в формулах: id колонок текущей строки + `vatPct`, `taxRatePct`. Защита от циклов → `'#CYCLE'`.
- **Yoolip credentials:** не хранить в git/плане. Только email + факт наличия тестового доступа в плане; пароль — вне репозитория.
- **Файл `СЕБЕС озон.xlsx`:** референс для парсера колонок «Мой магазин», парсер пока не реализован — отдельный заход.

## Currency Rates (v0.16.0)
### Ключевые файлы
- `src/lib/db/schema/currency.ts` + `drizzle/init/06-currency.sql` — таблица `currency_rates` (НЕ tenant-scoped, общая на инстанс). PK = `code` (varchar(8)), `rate_rub` numeric(18,6) хранится как **курс за 1 единицу** (не за nominal).
- `src/lib/currency/sources/cbr.ts` — `fetchCbrDaily()`: тянет JSON у `cbr-xml-daily.ru/daily_json.js` (community-mirror ЦБ, без ключа/лимитов), нормализует `Nominal>1` → курс/единицу, таймаут 8s + 1 retry с задержкой 800ms.
- `src/lib/currency/queries.ts` — `getCurrencyRates(codes?)`, `getStaleness()` (порог 23h), `refreshCurrencyRates()` с bulk upsert через `onConflictDoUpdate({ target: code, set: { ...sql\`excluded.field\` } })`.
- `src/app/api/currency/rates/route.ts` — `GET`: snapshot из БД + lazy-refresh при возрасте >23h (асинхронный, через глобальный `inflightRefresh: Promise|null` от параллельных вызовов).
- `src/app/api/currency/rates/refresh/route.ts` — `POST`: принудительный refresh, rate-limit 1/min per tenant через in-memory `Map<tenantId, lastRefreshAt>`. При ошибке fetch → 502.
- `src/lib/blocks/catalog/currency-rates.tsx` — блок `currency.rates`. Density-aware Render (xs → primaryCode/RUB; sm → код+курс; md/lg → список со стрелками тренда + Δ%). Settings: 9 «популярных» (USD/EUR/CNY/AED/TRY/GBP/JPY/KZT/BYN) + кнопка «Остальные валюты ЦБ» открывает диалог с search'ем по всем ~30. Кнопка `RefreshCw` в шапке блока — manual refresh.

### Инварианты
- **`rate_rub` всегда нормализован к 1 единице.** ЦБ возвращает `Nominal=10` для KRW/JPY/HUF/IDR — `fetchCbrDaily()` делит `Value/Nominal`. Поле `nominal` в БД оставлено справочно для UI.
- **Курс — НЕ money-формат.** Блок публикует все курсы как `format: 'number'` (через `useBlockValuePublisher` + `__labels`, БЕЗ `__money`). Это важно: формула `=A1*@currency.usd` корректно работает только когда A1 — money, а курс — обычное число (90.5). Если курс пометить как money, `formatRublesWithSettings` поделит его на 100 и получится 0.9 ₽.
- **Lazy-refresh окно — 23h** (`CURRENCY_STALENESS_WINDOW_MS`), не 24h. ЦБ обновляет курсы около 11:30 МСК, защита от случая «вчера в 23:59 обновили, сегодня в 11:00 решили не обновлять».
- **Авто-refresh при первом открытии блока** — `useCurrencyRates()` детектит пустой `rates={}` после первого `load()` и вызывает `refresh()` автоматически. Это страхует кейс «БД ещё пуста, пользователь только что добавил блок». В обычном работающем инстансе lazy-refresh при `GET` поддерживает БД свежей.
- **Money detection потребителем**: `sourceFieldIsMoney()` в `custom-data.tsx` → если `field.format === 'number'` (а у currency.rates все fields явно `'number'`), возвращает `false`. Дополнительные категории (`'Финансы'`) добавлять в isMoney-эвристику НЕ нужно.
- **`/api/blocks/sources` подгружает курсы 1 раз**: `getCurrencyRates()` вызывается в начале `GET`, результат кэшируется в `currencyRatesByCode: Map<string, CurrencyRate>` и пробрасывается в каждый `fieldsForBlock(...)`. Не делать этот вызов внутри `fieldsForBlock` — иначе на 50 блоков будет 50 SQL-запросов.

## RAG memory / AI Orchestrator
- Schema уже есть: `src/lib/db/schema/ai.ts` (`memory_chunks`, `ai_usage`, `ai_audit_log`, `ai_agents`).
- `src/lib/ai/orchestrator.ts` пока scaffold/TODO для Этапа 4.
- `src/lib/ai/memory/search.ts` пока TODO для hybrid semantic + full-text + RRF.
- Векторные индексы вручную: `drizzle/init/02-vector-indexes.sql`.

## Дизайн-система
- Linear/Notion-inspired: плотная типографика, тонкие borders, минимум теней.
- Базовый `html { font-size: 14px }`, компактные shadcn variants.
- Карточки без тяжёлых теней, `rounded-lg`, небольшие padding.
- Toolbar кнопки обычно `size="sm"`/`xs`.
- Иконки Lucide: 14px в кнопках/cards, 16px в headers, 20px только CTA.
- Не использовать системные `alert/confirm/prompt`; только Dialog/AlertDialog.
- Empty states всегда с CTA.

## Файлы, которые AI должен знать (но не грузить все сразу)
- `START.md` — bootstrap новой сессии, карта, роутинг по типу задачи. **Читается первым.**
- `MEMORY.md` — этот компактный handoff. **Читается вторым.**
- `CHANGELOG.md` — история изменений; текущая версия `0.15.0`. Грузить по запросу.
- `PLAN.md` — стратегическая карта продукта и этапы. Грузить разделами через offset+limit.
- `CLAUDE.md` — полные правила проекта (всегда применяется через workspace rules).
- `AGENTS.md` — универсальные правила для AI-агентов (всегда применяется).
- `docs/SECURITY.md` — безопасность, секреты, 152-ФЗ. **Обязательно** при работе с секретами/сетью/биллингом.
- `docs/ARCHITECTURE.md`, `docs/AI_TOOLS.md`, `docs/BILLING.md`, `docs/LOCAL_AI.md`, `docs/MODULES.md`, `docs/EMAIL_BEGET.md`, `docs/VPN_FOR_AI.md`, `docs/DESKTOP_STRATEGY.md`, `docs/LICENSING.md`, `docs/ONBOARDING.md` — тематическая документация по запросу.
- `FEED.md` — коммуникационный стиль Telegram-канала; часть статуса может быть старой.

## Что проверять перед завершением задачи
```bash
pnpm build
git diff --check
git status --short
```
Если менялись docs-only файлы, `pnpm build` всё равно желательно запустить по правилу проекта.

## Команды локального запуска
```bash
pnpm install
pnpm docker:up
pnpm db:push
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/02-vector-indexes.sql
pnpm dev
```
Manual SQL для новых модулей:
```bash
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/03-boards.sql
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/04-inbox.sql
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/05-unit-economics.sql
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/06-currency.sql
```

## Текущий статус на 2026-05-16
- **Версия:** `0.16.0` в `CHANGELOG.md`; `package.json` всё ещё `0.5.0` и не является источником статуса фич.
- **Фаза:** новый блок `currency.rates` (свежие курсы ЦБ РФ через cbr-xml-daily.ru, бесплатно/без ключей/без лимитов) с публикацией курсов как `@блок.usd`/`@блок.eur`/... для использования в формулах и привязках, кэш в Postgres-таблице `currency_rates` с lazy-refresh (порог 23h) + manual refresh кнопка с rate-limit 1/min. Плюс UX-фикс блока «Данные»: селект «основной колонки» больше не пустой когда у всех колонок снят флаг публикации (раньше активировался только при добавлении третьей колонки). Поверх v0.15.2 (security-патч Next.js CVE-2026-44578, BlockChrome.borderColor через absolute-overlay, ColorPalette flex-wrap, cross-page триангуляция), v0.15.1 (UI-полировка модалки + расширенные палитры 25 цветов / 70 иконок), v0.15.0 (адаптивные ширины колонок `custom.data`, точная геометрия фон-сетки, cross-page треугольнички, lightweight `/api/blocks/relations`), v0.14.0 (multi-column `custom.data`, BlockInstance.aiPrompt), Unit Economics MVP, «Маркет блоков». Под капотом — Inbox Channels MVP + AI Micro-Agent + External Providers/VPN/Diagnostics + Boards.
- **Build:** `pnpm typecheck` и `pnpm build` проходят (новые роуты `/api/currency/rates` и `/api/currency/rates/refresh` зарегистрированы); smoke-тесты `pnpm tsx scripts/test-unit-economics.ts` зелёные (**36 PASS**).
- **Контекстные файлы:** `0.10.3` ввёл `START.md` и переход на ленивую загрузку контекста — `CHANGELOG.md`/`PLAN.md` больше не грузятся целиком по умолчанию.
- **Ближайшие TODO:**
  - применить `06-currency.sql` в dev DB (manual SQL command выше) и сделать первый refresh курсов через POST `/api/currency/rates/refresh`;
  - реализовать парсер `СЕБЕС озон.xlsx` для seed-колонок Мой магазин (отдельный скрипт);
  - применить `05-unit-economics.sql` в dev DB (manual SQL command выше);
  - применить `04-inbox.sql` в dev DB;
  - подключить сохранение `unit_calculations` из блоков (сейчас только инфраструктура и API готовы);
  - добавить экспорт CSV/XLSX и share/permalink для калькуляторов;
  - покрыть UI плотными e2e-тестами через webapp-testing skill;
  - продолжить: Telegram Bot канал, Whisper transcription, RAG/orchestrator, Cmd+K AI action.

## Грабли, которые нельзя повторять
- `sanitizeBlocks` на сервере может выкинуть блоки из-за client-only catalog.
- Resize handle нельзя делать через JS hover-marker внутри `BlockChrome`; CSS-only через `:has([data-resize-hotzone]:hover)` стабильнее. Hot-zone должен быть `pointer-events: auto` (иначе `:hover` не сработает) и иметь z-index ниже action toolbar (z-30).
- **`BlockDef` объекты НЕЛЬЗЯ передавать через RSC props (v0.13.0)** — catalog-файлы помечены `'use client'`, и при импорте в Server Component весь экспортированный объект превращается в opaque client-reference proxy: доступны только примитивные поля, переданные через webpack RSC loader, остальные (`pages`, `description`, `category`, `defaultSize`, `tags`, `icon.displayName`) — `undefined`. Симптомы: `Cannot read properties of undefined (reading 'map'/'displayName')`. **Решение:** вызывать `listAllBlocks()` ВНУТРИ Client Component (как в `MarketplaceClient`), не в Server Component. Точечный фикс через явное `iconName: string` в `BLOCK_META` помог только для одного поля.
- **Closure-trap при последовательных `setState`/`persist` (v0.13.0)** — два вызова `setInput(a, x); setInput(b, y)` в одном handler'е оба замыкают одно и то же `config.inputs` (или `config.global`) из текущего рендера. Второй вызов `persist({ inputs: { ...config.inputs, [b]: y } })` НЕ видит первый `[a]: x` и перезатирает его. Симптомы: «выбор города FBS не работает», «toggle B сбрасывает поле A». **Решение:** helper `setInputs(patch: Partial<Inputs>)` / `updateGlobalMany(patch)` собирает все апдейты в один `persist({ inputs: { ...config.inputs, ...patch } })`. Использовать ВСЕГДА когда меняешь >1 поля в одном обработчике.
- **`b.icon.displayName` в RSC падает** — `BlockDef.icon` приходит из `'use client'`-каталогов как client-reference, у которого нет полей. Server Components должны использовать **`b.iconName`** (string из `BLOCK_META`), не `icon.displayName`. (Исторический фикс v0.12.2; полное решение — см. предыдущий пункт.)
- **Native `<select>` в шапке таблиц** — на macOS/iOS закрытое состояние периодически рендерит пустую метку при заполненном value. Использовать `DropdownSelect` (Radix DropdownMenu + button trigger).
- Sheet sources нельзя строить только из raw saved cells: формулы и linked cells должны считаться/merge-иться.
- Служебные поля (`__money`) нужны для metadata, но не должны показываться selectable source.
- `formatRublesWithSettings` принимает копейки; не форматировать обычные Sheet cells как деньги без metadata.
- **Money detection в формулах** — нельзя полагаться только на эвристику `refIsPlainNumber` по имени поля. При `@связать` нужно сохранять `moneyRefs[ref] = sourceFieldIsMoney(...)` в config (как в `excel.cell` и `sheet`). Иначе ссылка на KPI будет показывать `2 613 726 900` вместо `26 137 269 ₽`.
- **`__money` metadata в KPI-блоках** — любой блок, публикующий рублёвое значение через `useBlockValuePublisher`, должен публиковать `__money: 'value'` (или список полей). Без этого live preview в `@связать` picker и `mergeLiveFields` не пометят source как money.
- **`minContentSize` блокирует ресайз** — если блок умеет сам скроллиться (`overflow-auto` внутри), не задавайте `minContentSize`. Иначе пользователь не сможет уменьшить блок и получит overlay «Мало места».
- **`{` в JSX-тексте** — TypeScript+React парсят `{...}` как JSX-выражение даже внутри `<p>...</p>`. Если нужна фигурная скобка как литерал — экранировать `&#123;` или использовать строку: `{'{id}'}`. Иначе TS падает с `Cannot find name 'id'`.
- **Миграция конфигов блоков** — при добавлении новых полей в `ConfigSchema` обязательно проверять `parseConfig` на legacy формат. `custom.data` v0.14.0 мигрирует `rows[i].value` → `cells[primary].v`, top-level `format` → `columns[0].format`. Выбрасывание старых конфигов = потеря данных пользователей.
- **`BlockInstance.aiPrompt` приоритет над `config.blockPrompt`** — при обращении к AI из любого блока: `instance.aiPrompt > config.blockPrompt (legacy ai.micro-agent) > inline инструкция в MicroAgentDialog`. Реализовано в `block-grid.tsx` (формирование `blockContext`), `micro-agent-dialog.tsx` (отправка в `/api/ai/chat`) и `ai-micro-agent.tsx` (внутренний submit). Persistence: `BlockInstanceSchema.aiPrompt: string.max(8000).optional()` в API роуте `/api/blocks/layout/[pageKey]`.
- **`useMemo` ВЫШЕ early-returns в Block-Render компонентах (v0.15.0)** — компонент `RenderCustomData` имеет `if (density === 'xs') return ...` и `if (density === 'sm') return ...` early-returns. Любые `useMemo`/`useState`/`useEffect` ДОЛЖНЫ быть объявлены ВЫШЕ этих early-returns, иначе rules-of-hooks падает (`React Hook ... is called conditionally`). При reuse density-paradigma (xs/sm/md/lg) для других блоков — то же правило. ESLint ловит это в `pnpm build`.
- **Cross-page outgoing detection ограничено (v0.15.0)** — `/api/blocks/relations` собирает исходящие связи блока через `block.dependencies.sources` + `@`-refs внутри `config` (`collectRefsFromConfig` рекурсивный scan строк + объект `blockRefs`). Sheet-формулы с локальными ссылками типа `=A1+B2` НЕ считаются cross-page (это локальные cell-refs). Если в будущем добавляются новые типы кросс-блочных ссылок (например `useBlockValuePublisher` consumer pattern), их нужно явно добавить в scan.
- Ollama fallback не должен выбирать embedding-only модели.
- `useSearchParams` в Next.js 15 должен быть под `<Suspense>`.
- `bcryptjs` нельзя импортировать в код, который может попасть в middleware/edge runtime.
- **XLSX от Ozon** — `openpyxl` (Python) и SheetJS с `cellStyles: true` падают на «битом» border-стиле в шаблонах Ozon. Использовать SheetJS с `cellStyles: false` плюс fallback на ручной ZIP/XML парсинг (`node:zlib` + sharedStrings + sheet xml). Маппинг колонок строго по заголовкам, не по индексам.
- **`tsx` через pnpm в sandbox** — `pnpm tsx` поднимает локальный IPC сервер и падает с `EPERM listen` под жёстким sandbox. Запускать smoke-тесты через Shell с `required_permissions: ["all"]`.
- **Версионирование тарифов unit-economics** — никогда не редактировать существующий tariff pack inplace (`ozon_2026_04_07.ts`); добавлять новый `ozon_2026_05_xx.ts`. Сохранённые `unit_calculations.tariff_version` должны точно совпадать с константой текущего pack.
- **Linkable cell layout** — нельзя рендерить разные элементы (`<input>` vs `<button>`) для manual/linked: браузерные дефолты приводят к сдвигу/изменению размера. Всегда `<input>`, в linked — `readOnly + tabIndex=-1 + onClick → picker + cursor-pointer`.
- **Sticky cells background** — `var(--background)` через inline style не всегда полностью непрозрачен на cards/dialogs; писать `bg-card` (Tailwind), плюс sticky body z-index `≥20`, sticky header `≥30`, totals row `z-[25]`. На последней sticky-колонке — `boxShadow` справа, иначе текст из скроллящихся колонок «просвечивает» при горизонтальном скролле.
- **Store formula identifier substitution** — заменять идентификаторы по убыванию длины ключа (`priceRetail` перед `price`), иначе короткие ключи будут частично заменены внутри длинных. Использовать `(?<![A-Za-z0-9_$])key(?![A-Za-z0-9_$(])` чтобы не задеть другие токены.
- **Цикл в формулах** — детектируется через visiting-set (per-call), результат — литерал `'#CYCLE'` (не падать). UI должен отображать `'#CYCLE'`/`'#ERR'` как warning state.
- **`appearance.borderColor` через `boxShadow inset` на wrapper'е перекрывается детьми (v0.15.2)** — большинство блоков рендерят внутренний контейнер с `bg-card` на всю площадь; inset-shadow родителя физически прячется под этим бэкграундом. Правильный способ — отдельный absolute-overlay (`<div className="pointer-events-none absolute inset-0 z-20 rounded-lg" style={{ boxShadow: 'inset 0 0 0 2px {color}' }}>`), который сидит ПОВЕРХ детей по z-index, но ниже chrome-контролов (z-30). `pointer-events-none` обязателен — иначе overlay перехватит клики и интерактив внутри блока сломается.
- **`grid-cols-N` для палитры в узком столбце сжимает swatches (v0.15.2)** — Tailwind `grid-cols-12 gap-1` в столбце ~310px с фиксированной шириной ячеек `w-6` (24px) приводит к overflow → grid распределяет ширину дорожек и режет swatches до ~22px. Высота `h-6` остаётся 24px → визуальный дисбаланс + пропадают отступы. Правильный паттерн для палитр: `flex flex-wrap gap-1.5` + `shrink-0` на кнопках — фиксированный размер, естественный перенос. То же для иконок (`IconPalette`).
- **Active-ring через `--tw-ring-color` не всегда работает в инлайн-стилях** — Tailwind генерирует `--tw-ring-color` с fallback'ом, и переопределить только через `style={{ '--tw-ring-color': color }}` может не сработать на всех билдах. Надёжнее — `boxShadow: '0 0 0 Npx hsl(var(--background)), 0 0 0 Mpx {actualColor}'` (двойное кольцо с gap до фона). Это работает на любой теме и видно даже для тёмных цветов (`#0f172a`), сливающихся с background.
- **Next.js self-hosted SSRF через WebSocket upgrade (CVE-2026-44578, v0.15.2)** — 13.4.13 — <15.5.16 и <16.2.5 уязвимы. На Vercel не воспроизводится, но мы планируем self-hosted/AWS. Фикс: bump до latest patch в minor-линии (мы взяли 15.5.18). Раз в квартал проверять `pnpm audit --prod` для остальных пакетов (xlsx, nodemailer, postcss сейчас тоже флагнуты, но не в активной критической area; nodemailer обновляется до 8.x только с миграцией API).
- **Курс — НЕ money-формат (v0.16.0)** — `currency.rates` публикует все курсы как `format: 'number'` БЕЗ `__money` метаданных. Курс — это число (например 90.5 RUB за 1 USD), а не money (которое хранится в копейках). Если случайно пометить курс как money, `formatRublesWithSettings` поделит 90.5 на 100 и пользователь увидит `0.91 ₽`. Формула `=A1*@currency.usd` корректно работает когда A1 — money-ячейка (рубли × 1 USD), а курс — обычное число. Money-формат у результата задаёт сама ячейка-потребитель (через `column.format='rubles'` в `custom.data` или формат ячейки в `excel.cell`), а не источник.
- **`publishColumnId` и `publish` колонки — две РАЗНЫЕ оси (v0.16.0)** — в `custom.data` `publishColumnId` определяет какую колонку показать в шапке как агрегат и публиковать как `value`, а `publish` колонки — это про экспорт через `@блок.id_колонки`. Раньше селект `publishColumnId` фильтровал только `publish !== false`, и если все колонки были `publish: false`, селект был пустой → пользователь не мог выбрать «Сумма» или «Вес» как основную, пока не добавит третью колонку с дефолтным `publish: true`. Фикс: показывать **все** колонки в селекте, при выборе скрытой автоматически делать её `publish: true` (защита: основная колонка обязана экспортироваться, иначе `value`/`__money='value'` не сработают для `@блок`-ссылок). Метка `· не публикуется` рядом с такими колонками.
- **`/api/blocks/sources`: внешние данные грузить ОДИН раз в GET, кэшировать в Map** (v0.16.0) — `getCurrencyRates()` вызывается в начале `GET`, результат живёт в `currencyRatesByCode: Map<string, CurrencyRate>` и пробрасывается в каждый `fieldsForBlock(...)` как параметр. Не вызывать `await getCurrencyRates()` ВНУТРИ `fieldsForBlock` — иначе на 50 блоков получим 50 SQL-запросов. Тот же паттерн используется для `monthlySummary`. При добавлении новых внешних источников в каталог блоков следовать этой же конвенции.
- **Lazy-refresh окно — 23h, не 24h** (v0.16.0) — `CURRENCY_STALENESS_WINDOW_MS = 23 * 60 * 60 * 1000`. ЦБ обновляет курсы около 11:30 МСК. Окно 24h создавало бы кейс «вчера в 23:59 обновили — сегодня в 11:00 ещё не пора» и пользователь видел бы устаревшие данные часами. 23h гарантирует, что после полудня уже свежие курсы.
- **In-memory rate-limit карты НЕ переживают перезагрузку** (v0.16.0) — `lastRefreshAt: Map<string, number>` в `/api/currency/rates/refresh` сбрасывается при рестарте Node-процесса. Для одиночного инстанса этого достаточно (защита от спам-кликов одного пользователя). При горизонтальном масштабировании на N pod'ов нужно переехать в Redis (когда BullMQ/Redis появится в проекте). Для current scope OK.
- **Next.js HTML-500 на unhandled route exception** (v0.16.0 audit) — если route handler бросает exception БЕЗ try/catch, Next возвращает HTML error page (или вообще пустое тело в production). Frontend, делающий `await response.json()`, падает с `Unexpected end of JSON input` — пользователь видит криптическое сообщение вместо реальной причины. **Правило:** ВСЕ route handlers, которые могут потенциально упасть на `db.*`/external fetch, обязаны иметь top-level try/catch с `NextResponse.json({ ok: false, error })`. На клиенте использовать `parseJsonResponse(response)` хелпер: сначала `response.text()`, потом `JSON.parse()` с try/catch — даёт пользователю осмысленное сообщение (включая extract `<title>` HTML-страницы как hint).
- **Auto-refresh без guard → рекурсия** (v0.16.0 audit) — в `useCurrencyRates()` логика «БД пустая → авто-refresh» приведёт к бесконечному циклу, если refresh тоже возвращает пустой массив (CBR недоступен, или таблица не создана). Решение: `useRef<boolean>` flag (`triedAutoRefreshRef`), сбрасывается только при unmount. Один авто-вызов за жизнь компонента, дальше — только через user-кликом по `RefreshCw`. То же правило применять для любых auto-trigger'ов в reactive store.
- **Async fetch + setState после unmount** (v0.16.0 audit) — fetch'ы в hook'ах должны защищаться от setState после unmount: `mountedRef = useRef(true)` + cleanup в useEffect + обёртка `safeSetState`. Без этого React пишет warning и могут быть гонки при быстром add/remove блока.
