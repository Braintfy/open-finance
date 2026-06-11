# CLAUDE.md — Правила Open Finance

## TL;DR (читай в первую очередь)

**Open Finance** — AI-первая модульная финансовая платформа: SaaS (Next.js 15) + Local-First (Tauri 2).
Главный референс: Notion + Linear + Claude Code по UX, Copilot Money по AI.

### Bootstrap новой сессии (триггер пользователя — «загрузи контекст Open Finance»)

1. **`START.md`** — карта проекта, hard-rules, маршрутизация по типу задачи (~3K токенов).
2. **`MEMORY.md`** — компактный handoff с текущим состоянием (~5K токенов).
3. **`git -C /Users/firay/open-finance/open-finance log --oneline -20`** — последние коммиты (~0.5K).
4. (Опц.) **agentmemory MCP `memory_smart_search`** — точечно для исторических вопросов («когда/почему перешли с X на Y»). См. `docs/MEMORY_SETUP.md` (mempalace deprecated с v0.22.4).

После этих шагов работа любой сложности. Дальше — **только релевантное конкретной задаче**.

### Cursor 2026 — path-scoped rules

В Cursor IDE автоматически работают `.cursor/rules/*.mdc`:
- **`project-context.mdc`** (`alwaysApply: true`) — всегда загружен (компактный файл hard rules).
- **`blocks.mdc`** — auto-attach при работе с `src/lib/blocks/**`, `src/components/blocks/**`.
- **`ai-tools.mdc`** — auto-attach при работе с `src/lib/ai/**`, `src/app/api/ai/**`.
- **`marketplaces.mdc`** — auto-attach при работе с `src/lib/marketplaces/**`.
- **`drizzle.mdc`** — auto-attach при работе с `src/lib/db/**`, `drizzle/**`.
- **`security.mdc`** — auto-attach при работе с auth/crypto/billing/env (читать `docs/SECURITY.md`).
- **`unit-economics.mdc`** — auto-attach при работе с `src/lib/unit-economics/**`.

Это экономит ~10K токенов на каждую задачу (вместо загрузки полного `CLAUDE.md` правил, только релевантные подгружаются).

### Claude Code — агентная обвязка `.claude/` (с v0.41.0)

Полное описание — **`.claude/README.md`**. Принцип: **правила НЕ копируются** — доменные правила живут только в `.cursor/rules/*.mdc`, обвязка на них ссылается. Версии нигде не хардкодятся (источник — первый `## [X.Y.Z]` в `CHANGELOG.md`).

- **Скилы** (`.claude/skills/of-*`): `of-verify` (верификация), `of-end-session` (**канон** ритуала конца сессии — раздел ниже лишь резюме), `of-run-tests`, `of-new-block`, `of-db-change`, `of-new-ai-route`, `of-new-ai-tool`, `of-ozon-column`, `of-memory`.
- **Сабагенты** (`.claude/agents/`): `of-code-reviewer`, `of-security-reviewer` (read-only ревью) + доменные `of-{blocks,ai,ozon,db,unit-economics}-dev` — каждый первым шагом читает свой `.mdc`.
- **Воркфлоу** (`.claude/workflows/`): `of-test-sweep` (все smoke-тесты параллельно), `of-review` (мультиагентный ревью диффа с адверсариальной верификацией), `of-rules-audit` (аудит дрейфа правил — гонять на минорный релиз).
- **`.claude/settings.proposed.json`** — предложение permissions+hooks; активирует пользователь (`mv` в `settings.json`). Хук `scripts/claude-rules-hint.sh` — аналог path-scoped правил Cursor.
- Глобальный скил `/ship` в этом репо ЗАПРЕЩЁН (он коммитит и пушит — нарушает жёсткие правила); вместо него `of-end-session`.

### НЕ загружать по умолчанию

- **`CHANGELOG.md`** (~4K строк) — только при вопросах про историю; иначе `git log`.
- **`PLAN.md`** (~1.4K строк) — только при стратегических вопросах; через `Read offset+limit`.
- **`docs/memory-archive/*`** — детальные нарративы по версиям v0.10-v0.22; по запросу.
- **agentmemory** — НЕ для bootstrap'а (только семантическая археология, точечным `memory_smart_search`).

### Если задача про библиотеку (Next 15, Drizzle, shadcn, pgvector, Tauri 2)

Context7: `mcp0_resolve-library-id` → `mcp0_query-docs`. Не более 3 вызовов.

### В конце каждой значимой сессии (ОБЯЗАТЕЛЬНО)

Канон — скил **`.claude/skills/of-end-session/SKILL.md`** (там детали форматов и бампа версии). Резюме:

1. Обновить **`MEMORY.md`** при изменении ключевых файлов/инвариантов/граблей.
2. Обновить **`CHANGELOG.md`** с детальным описанием изменений.
3. При изменении bootstrap или ключевых инвариантов — обновить **`START.md`** и/или `.cursor/rules/*.mdc`.
4. Новые грабли → **`LEARNING_LOG.md`** (append-only). Раз в неделю агрегируются в `MEMORY.md`.
5. (Опц.) Ключевые решения сессии → agentmemory MCP **`memory_save`** (замена deprecated `./scripts/sync-mempalace.sh`; git-хуки по умолчанию НЕ установлены — ставятся вручную `./scripts/install-hooks.sh`).

