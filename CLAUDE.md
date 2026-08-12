# CLAUDE.md — Правила Open Finance

## TL;DR (читай в первую очередь)

**Open Finance** — AI-первая модульная финансовая платформа: SaaS (Next.js 15) + Local-First (Tauri 2).
Главный референс: Notion + Linear + Claude Code по UX, Copilot Money по AI.

### Bootstrap новой сессии (триггер пользователя — «загрузи контекст Open Finance»)

1. **`START.md`** — карта проекта, hard-rules, маршрутизация по типу задачи (~5K токенов).
2. **`MEMORY.md`** — handoff с текущим состоянием (**~30K токенов**, 450+ строк — файл большой, «компактным» больше не является).
3. **`git -C /Users/firay/open-finance/open-finance log --oneline -20`** — последние коммиты (~0.5K).

4. (Опц., вне обязательных трёх) **agentmemory MCP `memory_smart_search`** — точечно для исторических вопросов («когда/почему перешли с X на Y»). См. `docs/MEMORY_SETUP.md` (mempalace deprecated с v0.22.4).

Итого bootstrap (шаги 1-3) ≈ **36K токенов**. Цифры измерены (`js-tiktoken`, cl100k), не оценены на глаз — при заметном росте `MEMORY.md` перемерить и обновить здесь, в `START.md`, `AGENTS.md`, `.cursor/rules/project-context.mdc` и в шапке `MEMORY.md`.

После этих шагов работа любой сложности. Дальше — **только релевантное конкретной задаче**.

### Cursor 2026 — path-scoped rules

В Cursor IDE автоматически работают `.cursor/rules/*.mdc`. **Точные globs — во frontmatter самих файлов** (список ниже — ориентир, не источник правды):
- **`project-context.mdc`** (`alwaysApply: true`) — всегда загружен (компактный файл hard rules).
- **`blocks.mdc`** — `src/lib/blocks/**`, `src/components/blocks/**`.
- **`ai-tools.mdc`** — `src/lib/ai/**`, `src/app/api/ai/**`, `src/components/micro-agent/**`.
- **`marketplaces.mdc`** — `src/lib/marketplaces/**`, `src/app/api/marketplaces/**`, `src/components/marketplaces/**`, `src/components/unit-economics/ozon-*`, `src/app/app/settings/integrations/**`.
- **`drizzle.mdc`** — `src/lib/db/**`, `drizzle/**`.
- **`security.mdc`** — `src/lib/auth/**`, `src/lib/{inbox,marketplaces}/crypto.ts`, `src/middleware.ts`, `src/lib/billing/**`, `src/lib/env.ts`, `.env*`, `src/app/(auth)/**`, `src/app/api/{auth,billing}/**` (читать `docs/SECURITY.md`).
- **`unit-economics.mdc`** — `src/lib/unit-economics/**`, `src/components/unit-economics/**`, `src/app/api/unit-economics/**`, `src/app/app/unit-economics/**`, `src/lib/blocks/catalog/unit-*.tsx`.

**Инвариант globs:** внутренние страницы лежат в `src/app/app/**` (обычный сегмент). Route-группы `(app)` в репо НЕТ с v0.42.0 — glob вида `src/app/(app)/**` мёртв и правило молча не подцепится.

Это экономит ~10K токенов на каждую задачу (вместо загрузки полного `CLAUDE.md` правил, только релевантные подгружаются).

### Claude Code — агентная обвязка `.claude/` (с v0.41.0)

Полное описание — **`.claude/README.md`**. Принцип: **правила НЕ копируются** — доменные правила живут только в `.cursor/rules/*.mdc`, обвязка на них ссылается. Версии нигде не хардкодятся (источник — первый `## [X.Y.Z]` в `CHANGELOG.md`).

- **Скилы** (`.claude/skills/of-*`): `of-verify` (верификация), `of-end-session` (**канон** ритуала конца сессии — раздел ниже лишь резюме), `of-run-tests`, `of-new-block`, `of-db-change`, `of-new-ai-route`, `of-new-ai-tool`, `of-ozon-column`, `of-memory`.
- **Сабагенты** (`.claude/agents/`): `of-code-reviewer`, `of-security-reviewer` (read-only ревью) + доменные `of-{blocks,ai,ozon,db,unit-economics}-dev` — каждый первым шагом читает свой `.mdc`.
- **Воркфлоу** (`.claude/workflows/`): `of-test-sweep` (все smoke-тесты параллельно), `of-review` (мультиагентный ревью диффа с адверсариальной верификацией), `of-rules-audit` (аудит дрейфа правил — гонять на минорный релиз).
- **`.claude/settings.json`** — **активный** конфиг permissions+hooks (allow: read-only/verify команды; deny: git-мутации, миграции, `.env`). Агент его сам НЕ правит — изменения предлагает пользователю текстом. Хук `scripts/claude-rules-hint.sh` — аналог path-scoped правил Cursor.
- Глобальный скил `/ship` в этом репо ЗАПРЕЩЁН (он коммитит и пушит — нарушает жёсткие правила); вместо него `of-end-session`.

