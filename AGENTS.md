# AGENTS.md — универсальные правила для AI-агентов

> Этот файл для **любого AI-агента** (Cline, Aider, Continue, Codeium, Windsurf, Claude Code).
> Процесс работы — в `CLAUDE.md`; доменные правила — в `.cursor/rules/*.mdc` (единый источник);
> процедуры — в `.claude/skills/*/SKILL.md`. Здесь — самое важное в сжатом виде.

## Project Identity

- **Name:** Open Finance
- **Type:** AI-первая модульная финансовая платформа (SaaS + Tauri Desktop)
- **Audience:** Селлеры маркетплейсов, ИП, фрилансеры, малый бизнес РФ
- **Status:** версия = первый заголовок `## [X.Y.Z]` в `CHANGELOG.md` (НЕ хардкодить; `package.json` 0.5.0 устарел)

## Tech Stack

Источник правды — `package.json`. Полная разбивка «есть / shim / план» — `CLAUDE.md` раздел «Стек».

**Есть сейчас:**
- **Frontend:** Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui
- **DB:** PostgreSQL 16 + pgvector + Drizzle ORM (клиенты `pg` / `postgres`)
- **Auth:** свой JWT-cookie (`jose` + `bcryptjs`, `authDriver='minimal'`) — **NextAuth НЕ установлен**, API лишь совместим по именам; Google OAuth нет
- **AI:** своя обёртка `src/lib/ai/providers/` (Ollama, OpenAI-compat, YandexGPT, GigaChat), не Vercel AI SDK
- **Прочее:** Recharts, react-grid-layout + dnd-kit, `@xyflow/react`, `@mdxeditor/editor`, `fast-formula-parser` + `xlsx`, свой IMAP поверх `net`/`tls` + `mailparser`, `nodemailer`

**Нет, хотя часто предполагают:** Redis/BullMQ (`src/lib/redis.ts` — in-memory shim, контейнер `redis:7` в compose не используется приложением), S3-SDK, TipTap, `node-imap`, grammY, Sentry/Prometheus/Grafana, univer/handsontable, tesseract.js, Whisper.

**План:** Tauri 2.0 (Phase 2), React Native + Expo (Phase 3), реальный биллинг Т-Касса/CloudPayments.

## Bootstrap новой сессии (триггер — «загрузи контекст Open Finance»)

1. `START.md` — карта проекта, маршрутизация по типу задачи (~5K токенов).
2. `MEMORY.md` — текущее состояние, ключевые файлы, грабли (**~30K токенов**, 450+ строк — не «компактный» файл).
3. `git -C /Users/firay/open-finance/open-finance log --oneline -20` — свежие коммиты (~0.5K).

Итого ≈ **36K токенов**.

Дальше — только релевантное конкретной задаче. **НЕ грузить** `CHANGELOG.md` (~4K строк) и `PLAN.md` (~1.4K строк) целиком по умолчанию.

Историческая память — agentmemory MCP (localhost:3111, `memory_smart_search`) — **только** для вопросов «когда/почему перешли с X на Y», НЕ для bootstrap'а. См. `docs/MEMORY_SETUP.md` (mempalace deprecated с v0.22.4).

**Канонические процедуры** (новый блок, изменение БД, AI-route, верификация, конец сессии) — `.claude/skills/*/SKILL.md`. Это обычный markdown — читаем любым агентом, не только Claude Code. Доменные правила — `.cursor/rules/*.mdc` (единый источник, тоже читаемы как markdown).

## Critical Rules

### MUST

- В новой сессии: `START.md` → `MEMORY.md` → `git log -20`. Дальше — по типу задачи.
- Использовать `pnpm` (не npm/yarn).
- Comment-headers `// PURPOSE: ...` в каждом новом файле.
- Все AI-мутации через **Tools Layer** (`src/lib/ai/tools/`).
- `tenant_id` в каждом запросе к БД.
- Использовать Context7 при работе с библиотеками.
- После изменений: `pnpm build`, обновить `MEMORY.md` (если меняются ключевые файлы) и `CHANGELOG.md`.
- Новые грабли → `LEARNING_LOG.md` (append-only).

### MUST NOT

> Канон набора — `.cursor/rules/project-context.mdc` (обычный markdown, читается любым агентом). Те же пункты в `CLAUDE.md`, `START.md`, `MEMORY.md`. **Меняешь одно — правишь все пять файлов.**

- Никогда не делать `git add/commit/push` — давать команды пользователю.
- Никогда не запускать миграции автоматически (`db:push`/`db:migrate`).
- Никогда не коммитить `.env`, секреты, ключи (см. `docs/SECURITY.md`).
- Не использовать `npm`/`yarn` — только `pnpm`.
- Не использовать Prisma (мы на Drizzle).
- Не использовать Vercel AI SDK (своя обёртка для AI).
- Не делать DB-запрос без `tenant_id`; `tenantId` — только из сессии (`requireTenant()`/`requireTenantRoute()`).
- Не писать SQL из AI напрямую — только через Tools Layer.
- Не делать глубокую вложенность (`src/features/x/y/z/...`).
- Не использовать `import * as X` (явные импорты).
- Не использовать системные `alert/confirm/prompt` — только Dialog/AlertDialog.
- **Интерактивные CLI-команды** запускать неинтерактивно: `-y` / `--yes` / `--force`.
- **Удаление данных** — всегда с подтверждением пользователя и с проверкой `tenant_id` в запросе.

## File Naming

