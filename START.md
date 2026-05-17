# START.md — bootstrap-контекст Open Finance

> Единственный файл, который AI-агент должен прочитать первым в новой сессии.
> Триггер пользователя: **«загрузи контекст Open Finance»** или **«прогрев of»**.
> Вся остальная документация подгружается **по запросу задачи**, не по умолчанию.

## Что делать в новой сессии (3 шага, ~6–8K токенов)

1. Прочитать этот `START.md`.
2. Прочитать `MEMORY.md` — актуальный handoff (~5K токенов).
3. Запустить `git -C /Users/firay/open-finance/open-finance log --oneline -20`.

После этих шагов **можно начинать работу любой сложности**. Дальше подгружается только то, что нужно для конкретной задачи (см. таблицу ниже).

## Идентичность

**Open Finance** — AI-первая модульная финансовая платформа для предпринимателей РФ (селлеры OZON/WB/ЯМ, ИП, фрилансеры, малый бизнес). Сейчас — Next.js 15 SaaS. Phase 2 — Tauri 2.0 desktop. Phase 3 — React Native mobile.

Главная архитектурная идея: **почти каждая страница = настраиваемый BlockGrid**. Новая фича обычно = новый block type в `src/lib/blocks/catalog/`, а не статичная страница.

Источник правды по статусу — `MEMORY.md` и `CHANGELOG.md`. `package.json` версия отстаёт.

## Жёсткие правила (MUST NOT)

