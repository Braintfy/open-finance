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
- `src/components/blocks/block-grid.css` — resize handle скрыт в обычном режиме и появляется после 3s hover; в edit mode сразу.
- `src/components/blocks/block-chrome.tsx` — wrapper, hover controls, settings/delete/AI.
- `src/components/blocks/block-settings-dialog.tsx` — настройки блока: параметры, внешний вид, размер, связи.
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

### Текущий каталог блоков
`stat.income`, `stat.expense`, `stat.balance`, `stat.custom`, `cashflow.top-categories`, `cashflow.transactions`, `sheet`, `excel.cell`, `navigate.card`, `computed.sum`, `custom.data`, `chart.cashflow`, `ai.micro-agent`, `inbox.channel-feed`, `unit.ozon-calculator`, `unit.ozon-multi-table`, `unit.yandex-calculator`.

## Реализованные страницы и модули
- **Dashboard `/dashboard`** — BlockGrid с KPI и navigation cards.
- **Cashflow `/cashflow`** — CRUD/import транзакций, KPI, top categories, transactions, chart.
- **Inbox `/inbox`** — BlockGrid с двумя дефолтными блоками `inbox.channel-feed` размером `6×12`.
- **Boards `/boards`, `/boards/[boardId]`** — персональные доски на BlockGrid, `pageKey = board-{boardId}`.
- **Unit Economics `/unit-economics`** — три вкладки (`unit-economics-ozon`, `unit-economics-ozon-multi`, `unit-economics-yandex`), каждый таб = свой `pageKey` с самостоятельным BlockGrid layout.
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

## Sheet / Excel Cell / связи
- `sheet` — мини-таблица с формулами, `@связать`, computed cells в sources API, `__money` metadata для денежных ячеек. Без `minContentSize` — таблица скроллится внутри блока любого размера (`minSize: 1×1`).
- `excel.cell` — компактная одиночная Excel-like ячейка `3×2`, формулы и `moneyRefs`.
- **Money detection через `moneyRefs`**: оба `sheet` и `excel.cell` сохраняют `Record<string, boolean>` в config при `@связать` (через `sourceFieldIsMoney`). `formulaReferencesMoneyRefs(raw, moneyRefs)` сначала проверяет сохранённые флаги, потом fallback на эвристику по имени поля. То же используется server-side в `/api/blocks/sources/evaluateSheetCells`.
- **Публикация `__money`**: KPI-блоки (`stat.*`, `computed.sum`, `custom.data` с format=rubles, `excel.cell` с money формулой) публикуют `__money: 'value'` (или `'value,sum'`) через `useBlockValuePublisher`, чтобы live preview в `@связать` picker правильно форматировал копейки. Sheet публикует `__money` со списком money-ячеек (адресов).
- `/api/blocks/sources` server-side считает Sheet formulas, включая linked cells, чтобы вкладки страниц совпадали с live current-page values.
- `useAvailableBlockSources()` скрывает служебные поля вроде `__money`.
- Формат денег нельзя выводить из факта `@`; нужен explicit `format: money` (server) / сохранённый `moneyRefs` (client), иначе обычные ячейки будут ошибочно делиться на копейки.

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

## Unit Economics (MVP, v0.11.0)
### Ключевые файлы
- `src/lib/unit-economics/types.ts` — `Marketplace`, `OzonMode`, `YandexMode`, `TaxMode`, `OzonInputs/Results`, `YandexInputs/Results`, `UnitCellBinding`, утилиты (`clamp`, `safeNumber`, `round2`, `rublesToKopecks`).
- `src/lib/unit-economics/ozon/{tariffs-2026-04-07,calculate}.ts` — версионированный тарифный пак (`OZON_TARIFF_VERSION = ozon_2026_04_07`) и pure-TS engine.
- `src/lib/unit-economics/yandex/{tariffs-2026-04-01,calculate}.ts` — версионированный тарифный пак (`YANDEX_TARIFF_VERSION = yandex_2026_04_01`) и pure-TS engine.
- `src/lib/unit-economics/bindings.ts` — `isBindingActive`, `bindingScopedKey`, `resolveBindingValue` (kopecks→rubles по флагу `money`), `bindingHasValue`.
- `src/lib/unit-economics/use-live-block-values.ts` — `useAllBlockValuesFlat` (live из `BlockValuesContext`), `useRemoteBlockSources` (`/api/blocks/sources`).
- `src/lib/unit-economics/import/ozon-price-template.ts` — XLSX-парсер с SheetJS + fallback ZIP/XML.
- `src/lib/unit-economics/queries.ts` — tenant-scoped CRUD `unit_products`/`unit_calculations`/`unit_imports`, `bulkUpsertUnitProducts`.
- `src/lib/db/schema/unit-economics.ts` — Drizzle-таблицы (деньги в копейках `integer`).
- `drizzle/init/05-unit-economics.sql` — manual SQL.
- `src/app/api/unit-economics/{products,calculations,import/ozon-prices}/route.ts` — API.
- `src/lib/blocks/catalog/{unit-ozon-calculator,unit-ozon-multi-table,unit-yandex-calculator}.tsx` — блоки.
- `src/components/unit-economics/{unit-cell-binding-dialog,linkable-number-cell}.tsx` — UI привязок.
- `src/app/(app)/unit-economics/{page,unit-economics-client}.tsx` — server + client страница.
- `scripts/test-unit-economics.ts` — smoke tests (запуск: `pnpm tsx scripts/test-unit-economics.ts [path-to-xlsx]`).

