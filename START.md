# START.md — bootstrap Open Finance

> Первый файл AI-агента в новой сессии. Триггер: «загрузи контекст Open Finance» / «прогрев of».
> Остальная документация — **по запросу**, не по умолчанию.

## Bootstrap (3 шага, ~9K токенов)

1. **`START.md`** (этот файл) — карта проекта, правила, маршрутизация.
2. **`MEMORY.md`** (~5K токенов) — текущее состояние, инварианты, активные грабли.
3. **`git -C /Users/firay/open-finance/open-finance log --oneline -20`** — последние коммиты.

После этого можно работать любой сложности. Дальше — **только релевантное конкретной задаче** (см. таблицу маршрутизации).

> В Cursor IDE дополнительно автоматически загружается `.cursor/rules/project-context.mdc` (`alwaysApply: true`, компактный) — он короче `START.md` и работает как «всегда включённый минимум». При работе с конкретными подсистемами Cursor сам прицепляет `.cursor/rules/{blocks,marketplaces,ai-tools,drizzle,security,unit-economics}.mdc` по globs.
>
> В Claude Code работает агентная обвязка **`.claude/`** (с v0.41.0): скилы `/of-*` (процедуры), сабагенты `of-*-dev`/`of-*-reviewer`, воркфлоу `of-{test-sweep,review,rules-audit}`. Карта — `.claude/README.md`. Принцип: правила живут ТОЛЬКО в `.cursor/rules/*.mdc`, обвязка на них ссылается.

## Идентичность

**Open Finance** — AI-первая модульная финансовая платформа для предпринимателей РФ (селлеры OZON/WB/ЯМ, ИП, фрилансеры, малый бизнес). Сейчас — Next.js 15 SaaS. Phase 2 — Tauri 2.0. Phase 3 — React Native + Expo.

Главная идея: **почти каждая страница = настраиваемый BlockGrid**. Новая фича обычно = новый block type в `src/lib/blocks/catalog/`, а не статичная страница.

Источник правды версии: первый заголовок `## [X.Y.Z]` в `CHANGELOG.md` + `git log` (`package.json` 0.5.0 устарел навсегда — версию НЕ хардкодить в доках).

## Жёсткие правила (MUST NOT)

- НЕ делать `git add/commit/push` — давать команды пользователю.
- НЕ запускать DB-миграции — давать команды.
- НЕ коммитить `.env`, секреты, ключи, токены.
- НЕ использовать `npm`/`yarn` — только `pnpm`.
- НЕ использовать Prisma — только Drizzle ORM.
- НЕ использовать Vercel AI SDK — только своя обёртка `src/lib/ai/providers/`.
- НЕ делать DB-запрос без `tenant_id`.
- НЕ писать SQL из AI напрямую — только через Tools Layer (`src/lib/ai/tools/`).
- НЕ делать глубокую вложенность `src/features/x/y/z` — модули плоско в `src/modules/`.
- НЕ использовать `import * as X` — только явные импорты.
- НЕ использовать системные `alert/confirm/prompt` — только Dialog/AlertDialog.
- Новые исходники начинать с `// PURPOSE: ...`.

## Стек (1 строка)

Next.js 15 App Router + TS + Tailwind + shadcn/ui + Drizzle ORM + Postgres 16 + pgvector + Redis 7 + BullMQ + Ollama/OpenAI-compat AI providers + NDJSON streaming. Node ≥20, pnpm 9.12.3.

## Структура src/

```
src/
├── app/                  Next.js App Router (pages, api/)
│   ├── (app)/            authenticated shell (dashboard, cashflow, inbox, boards, unit-economics, marketplace, settings, admin)
│   ├── (auth)/           login/register/forgot
│   └── api/              auth, blocks, cashflow, inbox, ai, boards, marketplaces, currency
├── components/blocks/    BlockGrid shell, chrome, dialogs, relations overlay
├── components/marketplaces/  GlobalSyncIndicator, SyncAllButton, OzonSyncDialog
├── components/unit-economics/  калькуляторы, sync UI, biding picker, analytics table
├── components/micro-agent/  AI dialog
├── components/ui/        shadcn primitives
├── lib/ai/               providers, micro-agent, tools, vision, memory (TODO)
├── lib/blocks/           types, registry, catalog/, values, relations, source-binding
├── lib/boards/           Boards CRUD
├── lib/currency/         CBR fetch, queries
├── lib/db/               Drizzle client + schema/
├── lib/inbox/            IMAP, MIME, crypto, queries
├── lib/marketplaces/     Ozon Seller API + Performance API
├── lib/unit-economics/   tariffs, calculate, bindings, store-formula
├── lib/env.ts            typed env
└── modules/              business modules (cashflow, inbox, communications)
```

## Маршрутизация задач

> Грузить только это, не всё подряд. Cursor дополнительно сам прицепит `.cursor/rules/*.mdc` по globs.