Цель: следующая сессия за 30 секунд понимает состояние системы из `START.md` + `MEMORY.md`, без reverse-engineering.

---

## Стек (актуальная версия)

| Слой | Технология |
|------|-----------|
| Frontend + API | Next.js 15 App Router, TypeScript, RSC |
| UI | Tailwind CSS, shadcn/ui (Radix), Lucide |
| Themes | next-themes + CSS-переменные (light по умолчанию) |
| State | Zustand + TanStack Query |
| Auth | NextAuth.js v5 (credentials + Google OAuth) |
| **ORM** | **Drizzle ORM** (НЕ Prisma — см. PLAN.md обоснование) |
| DB SaaS | **PostgreSQL 16 + pgvector** (RAG-память) |
| DB Local | SQLite + sqlite-vec (для Tauri-версии) |
| Cache/Queue | Redis 7 + BullMQ |
| Storage | S3-compatible (MinIO dev / AWS S3 prod) |
| **AI Provider** | Claude (через VPN) / OpenAI / Yandex GPT / Ollama |
| **AI Orchestrator** | Своя обёртка (не Vercel AI SDK) |
| Embeddings | OpenAI text-embedding-3-small (1536) или Ollama nomic-embed |
| OCR | Tesseract (local) / Google Vision (cloud) |
| Speech | Whisper (local через whisper.cpp / cloud OpenAI) |
| Charts | Recharts |
| Drag-n-drop | dnd-kit |
| Mindmap | ReactFlow |
| Editor | TipTap (block-based) |
| Spreadsheet | univer / handsontable / своя реализация |
| Email/IMAP | node-imap + mailparser |
| Telegram | grammY (Bot) + GramJS (MTProto, Phase 2) |
| Billing | Т-Касса (основной) + CloudPayments (резерв) |
| Desktop | Tauri 2.0 (Phase 2) |
| Mobile | React Native + Expo (Phase 3) |
| Monitoring | Sentry + Prometheus + Grafana |
| Package manager | pnpm 9.12.3, Node ≥20 |

---

## Архитектурные принципы

### AI-first (главное)
- AI — первоклассный гражданин, не дополнение.
- Все мутации через **typed Tools Layer** (не прямой SQL).
- Семантическая память через **RAG** (pgvector + hybrid search).
- **Audit log** всех AI-действий с возможностью отката.
- Без AI приложение работает как обычная финансовая программа.

### Простая структура для AI
- Плоская: `src/modules/{name}/`, не `src/features/x/y/z/...`.
- Явные импорты, без `import * as X`.
- Comment-headers в каждом новом файле: `// PURPOSE: ...`.
- README в каждой крупной папке (что тут, как добавить).
- НЕТ магии — никаких декораторов / DI-контейнеров.

### Multi-tenant
- `tenant_id` в каждой таблице.
- Postgres RLS через `enableRLS()` в Drizzle.
- Tenant context в middleware.
- НИКОГДА не делать запросы без `tenant_id` фильтра.

---

## Жёсткие ограничения

- **Git**: НИКОГДА не делать `git add/commit/push` — только давать команды пользователю.
- **БД**: НИКОГДА не запускать миграции автоматически — только давать команды.
- **Секреты**: НИКОГДА не коммитить `.env`, ключи, пароли — см. `docs/SECURITY.md`.
- **Интерактивные команды**: использовать `-y`, `--yes`, `--force` где возможно.
- **Удаление данных**: ВСЕГДА с подтверждением, для tenant_id обязательна проверка.
- **UI alerts**: только Dialog/AlertDialog — НЕ системные `alert/confirm/prompt`.

---

## Процесс работы (для каждой задачи)

1. **Анализ** — понять конечную цель, явные и неявные требования.
2. **Roadmap** — `TodoWrite` с атомарными шагами (если ≥3 шагов).
3. **Чтение** — прочитать файлы которые планируется менять.
4. **Поиск контекста** — `Grep`/`Glob` или `mcp0_query-docs` (Context7).
5. **Выполнение** — точечные правки через `Edit` / `Write` (в Cursor — search_replace).
6. **Верификация** — `pnpm typecheck` или `pnpm build`.
7. **Документация** — обновить `MEMORY.md` (если ключевое) и `CHANGELOG.md`.
8. **Команды** — дать пользователю git-команды для коммита.

---

## CHANGELOG формат

```markdown
## [X.Y.Z] - YYYY-MM-DD
### Added / Changed / Fixed / Removed
- **Компонент** — короткое описание (1-2 строки)
```

Версии:
- **MAJOR** — рабочий проект (не меняется в MVP).
- **MINOR** — крупные фичи (новый модуль, новая интеграция).
- **PATCH** — фиксы и мелкие улучшения.