- НЕ делать `git add/commit/push` — давать команды пользователю.
- НЕ запускать DB-миграции — давать команды пользователю.
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
│   ├── (app)/            authenticated shell
│   ├── (auth)/           login/register/forgot
│   └── api/              auth, blocks, cashflow, inbox, ai, boards
├── components/blocks/    BlockGrid shell, chrome, dialogs, relation overlay
├── components/micro-agent/  AI dialog
├── components/ui/        shadcn primitives
├── lib/ai/               providers, micro-agent, tools, memory stubs
├── lib/blocks/           types, registry, catalog, values, relations
├── lib/boards/           Boards CRUD
├── lib/db/               Drizzle client + schema
├── lib/inbox/            IMAP, MIME, crypto, queries
├── lib/env.ts            typed env
└── modules/              business modules (cashflow, inbox, communications)
```

## Маршрутизация: какую задачу — какие файлы читать

| Тип задачи | Что читать (только это, не всё подряд) |
|---|---|
| Новый/правка блока, BlockGrid поведение | `src/lib/blocks/types.ts`, `src/lib/blocks/registry.ts`, `src/components/blocks/block-grid.tsx`, нужный файл из `src/lib/blocks/catalog/` |
| AI-чат, streaming, micro-agent | `src/app/api/ai/chat/route.ts`, `src/components/micro-agent/micro-agent-dialog.tsx`, `src/lib/ai/providers/{ollama,openai-compat,proxy}.ts` |
| Новый AI tool | `src/lib/ai/tools/index.ts` + пример `src/lib/ai/tools/query-inbox-messages.ts`, потом `docs/AI_TOOLS.md` |
| Inbox / IMAP / Telegram | `src/lib/inbox/{imap,mime,crypto,queries}.ts`, `src/lib/blocks/catalog/inbox-channel-feed.tsx`, `docs/EMAIL_BEGET.md` |
| Курсы валют / `currency.rates` блок | `src/lib/currency/{types,queries,sources/cbr}.ts`, `src/lib/blocks/catalog/currency-rates.tsx`, `src/app/api/currency/rates/{route,refresh/route}.ts`, `drizzle/init/06-currency.sql` |
| Интеграции маркетплейсов (Ozon Seller API) | `src/lib/marketplaces/{types,crypto,queries,use-accounts}.ts`, `src/lib/marketplaces/ozon/{client,endpoints,types,upsert}.ts` + `sync/*.ts`, `src/app/api/marketplaces/accounts/**`, `src/app/(app)/settings/integrations/{page,integrations-client}.tsx`, `src/components/integrations/ozon-key-help.tsx`, `src/components/unit-economics/{ozon-sync-button,ozon-product-picker-dialog,ozon-sync-settings-dialog,ozon-sync-preview-dialog,ozon-sync-diff}.tsx`, `drizzle/init/07-marketplaces.sql`. При работе с самим API — смотреть `OZON_API_VERSION_MAP` в `endpoints.ts` (единая точка версионирования). **`OzonClient.post()` lenient по умолчанию** (warning + raw на Zod fail) — `{ strict: true }` для критичных. Sync-блок: `config.sync = { accountId, conflictPolicy, matchBy, columnMap }`. Diff собирается `buildSyncDiff()` (pure-function, 25 тестов в `scripts/test-ozon-sync-diff.ts`) и показывается в `OzonSyncPreviewDialog` |
| Roadmap для marketplace-интеграций (что делать после v0.17.0, как мониторить изменения API, план аналитических блоков) | `docs/MARKETPLACES_FUTURE_PLAN.md` |
| Boards | `src/lib/db/schema/boards.ts`, `src/lib/boards/queries.ts`, `src/app/(app)/boards/*`, `drizzle/init/03-boards.sql` |
| Cashflow / транзакции | `src/lib/cashflow/*`, `src/modules/cashflow/*`, `src/app/api/cashflow/*` |
| DB schema / миграции | `src/lib/db/schema/*`, `drizzle/init/*.sql`. После изменений: дать пользователю команды `pnpm db:generate && pnpm db:push`. |
| Auth / NextAuth v5 | `src/lib/auth/*`, `src/app/(auth)/*`, `src/middleware.ts` |
| Биллинг (Т-Касса/CloudPayments) | `src/lib/billing/*`, `docs/BILLING.md` |
| Безопасность / секреты / 152-ФЗ | `docs/SECURITY.md` (ОБЯЗАТЕЛЬНО при любой работе с секретами/сетью/биллингом) |
| Tauri / десктоп стратегия | `docs/DESKTOP_STRATEGY.md`, `docs/LICENSING.md` |
| Локальный AI / Ollama / VPN | `docs/LOCAL_AI.md`, `docs/VPN_FOR_AI.md` |
| Стратегия продукта, roadmap, обоснования | `PLAN.md` — читать **offset+limit** на нужный раздел, не файл целиком (1420 строк) |
| История релизов | `git log --oneline -30` или `Read CHANGELOG.md offset=1 limit=80` (не весь файл — там 1199 строк) |
| Работа с библиотекой (Next 15, Drizzle, shadcn, pgvector, Tauri 2) | Context7: `mcp0_resolve-library-id` → `mcp0_query-docs`, не более 3 вызовов |

## Команды

```bash
# dev
pnpm install
pnpm docker:up                          # Postgres + Redis
pnpm db:push                            # применить schema (dev)
pnpm dev                                # Next.js
# проверка
pnpm typecheck
pnpm build
# AI/память (опционально, не на старте — индекс содержит и устаревшие версии)
mempalace search "конкретный вопрос" --wing open-finance
mempalace status
```

## После значимых изменений (обязательно)

1. `pnpm build` — должен пройти.
2. Обновить `MEMORY.md` (если изменились ключевые файлы/инварианты/грабли).
3. Добавить запись в `CHANGELOG.md`.
4. Дать пользователю git-команды (`git add -A && git commit -m "..." && git push origin main`) — **не выполнять самому**.
5. Если обновлялся `MEMORY.md` — синхронизировать `~/.mempalace/sources/open-finance/current-context-v*.md` (внешний AI-handoff).

## MemPalace — статус и правила

- Палац **починен** (5288 drawers, 696 в open-finance), CLI работает.
- В индексе **есть устаревшие версии** проекта (Tauri-only, Prisma, Python sidecar) — `mempalace wake-up --wing open-finance` поэтому **не используется как стартовый контекст**.
- `mempalace search` использовать **точечно** для исторических вопросов («когда мы перешли с X на Y», «почему отказались от Z»), а не для текущего состояния.
- Текущее состояние = `MEMORY.md` + `git log` + (по теме) конкретные файлы.

## Ключевые грабли (не повторять)

- `sanitizeBlocks` на сервере выкидывает блоки — client-only catalog пуст в server bundle.
- Sheet sources обязаны включать computed formulas + linked cells, не только raw saved cells.
- Money formatting (копейки) только при явном `format: money` / `moneyRefs` — иначе обычные числа делятся на 100.
- Ollama fallback не должен выбирать embedding-only модели.
- `useSearchParams` в Next 15 требует `<Suspense>`.
- `bcryptjs` нельзя импортировать в edge/middleware.
- Resize handle делается CSS hover на `.react-grid-item`, не JS marker.