| Тип задачи | Что читать |
|---|---|
| **BlockGrid / новый block** | `src/lib/blocks/{types,registry}.ts`, `src/components/blocks/block-grid.tsx`, нужный файл из `src/lib/blocks/catalog/`. Cursor подтянет `.cursor/rules/blocks.mdc`. |
| **AI-чат, streaming, micro-agent** | `src/app/api/ai/chat/route.ts`, `src/components/micro-agent/micro-agent-dialog.tsx`, `src/lib/ai/providers/{ollama,openai-compat,proxy}.ts`. Rules: `ai-tools.mdc`. |
| **Новый AI tool** | `src/lib/ai/tools/index.ts` + пример `src/lib/ai/tools/query-inbox-messages.ts`, `docs/AI_TOOLS.md`. Rules: `ai-tools.mdc`. |
| **AI Vision (распознавание чеков/счетов)** | `src/lib/ai/vision/{types,router}.ts`, `providers/{claude,openai,yandex,tesseract,mock}.ts`, `docs/AI_VISION.md`. |
| **Inbox / IMAP** | `src/lib/inbox/{imap,mime,crypto,queries}.ts`, `src/lib/blocks/catalog/inbox-channel-feed.tsx`, `docs/EMAIL_BEGET.md`. |
| **Курсы валют** | `src/lib/currency/{types,queries,sources/cbr}.ts`, `src/lib/blocks/catalog/currency-rates.tsx`, `src/app/api/currency/rates/{route,refresh/route}.ts`, `drizzle/init/06-currency.sql`. |
| **Ozon Seller API / Performance API** | `src/lib/marketplaces/{types,crypto,queries,use-accounts}.ts`, `src/lib/marketplaces/ozon/{client,endpoints,types,upsert,upsert-plan,sync/*}.ts`, `src/app/api/marketplaces/**`, `src/app/(app)/settings/integrations/*`, `src/components/marketplaces/*`. Rules: `marketplaces.mdc`. При работе с API смотреть `OZON_API_VERSION_MAP` в `endpoints.ts`. **`OzonClient.post()` lenient** (warning + raw на Zod fail) — `{ strict: true }` для критичных. **Sync upsert идемпотентен через `planUnitProductUpsertFromOzon()`** (pure function, unit-тесты в `scripts/test-ozon-upsert.ts`). |
| **Ozon Analytics (per-product, KPI, ABC, campaigns)** | Блоки `unit.ozon-*` в `src/lib/blocks/catalog/`, `src/components/unit-economics/ozon-analytics-*`, `src/app/api/marketplaces/ozon/{kpi,timeseries,top-ads,abc,campaigns,search-phrases,cluster-stocks-v2}/route.ts`. Все используют MSC `query-period.ts`. Ads totals — `src/lib/marketplaces/ozon/ads-totals.ts`. Rules: `marketplaces.mdc`. |
| **Roadmap marketplace-интеграций** | `docs/MARKETPLACES_FUTURE_PLAN.md`, `docs/OZON_ADS_GAP.md`, `docs/MARKETPLACES_OZON_PERFORMANCE.md`. |
| **Unit Economics (калькуляторы, multi-table, my store)** | `src/lib/unit-economics/{types,bindings,store-formula,ozon-to-my-store}.ts`, директории `src/lib/unit-economics/{ozon,yandex}/` (calculate, tariffs-*), `src/components/unit-economics/*`, `src/app/api/unit-economics/**`. Rules: `unit-economics.mdc`. |
| **Sheet / custom.data / excel.cell** | `src/lib/blocks/catalog/{sheet,custom-data,excel-cell}.tsx`, `docs/CUSTOM_DATA_BLOCK.md`. |
| **KPI Grid** | `src/lib/blocks/catalog/kpi-grid.tsx`, `docs/KPI_GRID.md`. |
| **Periods / page-period header / useBlockPeriod** | `src/lib/blocks/use-block-period.ts`, `src/lib/blocks/page-period-context.tsx`, `src/components/blocks/page-period-header.tsx`, `docs/PAGE_PERIODS.md` — **читать при добавлении нового блока с периодом**. |
| **Cashflow / транзакции** | `src/lib/cashflow/*`, `src/modules/cashflow/*`, `src/app/api/cashflow/*`, `docs/CASHFLOW_BLOCKS.md`. |
| **Boards** | `src/lib/db/schema/boards.ts`, `src/lib/boards/queries.ts`, `src/app/(app)/boards/*`, `drizzle/init/03-boards.sql`. |
| **DB schema / миграции** | `src/lib/db/schema/*`, `drizzle/init/*.sql`. После изменений: дать `pnpm db:generate && pnpm db:push`. Rules: `drizzle.mdc`. |
| **Auth / NextAuth v5** | `src/lib/auth/*`, `src/app/(auth)/*`, `src/middleware.ts`. Rules: `security.mdc`. |
| **Биллинг (Т-Касса/CloudPayments)** | `src/lib/billing/*`, `docs/BILLING.md`. Rules: `security.mdc`. |
| **Безопасность / секреты / 152-ФЗ** | `docs/SECURITY.md` (**ОБЯЗАТЕЛЬНО** при работе с секретами/сетью/биллингом). Rules: `security.mdc` auto-loads на соотв. файлы. |
| **Tauri / desktop** | `docs/DESKTOP_STRATEGY.md`, `docs/LICENSING.md`. |
| **Локальный AI / Ollama / VPN** | `docs/LOCAL_AI.md`, `docs/VPN_FOR_AI.md`. |
| **Стратегия продукта** | `PLAN.md` — **только нужный раздел через `Read offset+limit`**, не файл целиком (1427 строк). |
| **История релизов** | `git log --oneline -30` или `Read CHANGELOG.md offset=1 limit=100`. НЕ весь файл (~4K строк). |
| **Историческая память (v0.10-v0.22)** | `docs/memory-archive/` — конкретный файл версии по запросу. |
| **Работа с библиотекой** (Next 15, Drizzle, shadcn, pgvector, Tauri 2) | Context7: `mcp0_resolve-library-id` → `mcp0_query-docs`, не более 3 вызовов. |
| **Верификация / smoke-тесты** | Скилы `.claude/skills/of-verify`, `of-run-tests`; все тесты параллельно — воркфлоу `of-test-sweep`. |
| **Ревью перед коммитом** | Сабагенты `of-code-reviewer`/`of-security-reviewer` или воркфлоу `of-review` (мультиагентный с верификацией находок). |
| **Конец сессии (CHANGELOG/MEMORY/handoff)** | **Канон:** `.claude/skills/of-end-session/SKILL.md`. |
| **Процедуры: новый блок / схема БД / AI-route / AI-tool / колонка Ozon** | Скилы `of-new-block`, `of-db-change`, `of-new-ai-route`, `of-new-ai-tool`, `of-ozon-column`. |