---

## Tools Layer (важно!)

AI **никогда** не пишет SQL и не дёргает Drizzle напрямую. Только через инструменты:

```typescript
// src/lib/ai/tools/{name}.ts
export const createTransactionTool = {
 name: 'create_transaction',
 description: 'Создать запись о транзакции',
 parameters: zodToJsonSchema(z.object({ ... })),
 handler: async (args, ctx) => {
 // ctx содержит tenantId, userId, requestId
 // RLS обеспечит безопасность
 return await db.insert(transactions).values({ ...args, tenantId: ctx.tenantId });
 },
};
```

**Все tools** регистрируются в `src/lib/ai/tools/index.ts` и доступны Orchestrator-у.

---

## Документация (читать по запросу задачи, не на старте)

- **`START.md`** — bootstrap новой сессии, карта проекта, роутинг по задачам.
- **`MEMORY.md`** — компактный handoff с текущим состоянием.
- **`AGENTS.md`** — для не-Claude AI агентов (Cline, Aider, Continue, Windsurf).
- **`.cursor/rules/*.mdc`** — Cursor 2026 path-scoped правила (единый источник доменных правил).
- **`.claude/README.md`** — агентная обвязка Claude Code (скилы, сабагенты, воркфлоу).
- **`LEARNING_LOG.md`** — append-only AI learnings (новые грабли).
- **`docs/MEMORY_SETUP.md`** — agentmemory (AI-память, MCP).
- **`docs/MEMPALACE_RUNBOOK.md`** — legacy mempalace (deprecated).
- `docs/MODULES.md` — как добавить модуль.
- `docs/AI_TOOLS.md` — реестр всех AI-инструментов.
- `docs/AI_VISION.md` — vision providers.
- `docs/BILLING.md` — реализация биллинга.
- `docs/LICENSING.md` — лицензирование Tauri-версии.
- `docs/SECURITY.md` — **ОБЯЗАТЕЛЬНО** при работе с секретами/сетью/биллингом.
- `docs/ARCHITECTURE.md` — карта архитектуры.
- `docs/CASHFLOW_BLOCKS.md`, `docs/KPI_GRID.md`, `docs/CUSTOM_DATA_BLOCK.md`, `docs/UNIT_ECONOMICS_TABS.md` — блочные системы.
- `docs/MARKETPLACES_OZON_PERFORMANCE.md`, `docs/MARKETPLACES_FUTURE_PLAN.md`, `docs/OZON_ADS_GAP.md` — Ozon.
- `docs/EMAIL_BEGET.md` — IMAP-настройки для inbox.
- `docs/LOCAL_AI.md`, `docs/VPN_FOR_AI.md` — локальный AI.
- `docs/DESKTOP_STRATEGY.md`, `docs/ONBOARDING.md` — продуктовое.

---

## Подсказка по командам

```bash
# Установка
pnpm install
pnpm docker:up                 # PostgreSQL + Redis в Docker

# БД
pnpm db:generate               # сгенерировать миграции из schema
pnpm db:push                   # применить schema напрямую (dev)
pnpm db:migrate                # применить миграции (prod-style)
pnpm db:studio                 # GUI для просмотра БД

# Dev
pnpm dev                       # Next.js dev server

# Качество
pnpm typecheck                 # TypeScript проверка
pnpm lint                      # ESLint
pnpm format                    # Prettier
pnpm build                     # production build
```

---

## Когда обращаться к Context7

ВСЕГДА при работе с:
- Next.js 15 (App Router особенности)
- Drizzle ORM (быстро меняется)
- Tauri 2.0 (отличается от v1)
- pgvector (HNSW, hybrid search)
- shadcn/ui компонентами
- Любой новой библиотекой

Алгоритм:
1. `mcp0_resolve-library-id` — найти точный ID.
2. `mcp0_query-docs` — конкретный вопрос.
3. Не больше 3 вызовов на задачу.

---

## AI-память — agentmemory (mempalace deprecated с v0.22.4)

**Назначение:** археология проекта для исторических вопросов («когда мы перешли с X на Y», «почему отказались от Z»). НЕ источник правды для текущего состояния — это `MEMORY.md` + `git log`.

- **Сервер:** localhost:3111 (viewer :3113), launchd-агент `com.agentmemory.server`. Health: `curl http://localhost:3111/agentmemory/health`.
- **Использование:** MCP tools `memory_smart_search` (поиск), `memory_save` (запись решений), `memory_recall`, `memory_sessions`. Если сервер лежит — MCP shim даёт 7 fallback-tools, работа продолжается.
- **Маршрутизация «куда писать / где искать»** — скил `.claude/skills/of-memory/SKILL.md`.
- **Полная инструкция/починка:** `docs/MEMORY_SETUP.md`. Старый mempalace: история и runbook — `docs/MEMPALACE_RUNBOOK.md` (chromadb Issue #832; `./scripts/sync-mempalace.sh` больше не входит в ритуал).