### НЕ загружать по умолчанию

- **`CHANGELOG.md`** (~4K строк) — только при вопросах про историю; иначе `git log`.
- **`PLAN.md`** (~1.4K строк) — только при стратегических вопросах; через `Read offset+limit`.
- **`docs/memory-archive/*`** — детальные нарративы по версиям v0.10-v0.22; по запросу.
- **agentmemory** — НЕ для bootstrap'а (только семантическая археология, точечным `memory_smart_search`).

### Если задача про библиотеку (Next 15, Drizzle, shadcn, pgvector, Tauri 2)

Context7: `mcp0_resolve-library-id` → `mcp0_query-docs`. Не более 3 вызовов.

### В конце каждой значимой сессии (ОБЯЗАТЕЛЬНО)

**Канон — скил `.claude/skills/of-end-session/SKILL.md`** (7 шагов, там же детали форматов и бампа версии). Здесь только оглавление шагов — при расхождении прав скил, пересказывать его не надо:

0. верификация зелёная → 1. `CHANGELOG.md` → 2. `MEMORY.md` (+ `wc -l`, бюджет 400-450 строк) → 3. `LEARNING_LOG.md` (новые грабли, append-only) → 4. инвариант-файлы (`START.md`, `.cursor/rules/*.mdc`, `CLAUDE.md`/`AGENTS.md`) + анти-дрейф чек → 5. (опц.) agentmemory `memory_save` → 6. git-команды пользователю (**самому не выполнять**).

Git-хуки по умолчанию НЕ установлены (ставятся вручную `./scripts/install-hooks.sh`) — на pre-commit secret-check не полагаться, `git diff` смотреть глазами.

Цель: следующая сессия за 30 секунд понимает состояние системы из `START.md` + `MEMORY.md`, без reverse-engineering.

---

## Стек

> **Единственный источник правды — `package.json`.** Ниже разделено на «есть сейчас» и «планируется»; при расхождении верить `package.json`, а не этой таблице. Конкретные версии здесь НЕ хардкодим.

### Есть сейчас (установлено и работает)

| Слой | Технология |
|------|-----------|
| Frontend + API | Next.js 15 App Router, TypeScript, RSC |
| UI | Tailwind CSS, shadcn/ui (Radix), lucide-react |
| Themes | next-themes + CSS-переменные (light по умолчанию) |
| State | Zustand + TanStack Query |
| **Auth** | **Свой JWT-cookie** (`src/lib/auth/*`: `jose` + `bcryptjs`, `authDriver = 'minimal'`). API намеренно совместим с NextAuth v5 (`auth`/`signIn`/`signOut`) — но самого NextAuth в зависимостях НЕТ |
| **ORM** | **Drizzle ORM** (НЕ Prisma — см. PLAN.md обоснование) |
| DB | **PostgreSQL 16 + pgvector** (`pgvector/pgvector:pg16`), клиенты `pg` + `postgres` |
| Tenant-изоляция | Review-gate `requireTenant()`/`requireTenantRoute()` (`docs/TENANT_SCOPING.md`). Postgres RLS сознательно НЕ используется (аудит I1) |
| **AI Provider** | Своя обёртка `src/lib/ai/providers/`: Ollama, OpenAI-compat (в т.ч. Claude через VPN), YandexGPT, GigaChat, mock. Прокси — `undici` ProxyAgent |
| **AI Orchestrator** | Своя реализация (НЕ Vercel AI SDK). Tools Layer — каркас, зарегистрирован 1 tool (Этап 4 PLAN.md) |
| AI Vision | `src/lib/ai/vision/providers/`: claude, openai, yandex, mock |
| Токенизация | `js-tiktoken` (`src/lib/ai/tokenizer.ts`) |
| Charts | Recharts |
| Grid / Drag-n-drop | react-grid-layout + dnd-kit |
| Mindmap | `@xyflow/react` (ReactFlow v12) |
| Markdown-редактор | `@mdxeditor/editor` |
| Spreadsheet | Своя реализация на `fast-formula-parser` + `xlsx` (SheetJS) |
| Email IMAP (in) | Свой IMAP-клиент поверх `net`/`tls` (`src/lib/inbox/imap.ts`) + `mailparser` |
| Email SMTP (out) | `nodemailer` |
| CSV | `papaparse`; санитизация HTML — `dompurify` |
| Billing | `src/lib/billing/mock.ts` (mock-гейт планов) |
| Package manager | pnpm 9.12.3, Node ≥20 |