### Инварианты
- **Версионирование тарифов:** сохранённые `unit_calculations.tariff_version` ссылаются на конкретный pack (`ozon_2026_04_07`, `yandex_2026_04_01`); при добавлении нового pack — не перезаписывать старые расчёты.
- **Деньги:** в БД хранить в копейках (`integer`), в `inputs/results` JSONB — рубли с `money: true` пометкой при необходимости. UI форматирует через существующие helpers.
- **Linkable cells:** money-флаг обязателен для денежных привязок, иначе будет повторение бага «деление/не деление на 100». Fallback хранится при пропадании источника, показывается warning state.
- **XLSX-импорт Ozon:** маппинг колонок по заголовкам, не индексам. SheetJS читать с `cellStyles: false`. Fallback ZIP/XML парсер обходит «битый» stylesheet от Ozon. Фильтровать служебные строки-метки.
- **Tenant isolation:** все API под `auth()`, все DB-запросы фильтруются по `tenant_id`. `unit_products` upsert по `(tenant_id, marketplace, article)`.
- **Aggregate outputs:** все unit-блоки публикуют `rowsCount`, `avgMargin`, `avgRoi`, `totalProfitMonth`, `totalStockValue`, `totalMoneyInGoods` через `useBlockValuePublisher` с `__money` для денежных полей.
- **`/api/blocks/sources`:** `unit-economics-*` page labels и `unit.*` type labels добавлены в `DEFAULT_PAGE_KEYS`/`PAGE_LABELS`/`TYPE_LABELS`. `fieldsForBlock` возвращает publishable поля.
- **Yoolip credentials:** не хранить в git/плане. Только email + факт наличия тестового доступа в плане; пароль — вне репозитория.

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
- `CHANGELOG.md` — история изменений; текущая версия `0.10.4`. Грузить по запросу.
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
```

## Текущий статус на 2026-05-14
- **Версия:** `0.11.0` в `CHANGELOG.md`; `package.json` всё ещё `0.5.0` и не является источником статуса фич.
- **Фаза:** Unit Economics MVP (Ozon FBO/FBS, Ozon мульти-артикул, Яндекс Маркет) поверх Inbox Channels MVP + AI Micro-Agent + External Providers/VPN/Diagnostics + Boards.
- **Build:** `pnpm typecheck` и `pnpm build` проходят; smoke-тесты `pnpm tsx scripts/test-unit-economics.ts` зелёные (19 проверок + XLSX-парсер на реальном файле).
- **Контекстные файлы:** `0.10.3` ввёл `START.md` и переход на ленивую загрузку контекста — `CHANGELOG.md`/`PLAN.md` больше не грузятся целиком по умолчанию.
- **Ближайшие TODO:**
  - применить `05-unit-economics.sql` в dev DB (manual SQL command выше);
  - применить `04-inbox.sql` в dev DB;
  - подключить сохранение `unit_calculations` из блоков (сейчас только инфраструктура и API готовы);
  - добавить экспорт CSV/XLSX и share/permalink для калькуляторов;
  - покрыть UI плотными e2e-тестами через webapp-testing skill;
  - продолжить: Telegram Bot канал, Whisper transcription, RAG/orchestrator, Cmd+K AI action.

## Грабли, которые нельзя повторять
- `sanitizeBlocks` на сервере может выкинуть блоки из-за client-only catalog.
- Resize handle нельзя делать через JS hover-marker внутри `BlockChrome`; CSS hover на `.react-grid-item` стабильнее.
- Sheet sources нельзя строить только из raw saved cells: формулы и linked cells должны считаться/merge-иться.
- Служебные поля (`__money`) нужны для metadata, но не должны показываться selectable source.
- `formatRublesWithSettings` принимает копейки; не форматировать обычные Sheet cells как деньги без metadata.
- **Money detection в формулах** — нельзя полагаться только на эвристику `refIsPlainNumber` по имени поля. При `@связать` нужно сохранять `moneyRefs[ref] = sourceFieldIsMoney(...)` в config (как в `excel.cell` и `sheet`). Иначе ссылка на KPI будет показывать `2 613 726 900` вместо `26 137 269 ₽`.
- **`__money` metadata в KPI-блоках** — любой блок, публикующий рублёвое значение через `useBlockValuePublisher`, должен публиковать `__money: 'value'` (или список полей). Без этого live preview в `@связать` picker и `mergeLiveFields` не пометят source как money.
- **`minContentSize` блокирует ресайз** — если блок умеет сам скроллиться (`overflow-auto` внутри), не задавайте `minContentSize`. Иначе пользователь не сможет уменьшить блок и получит overlay «Мало места».
- Ollama fallback не должен выбирать embedding-only модели.
- `useSearchParams` в Next.js 15 должен быть под `<Suspense>`.
- `bcryptjs` нельзя импортировать в код, который может попасть в middleware/edge runtime.
- **XLSX от Ozon** — `openpyxl` (Python) и SheetJS с `cellStyles: true` падают на «битом» border-стиле в шаблонах Ozon. Использовать SheetJS с `cellStyles: false` плюс fallback на ручной ZIP/XML парсинг (`node:zlib` + sharedStrings + sheet xml). Маппинг колонок строго по заголовкам, не по индексам.
- **`tsx` через pnpm в sandbox** — `pnpm tsx` поднимает локальный IPC сервер и падает с `EPERM listen` под жёстким sandbox. Запускать smoke-тесты через Shell с `required_permissions: ["all"]`.
- **Версионирование тарифов unit-economics** — никогда не редактировать существующий tariff pack inplace (`ozon_2026_04_07.ts`); добавлять новый `ozon_2026_05_xx.ts`. Сохранённые `unit_calculations.tariff_version` должны точно совпадать с константой текущего pack.