## Команды

```bash
pnpm install
pnpm docker:up                          # Postgres + Redis
pnpm db:push                            # применить schema (dev)
pnpm dev                                # Next.js
pnpm typecheck && pnpm build            # проверка
```

## После значимых изменений (обязательно)

1. `pnpm build` — должен пройти.
2. Обновить `MEMORY.md` (если изменились ключевые файлы/инварианты/грабли).
3. Добавить запись в `CHANGELOG.md`.
4. Дать пользователю git-команды (`git add -A && git commit -m "..." && git push origin main`) — **не выполнять самому**.
5. (Опц.) Ключевые решения → agentmemory MCP `memory_save` (mempalace и `sync-mempalace.sh` deprecated).

Полный ритуал — `.claude/skills/of-end-session/SKILL.md` (канон).

## AI memory — agentmemory (с v0.22.4)

**Старый стек:** mempalace (deprecated с v0.22.4, см. `docs/MEMPALACE_RUNBOOK.md`).

**Новый стек:** `agentmemory` MCP server на localhost:3111 + viewer на 3113. Управляется через launchd-агент `~/Library/LaunchAgents/com.agentmemory.server.plist` (auto-start).

**Использование:**
- В Cursor MCP подцеплен через `~/.cursor/mcp.json`. После запуска агента доступны **51 MCP tools** (memory_save, memory_smart_search, memory_sessions, memory_recall, etc.).
- В чате: «найди в памяти, почему мы отказались от Vercel AI SDK» → агент вызовет `memory_smart_search`. «Запиши в память: X = Y» → `memory_save`.
- Viewer: <http://localhost:3113> — live observation stream, session replay, knowledge graph.
- Health: `curl http://localhost:3111/agentmemory/health`.
- Установка: `./scripts/install-agentmemory.sh` (интерактивный, ставит iii-engine + agentmemory + опц. local embeddings).
- Подробности: **`docs/MEMORY_SETUP.md`**.

**Текущее состояние = `MEMORY.md` + `git log`** + (по теме) конкретные файлы. agentmemory = **опциональная** археология, не источник правды. Если сервер не отвечает — MCP shim даёт 7 fallback tools, Cursor работает дальше.

## Ключевые грабли (топ-7, не повторять)

- `sanitizeBlocks` на сервере выкидывает блоки — client-only catalog пуст в server bundle.
- Sheet sources обязаны включать computed formulas + linked cells, не только raw saved cells.
- Money formatting (копейки) только при явном `format: money` / `moneyRefs` — иначе обычные числа делятся на 100.
- Ollama fallback не должен выбирать embedding-only модели.
- `useSearchParams` в Next 15 требует `<Suspense>`.
- `bcryptjs` нельзя импортировать в edge/middleware.
- postgres.js `sql\`${dateObj}\`` падает с TypeError — сначала `.toISOString()` + `::timestamp` cast.

Полный список — в `MEMORY.md` (раздел «Активные грабли») и `LEARNING_LOG.md` (append-only).