- Components: `kebab-case.tsx` (`block-grid.tsx`, `add-block-dialog.tsx`, `workspace-switcher.tsx`) — так названы 81 из 83 файлов в `src/components/`. Экспортируемый компонент внутри — PascalCase, имя файла — нет. Единственное исключение: обёртки сторонней библиотеки в `src/components/blocks/markdown/` (`InitializedMDXEditor.tsx`, `ForwardRefEditor.tsx`) — новые файлы так не называть.
- Utilities: `kebab-case.ts` (`format-currency.ts`)
- DB schemas: `kebab-case.ts` (`memory-chunks.ts`)
- AI tools: `verb-noun.ts` (`create-transaction.ts`)

## Project Structure (упрощённо)

Детальное дерево — в `START.md` (канон). Здесь только 1-й уровень:

```
src/
├── app/                  Next.js App Router
│   ├── app/              все внутренние страницы (/app/*) — обычный сегмент, НЕ route-group
│   ├── (auth)/           login/register/forgot/reset
│   └── api/              API routes
├── components/           UI (ui/ = shadcn, blocks/, marketplaces/, unit-economics/, workspaces/, micro-agent/)
├── lib/
│   ├── db/               Drizzle schemas + client
│   ├── ai/               providers/, vision/, prompts/, micro-agent/ + orchestrator.ts и memory/ (КАРКАС, Этап 4 PLAN.md)
│   ├── blocks/           BlockGrid types, registry, catalog
│   ├── workspaces/       «кабинеты»: scope, active, queries
│   ├── marketplaces/     Ozon Seller + Performance API
│   ├── unit-economics/   Tariffs, calculate, bindings
│   └── env.ts            type-safe env
└── modules/              исторический каркас (только README, кода и импортов нет) —
                          реальный реестр модулей: src/lib/modules/registry.ts
```

## Common Patterns

### Drizzle table with RLS

```typescript
import { pgTable, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants';

export const myTable = pgTable('my_table', {
  id: uuid().defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  // ...
});
```

### AI Tool

```typescript
import { z } from 'zod';

export const myTool = {
  name: 'do_something',
  description: 'Кратко что делает (для LLM)',
  parameters: z.object({ /* ... */ }),
  handler: async (args, ctx) => {
    // ctx.tenantId, ctx.userId всегда доступны
  },
};
```

### Block (catalog/my-block.tsx)

```typescript
'use client';
import type { BlockDef } from '@/lib/blocks/types';

export const myBlock: BlockDef = {
  type: 'my.block',
  title: 'Мой блок',
  category: 'custom',
  iconName: 'Sparkles', // string, не component (для RSC)
  defaultSize: { w: 4, h: 3 },
  minSize: { w: 2, h: 2 },
  Render: ({ instance, ... }) => { /* ... */ },
  SettingsForm: ({ instance, onChange }) => { /* ... */ },
};
```

## When in doubt

1. Спросить у пользователя — лучше уточнить.
2. Прочитать **нужный раздел** `PLAN.md` через `Read offset+limit` (не файл целиком — 1427 строк).
3. Использовать Context7 (`mcp0_query-docs`) для актуальной документации.
4. Прочитать `docs/SECURITY.md` если работа касается секретов/сети/биллинга.
5. Историю проекта искать через `git log` или agentmemory MCP `memory_smart_search` (точечно), не через `CHANGELOG.md` целиком.
6. Детальные нарративы по версиям v0.10-v0.22 — в `docs/memory-archive/`.

## Cursor IDE — path-scoped rules

В дополнение к этому файлу Cursor автоматически подгружает `.cursor/rules/*.mdc`. **Точные globs — во frontmatter самих файлов** (ниже — ориентир):

- **`project-context.mdc`** (`alwaysApply: true`) — короткий always-on контекст.
- **`blocks.mdc`** — `src/lib/blocks/**`, `src/components/blocks/**`.
- **`ai-tools.mdc`** — `src/lib/ai/**`, `src/app/api/ai/**`, `src/components/micro-agent/**`.
- **`marketplaces.mdc`** — `src/lib/marketplaces/**`, `src/app/api/marketplaces/**`, `src/components/{marketplaces/**,unit-economics/ozon-*}`, `src/app/app/settings/integrations/**`.
- **`drizzle.mdc`** — `src/lib/db/**`, `drizzle/**`.
- **`security.mdc`** — `src/lib/auth/**`, crypto-модули, `src/middleware.ts`, `src/lib/billing/**`, `src/lib/env.ts`, `.env*`, `src/app/(auth)/**`, `src/app/api/{auth,billing}/**`.
- **`unit-economics.mdc`** — `src/lib/unit-economics/**`, `src/components/unit-economics/**`, `src/app/api/unit-economics/**`, `src/app/app/unit-economics/**`, `src/lib/blocks/catalog/unit-*.tsx`.

Не-Cursor агентам читать `.cursor/rules/*.mdc` напрямую как обычный markdown — это **единый источник доменных правил**, в основных файлах они не дублируются.

## После значимых изменений

**Канон — `.claude/skills/of-end-session/SKILL.md` (7 шагов).** Это обычный markdown — читается любым агентом. Не пересказывать, читать оттуда.

Оглавление: верификация → `CHANGELOG.md` → `MEMORY.md` → **`LEARNING_LOG.md`** → инвариант-файлы + анти-дрейф чек → (опц.) agentmemory `memory_save` → git-команды пользователю (**самому не выполнять**).
