# START.md — bootstrap Open Finance

> Первый файл AI-агента в новой сессии. Триггер: «загрузи контекст Open Finance» / «прогрев of».
> Остальная документация — **по запросу**, не по умолчанию.

## Bootstrap (3 шага, ~19K токенов)

1. **`START.md`** (этот файл, ~5K токенов) — карта проекта, правила, маршрутизация.
2. **`MEMORY.md`** (**~13,8K токенов**, ~370 строк) — текущее состояние, инварианты, активные грабли. Детальные нарративы вынесены в `docs/memory-archive/` — читать только по запросу.
3. **`git log --oneline -20`** (~0.5K) — последние коммиты.

После этого можно работать любой сложности. Дальше — **только релевантное конкретной задаче** (см. таблицу маршрутизации).

> В Cursor IDE дополнительно автоматически загружается `.cursor/rules/project-context.mdc` (`alwaysApply: true`, компактный) — он короче `START.md` и работает как «всегда включённый минимум». При работе с конкретными подсистемами Cursor сам прицепляет `.cursor/rules/{blocks,marketplaces,ai-tools,drizzle,security,unit-economics}.mdc` по globs.
>
> В Claude Code работает агентная обвязка **`.claude/`**: скилы `/of-*` (процедуры), сабагенты `of-*-dev`/`of-*-reviewer`, воркфлоу `of-{test-sweep,review,rules-audit}`. Карта — `.claude/README.md`, актуальный состав — `ls .claude/{skills,agents,workflows}` (счётчики не хардкодим). Принцип: правила живут ТОЛЬКО в `.cursor/rules/*.mdc`, обвязка на них ссылается.

## Идентичность

> **Цель пересмотрена 2026-11-17: приватный хаб продавца, а не публичный SaaS.** Канон цели, карты и этапов — **`docs/HUB_PLAN.md`**; роли моделей (старшие управляют, младшие исполняют) — **`.claude/ORCHESTRATION.md`**; сервер — `docs/SERVER.md`. Абзацы ниже описывают, как проект устроен сейчас.

**Open Finance** — AI-первая модульная финансовая платформа для предпринимателей РФ (селлеры OZON/WB/ЯМ, ИП, фрилансеры, малый бизнес). Сейчас — Next.js 15 SaaS. Phase 2 — Tauri 2.0. Phase 3 — React Native + Expo.

**Новые разделы — обычные страницы с вкладками и таблицами (решение владельца 2026-11-18, `docs/HUB_PLAN.md` §4); готового образца в проекте нет — все нынешние страницы, включая склад, собраны на BlockGrid; первой обычной страницей станет «Аналитика». Конструктор BlockGrid остаётся только на сводной и на уже существующих страницах; новые блоки — лишь плитки-витрины поверх общего слоя метрик.**

Источник правды версии: первый заголовок `## [X.Y.Z]` в `CHANGELOG.md` + `git log` (`package.json` 0.5.0 устарел навсегда — версию НЕ хардкодить в доках).

## Жёсткие правила (MUST NOT)

> Канон набора — `.cursor/rules/project-context.mdc`. Те же 14 пунктов в `CLAUDE.md`, `AGENTS.md`, `MEMORY.md`. **Меняешь одно — правишь все пять файлов.**

1. НЕ делать `git add/commit/push` — давать команды пользователю.
2. НЕ запускать DB-миграции (`db:push`/`db:migrate`) — давать команды.
3. НЕ коммитить `.env`, секреты, ключи, токены.
4. НЕ использовать `npm`/`yarn` — только `pnpm`.
5. НЕ использовать Prisma — только Drizzle ORM.
6. НЕ использовать Vercel AI SDK — только своя обёртка `src/lib/ai/providers/`.
7. НЕ делать DB-запрос без `tenant_id`; `tenantId` — ТОЛЬКО из сессии (`requireTenant()`/`requireTenantRoute()`, `docs/TENANT_SCOPING.md`).
8. НЕ писать SQL из AI напрямую — только через Tools Layer (`src/lib/ai/tools/`).
9. НЕ делать глубокую вложенность `src/features/x/y/z` — домены в `src/lib/<домен>/` + `src/components/<домен>/` + `src/app/api/<домен>/` (`src/modules/` — исторический каркас, кода там нет).
10. НЕ использовать `import * as X` — только явные импорты.
11. НЕ использовать системные `alert/confirm/prompt` — только Dialog/AlertDialog.
12. Новые исходники начинать с `// PURPOSE: ...`.
13. Интерактивные CLI-команды запускать неинтерактивно (`-y`/`--yes`/`--force`).
14. Удаление данных — ВСЕГДА с подтверждением пользователя + проверка `tenant_id` в запросе.

## Стек (1 строка)