### Shim / контейнер есть, приложение не использует

| Слой | Фактическое состояние |
|------|----------------------|
| Cache/Queue | `src/lib/redis.ts` — **in-memory shim** (`RedisLike`); `ioredis`/`bullmq` НЕ установлены. Контейнер `redis:7-alpine` в `docker-compose.yml` поднимается, но приложение к нему не ходит. `src/lib/rate-limit.ts` — тоже in-memory |
| Storage | Контейнер `minio/minio` в compose есть, **S3-SDK в зависимостях нет** — код в S3 не пишет |
| OCR | `src/lib/ai/vision/providers/tesseract.ts` грузит `tesseract.js` динамическим `import()` как **опциональную** зависимость; она НЕ установлена → провайдер отдаёт понятную ошибку |

### Планируется (в зависимостях ОТСУТСТВУЕТ — не описывать как существующее)

| Слой | План |
|------|------|
| OAuth | Google OAuth к своему auth (сейчас только credentials) |
| Queue | BullMQ + настоящий ioredis (Phase 2, горизонтальный масштаб) |
| DB Local | SQLite + sqlite-vec (для Tauri-версии) |
| Embeddings | OpenAI text-embedding-3-small (1536) / Ollama nomic-embed — колонка `vector(1536)` в схеме заведена, пайплайн не подключён |
| Speech | Whisper (whisper.cpp local / cloud OpenAI) |
| Telegram | grammY (Bot) + GramJS (MTProto, Phase 2) |
| Billing (real) | Т-Касса (основной) + CloudPayments (резерв) |
| Desktop | Tauri 2.0 (Phase 2) |
| Mobile | React Native + Expo (Phase 3) |
| Monitoring | Sentry + Prometheus + Grafana (в `src/lib/env.ts` только плейсхолдер `SENTRY_DSN`) |

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
- **Защита — review-gate на уровне приложения, НЕ Postgres RLS.** `enableRLS()` в коде отсутствует и добавлять его не надо: по аудиту I1 (`docs/SECURITY_AUDIT.md`) сознательно выбран гейт `requireTenant()` / `requireTenantRoute()` (`src/lib/auth/guards.ts`). Правила и канонический паттерн — **`docs/TENANT_SCOPING.md`**; проверка — `pnpm check:tenant-isolation`.
- `tenantId` берётся ТОЛЬКО из сессии — никогда из body/query/headers.
- Пользовательские раскладки и вкладки скоупятся дополнительно по `workspace_id` (uniq `(workspace_id, page_key)`), см. `.cursor/rules/drizzle.mdc`.
- НИКОГДА не делать запросы без `tenant_id` фильтра.

---

## Жёсткие ограничения

> **Канон набора — `.cursor/rules/project-context.mdc` (`alwaysApply`).** Список ниже обязан ему соответствовать один-в-один; те же 14 пунктов продублированы в `START.md`, `AGENTS.md`, `MEMORY.md` (эти файлы автозагружаются разными агентами, поэтому копии осознанные). **Меняешь одно правило — правишь все пять файлов в одном коммите.**

1. **Git**: НИКОГДА не делать `git add/commit/push` — только давать команды пользователю.
2. **БД**: НИКОГДА не запускать миграции автоматически (`db:push`/`db:migrate`) — только давать команды.
3. **Секреты**: НИКОГДА не коммитить `.env`, ключи, пароли, токены — см. `docs/SECURITY.md`.
4. **Пакетный менеджер**: только `pnpm` — НЕ `npm`/`yarn`.
5. **ORM**: только Drizzle — НЕ Prisma.
6. **AI**: только своя обёртка `src/lib/ai/providers/` — НЕ Vercel AI SDK.
7. **Multi-tenant**: `tenant_id` в каждой таблице и каждом DB-запросе; `tenantId` берётся ТОЛЬКО из сессии (`requireTenant()`/`requireTenantRoute()`, `docs/TENANT_SCOPING.md`).
8. **AI-мутации**: только через Tools Layer (`src/lib/ai/tools/`) — НЕ прямой SQL из AI.
9. **Структура**: без глубокой вложенности `src/features/x/y/z` (домены — `src/lib/<домен>/` + `src/components/<домен>/` + `src/app/api/<домен>/`).
10. **Импорты**: явные — НЕ `import * as X`.
11. **UI alerts**: только Dialog/AlertDialog — НЕ системные `alert/confirm/prompt`.
12. **Новые файлы**: начинать с `// PURPOSE: ...`.
13. **Интерактивные команды**: использовать `-y`, `--yes`, `--force` где возможно.
14. **Удаление данных**: ВСЕГДА с подтверждением пользователя, в запросе обязательна проверка `tenant_id`.

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
import { z } from 'zod';
import type { Tool } from '@/lib/ai/types';