Next.js 15 App Router + TS + Tailwind + shadcn/ui + Drizzle ORM + Postgres 16 + pgvector + свой JWT-auth (`jose`+`bcryptjs`) + свои AI-провайдеры (Ollama / OpenAI-compat / YandexGPT / GigaChat) + NDJSON streaming. Node ≥20, pnpm 9.12.3.

**Чего НЕТ, хотя часто предполагают:** NextAuth и Google OAuth (свой JWT, API лишь совместим по именам), Redis/BullMQ (`src/lib/redis.ts` — in-memory shim; контейнер `redis:7` в compose поднимается, но приложение к нему не ходит), S3-SDK, TipTap (реально `@mdxeditor/editor`), `node-imap` (свой IMAP поверх `net`/`tls` + `mailparser`), grammY, Sentry/Prometheus/Grafana, univer/handsontable (своя таблица на `fast-formula-parser` + `xlsx`), tesseract.js, Whisper. Полная разбивка «есть / shim / план» — `CLAUDE.md` раздел «Стек». Источник правды — `package.json`.

## Структура src/

```
src/
├── app/                  Next.js App Router (pages, api/)
│   ├── app/              authenticated shell (dashboard, cashflow, inbox, boards, unit-economics, marketplace, marketplaces, settings, admin, onboarding) — обычный сегмент `/app/*`, не route-group
│   ├── (auth)/           login/register/forgot
│   └── api/              auth, blocks, cashflow, inbox, ai, boards, marketplaces, currency
├── components/blocks/    BlockGrid shell, chrome, dialogs, relations overlay
├── components/marketplaces/  GlobalSyncIndicator, SyncAllButton, OzonSyncDialog
├── components/unit-economics/  калькуляторы, sync UI, biding picker, analytics table
├── components/micro-agent/  AI dialog
├── components/workspaces/  workspace-switcher («кабинеты»)
├── components/ui/        shadcn primitives
├── lib/ai/               providers, micro-agent, vision, prompts; orchestrator.ts + tools/ + memory/ — КАРКАС (Этап 4 PLAN.md, зарегистрирован 1 tool)
├── lib/blocks/           types, registry, catalog/, values, relations, source-binding
├── lib/boards/           Boards CRUD
├── lib/currency/         CBR fetch, queries
├── lib/db/               Drizzle client + schema/
├── lib/workspaces/       «кабинеты»: scope, active, queries
├── lib/inbox/            IMAP, MIME, crypto, queries
├── lib/marketplaces/     Ozon Seller API + Performance API
├── lib/unit-economics/   tariffs, calculate, bindings, store-formula
├── lib/env.ts            typed env
└── modules/              исторический каркас (только README, кода/импортов нет) — реестр модулей в lib/modules/registry.ts
```

## Маршрутизация задач

> Грузить только это, не всё подряд. Cursor дополнительно сам прицепит `.cursor/rules/*.mdc` по globs.

| Тип задачи | Что читать |
|---|---|
| **BlockGrid / новый block** | `src/lib/blocks/{types,registry}.ts`, `src/components/blocks/block-grid.tsx`, нужный файл из `src/lib/blocks/catalog/`. Cursor подтянет `.cursor/rules/blocks.mdc`. |
| **Воркспейсы («кабинеты») / активный кабинет / шаблоны** | **Канон — `docs/LK_V2_PLAN.md`**; конспект — раздел «Воркспейсы» в `MEMORY.md`. Код: `src/lib/workspaces/{scope,active,queries}.ts`, `src/lib/blocks/default-layouts.ts` (WORKSPACE_TEMPLATES), `src/app/api/workspaces/**`, `src/components/workspaces/workspace-switcher.tsx`. Инвариант: `nav`+`board-*` всегда в default-кабинете; пользовательские раскладки/вкладки скоупятся по `workspace_id`, uniq `(workspace_id, page_key)`. |
| **AI-чат, streaming, micro-agent** | `src/app/api/ai/chat/route.ts`, `src/components/micro-agent/micro-agent-dialog.tsx`, `src/lib/ai/providers/{ollama,openai-compat,proxy}.ts`. Rules: `ai-tools.mdc`. |
| **Новый AI tool** | `src/lib/ai/tools/index.ts` + пример `src/lib/ai/tools/query-inbox-messages.ts`, `docs/AI_TOOLS.md`. Rules: `ai-tools.mdc`. |
| **AI Vision (распознавание чеков/счетов)** | `src/lib/ai/vision/{types,router}.ts`, `providers/{claude,openai,yandex,tesseract,mock}.ts`, `docs/AI_VISION.md`. |
| **Inbox / IMAP** | `src/lib/inbox/{imap,mime,crypto,queries}.ts`, `src/lib/blocks/catalog/inbox-channel-feed.tsx`, `docs/EMAIL_BEGET.md`. |
| **Курсы валют** | `src/lib/currency/{types,queries,sources/cbr}.ts`, `src/lib/blocks/catalog/currency-rates.tsx`, `src/app/api/currency/rates/{route,refresh/route}.ts`, `drizzle/init/06-currency.sql`. |
| **Ozon Seller API / Performance API** | `src/lib/marketplaces/{types,crypto,queries,use-accounts}.ts`, `src/lib/marketplaces/ozon/{client,endpoints,types,upsert,upsert-plan,sync/*}.ts`, `src/app/api/marketplaces/**`, `src/app/app/settings/integrations/*`, `src/components/marketplaces/*`. Rules: `marketplaces.mdc`. При работе с API смотреть `OZON_API_VERSION_MAP` в `endpoints.ts`. **`OzonClient.post()` lenient** (warning + raw на Zod fail) — `{ strict: true }` для критичных. **Sync upsert идемпотентен через `planUnitProductUpsertFromOzon()`** (pure function, unit-тесты в `scripts/test-ozon-upsert.ts`). |
| **Ozon Analytics (per-product, KPI, ABC, campaigns)** | Блоки `unit.ozon-*` в `src/lib/blocks/catalog/`, `src/components/unit-economics/ozon-analytics-*`, `src/app/api/marketplaces/ozon/{kpi,timeseries,top-ads,abc,campaigns,search-phrases,cluster-stocks-v2}/route.ts`. Все используют MSC `query-period.ts`. Ads totals — `src/lib/marketplaces/ozon/ads-totals.ts`. Rules: `marketplaces.mdc`. |
| **Куда движется проект / что делать дальше** | **`docs/HUB_PLAN.md`** — канон с 2026-11-17 (приватный хаб: аналитика → WB → Ozon → сайты и остатки). Прежний роадмап — `docs/ROADMAP_V2.md`: этапы после `LK_V2_PLAN` (корректность расчётов → юнитка → финансовый контур P&L → аналитика → цифровизация бизнеса (сайты+маркетплейсы) → публичный запуск → обвязка). Там же — открытые вопросы к пользователю, без ответов на которые этапы D/F не начинать. |
| **Roadmap marketplace-интеграций** | `docs/MARKETPLACES_FUTURE_PLAN.md`, `docs/OZON_ADS_GAP.md`, `docs/MARKETPLACES_OZON_PERFORMANCE.md`. |
| **Unit Economics (калькуляторы, multi-table, my store)** | `src/lib/unit-economics/{types,bindings,store-formula,ozon-to-my-store}.ts`, директории `src/lib/unit-economics/{ozon,yandex}/` (calculate, tariffs-*), `src/components/unit-economics/*`, `src/app/api/unit-economics/**`. Rules: `unit-economics.mdc`. |
| **Sheet / custom.data / excel.cell** | `src/lib/blocks/catalog/{sheet,custom-data,excel-cell}.tsx`, `docs/CUSTOM_DATA_BLOCK.md`. |
| **KPI Grid** | `src/lib/blocks/catalog/kpi-grid.tsx`, `docs/KPI_GRID.md`. |
| **Periods / page-period header / useBlockPeriod** | `src/lib/blocks/use-block-period.ts`, `src/lib/blocks/page-period-context.tsx`, `src/components/blocks/page-period-header.tsx`, `docs/PAGE_PERIODS.md` — **читать при добавлении нового блока с периодом**. |
| **Cashflow / транзакции** | `src/lib/cashflow/*`, `src/modules/cashflow/*`, `src/app/api/cashflow/*`, `docs/CASHFLOW_BLOCKS.md`. |
| **Boards** | `src/lib/db/schema/boards.ts`, `src/lib/boards/queries.ts`, `src/app/app/boards/*`, `drizzle/init/03-boards.sql`. |
| **DB schema (новая таблица/колонка)** | `src/lib/db/schema/*`, `drizzle/init/*.sql`. Процедура — скил `of-db-change` (схема → регистрация → `workspace_id` → миррор init-SQL → `db:generate` → чек `_journal.json`). Rules: `drizzle.mdc`. |
| **Применение миграций / журнал Drizzle разъехался** | Скил `of-db-migrate`: диагностика `__drizzle_migrations`, baseline журнала, правило «одна база — один режим» (`db:push` ⊕ `db:migrate`). Грабля-первоисточник — `LEARNING_LOG.md` 2026-08-12. |
| **Auth (свой JWT, NextAuth НЕ установлен)** | `src/lib/auth/{index,actions,session,password,guards}.ts` (`jose` + `bcryptjs`, `authDriver='minimal'`), `src/app/(auth)/*`, `src/middleware.ts`. Tenant-гейт — `requireTenant()`/`requireTenantRoute()` + `docs/TENANT_SCOPING.md`. Rules: `security.mdc`. |
| **Биллинг (Т-Касса/CloudPayments)** | `src/lib/billing/*`, `docs/BILLING.md`. Rules: `security.mdc`. |
| **Безопасность / секреты / 152-ФЗ** | `docs/SECURITY.md` (**ОБЯЗАТЕЛЬНО** при работе с секретами/сетью/биллингом), `docs/SECURITY_AUDIT.md` (статусы находок I1-I7), `docs/SMARTCAPTCHA.md`. Rules: `security.mdc` auto-loads на соотв. файлы. |
| **Tenant-изоляция / cross-tenant ревью** | `docs/TENANT_SCOPING.md` (review-gate `requireTenant()`/`requireTenantRoute()` вместо Postgres RLS), `src/lib/auth/guards.ts`, проверка `pnpm check:tenant-isolation`. |
| **Аналитика / P&L / любая метрика прибыли** | `docs/METRICS_LAYER_DESIGN.md` — единый слой метрик (журнал проводок → дневные факты → формулы). Новые метрики считать только через него, своих формул в блоках и роутах не заводить. |
| **Сервер: доступ, бэкап, перенос на NVMe** | `docs/SERVER.md` (паспорт, SSH с новой машины), `docs/BACKUP_RESTORE.md` (бэкап/восстановление/NVMe), секреты — `SERVER.local.md` (вне git). |
| **Деплой на прод (Raspberry Pi 5)** | **Канон рутины — скил `of-deploy-pi`** (rsync → install → build → бэкап → migrate → restart → health-чек → откат). Справочник по железу, фазам первого деплоя и реестру граблей — `docs/DEPLOY_RPI5.md`. Сопутствующее: `deploy/xray/README.md` (VLESS), `docs/VPN_FOR_AI.md`. |
| **Готовность к публичному запуску** | Скил `of-launch-check` (технический гейт: tenant-изоляция, статусы `docs/SECURITY_AUDIT.md`, реквизиты в `src/lib/legal.ts`, фичефлаги, бэкапы, one-instance). Продуктовая часть запуска — `docs/ROADMAP_V2.md`. |
| **Tauri / desktop** | `docs/DESKTOP_STRATEGY.md` (выбор стека), `docs/DESKTOP_PLAN.md` (план работ), `docs/LICENSING.md`. |
| **Локальный AI / Ollama / VPN** | `docs/LOCAL_AI.md`, `docs/VPN_FOR_AI.md`. |
| **Иерархия AI-промптов** | `docs/AI_PROMPT_LAYERS.md`, `src/lib/ai/prompt-resolver.ts`. Rules: `ai-tools.mdc`. |
| **Планы ЛК v2 (воркспейсы, блоки, VLESS)** | `docs/LK_V2_PLAN.md` — канон по этапам. |
| **Стратегия продукта** | `PLAN.md` — **только нужный раздел через `Read offset+limit`**, не файл целиком (1427 строк). |
| **История релизов** | `git log --oneline -30` или `Read CHANGELOG.md offset=1 limit=100`. НЕ весь файл (~4K строк). |
| **Историческая память** | `docs/memory-archive/` — нарративы v0.10-v0.42 по версиям и темам; индекс — `docs/memory-archive/README.md`. Читать конкретный файл по запросу, не пачкой. |
| **Работа с библиотекой** (Next 15, Drizzle, shadcn, pgvector, Tauri 2) | Context7: `mcp0_resolve-library-id` → `mcp0_query-docs`, не более 3 вызовов. |
| **Верификация / smoke-тесты** | Скилы `.claude/skills/of-verify`, `of-run-tests`; все тесты параллельно — воркфлоу `of-test-sweep`. |
| **Ревью перед коммитом** | Сабагенты `of-code-reviewer`/`of-security-reviewer` или воркфлоу `of-review` (мультиагентный с верификацией находок). |
| **Конец сессии (CHANGELOG/MEMORY/handoff)** | **Канон:** `.claude/skills/of-end-session/SKILL.md`. |
| **Процедуры** | Скилы `of-new-block`, `of-db-change`, `of-db-migrate`, `of-new-ai-route`, `of-new-ai-tool`, `of-ozon-column`, `of-deploy-pi`, `of-launch-check`, `of-memory`. Полная карта — `.claude/README.md`. |

## Команды

```bash
pnpm install
pnpm docker:up                          # Postgres + Redis
pnpm db:push                            # применить schema (dev)
pnpm dev                                # Next.js
pnpm typecheck && pnpm build            # проверка
```

## После значимых изменений (обязательно)

**Канон — `.claude/skills/of-end-session/SKILL.md` (7 шагов). Не пересказывать его здесь — читать оттуда.**

Оглавление: верификация → `CHANGELOG.md` → `MEMORY.md` → **`LEARNING_LOG.md`** → инвариант-файлы + анти-дрейф чек → (опц.) agentmemory → git-команды пользователю (**самому не выполнять**).

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