export const createTransactionTool: Tool = {
  name: 'create_transaction',
  description: 'Создать запись о транзакции',
  parameters: z.object({ /* ... */ }), // сырая Zod-схема, НЕ zodToJsonSchema
  handler: async (args, ctx) => {
    // ctx содержит tenantId, userId, requestId — фильтрация по tenant вручную
    return await db.insert(transactions).values({ ...args, tenantId: ctx.tenantId });
  },
};
```

- `parameters` — **сырая Zod-схема** (тип `Tool` в `src/lib/ai/types.ts`: `parameters: TParams extends z.ZodTypeAny`). Пакета `zod-to-json-schema` в проекте НЕТ — не добавлять его и не вызывать `zodToJsonSchema()`.
- Безопасность обеспечивает **не БД**: Postgres RLS не используется, tenant-фильтр проставляется руками из `ctx.tenantId` (см. `docs/TENANT_SCOPING.md`).
- **Все tools** регистрируются в `src/lib/ai/tools/index.ts` и доступны Orchestrator-у (сейчас там каркас — зарегистрирован 1 tool, Этап 4 `PLAN.md`).
- Канон и живой пример — `.cursor/rules/ai-tools.mdc` + `src/lib/ai/tools/query-inbox-messages.ts`.

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
Актуальный перечень — `ls docs/`; ниже назначение каждого файла (держать полным).

**Активные планы**
- `docs/LK_V2_PLAN.md` — **канон** по воркспейсам («кабинетам»), переработке блоков и VLESS-VPN.
- `docs/DEPLOY_RPI5.md` — деплой на Raspberry Pi 5 (прод-минисервер); **рутина обновления — §10**.
- `docs/DESKTOP_PLAN.md` — план local-first десктопа (оркестрация для AI-агента); стратегия выбора стека — `docs/DESKTOP_STRATEGY.md`.

**Безопасность**
- `docs/SECURITY.md` — **ОБЯЗАТЕЛЬНО** при работе с секретами/сетью/биллингом.
- `docs/SECURITY_AUDIT.md` — аудит перед запуском, статусы находок I1-I7.
- `docs/TENANT_SCOPING.md` — review-gate `requireTenant()`/`requireTenantRoute()` (вместо Postgres RLS).
- `docs/SMARTCAPTCHA.md` — Yandex SmartCaptcha (I6).

**AI**
- `docs/AI_TOOLS.md` — реестр всех AI-инструментов.
- `docs/AI_PROMPT_LAYERS.md` — иерархия промптов (global → section → block).
- `docs/AI_VISION.md` — vision providers.
- `docs/LOCAL_AI.md`, `docs/VPN_FOR_AI.md` — локальный AI и VPN для внешних провайдеров.
- `docs/AI_ENVIRONMENT_BLUEPRINT.md` — как переносить эту схему «памяти и правил» в другой проект.

**Блоки и домены**
- `docs/CASHFLOW_BLOCKS.md`, `docs/KPI_GRID.md`, `docs/CUSTOM_DATA_BLOCK.md`, `docs/UNIT_ECONOMICS_TABS.md` — блочные системы.
- `docs/PAGE_PERIODS.md` — единая система периодов (читать при добавлении блока с периодом).
- `docs/MARKETPLACES_OZON_PERFORMANCE.md`, `docs/MARKETPLACES_FUTURE_PLAN.md`, `docs/OZON_ADS_GAP.md` — Ozon.
- `docs/EMAIL_BEGET.md` — IMAP-настройки для inbox.
- `docs/MODULES.md` — исторический документ (описывает `src/modules/` + tRPC, которых в проекте нет); реальный реестр — `src/lib/modules/registry.ts`.

**Прочее**
- `docs/ARCHITECTURE.md` — карта целевой архитектуры (часть блоков — план, сверять с `package.json`).
- `docs/BILLING.md` — реализация биллинга; `docs/LICENSING.md` — лицензирование Tauri-версии.
- `docs/PERSONAL_USE.md` — личный self-hosted инстанс.
- `docs/ONBOARDING.md` — спецификация onboarding-визарда.

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
