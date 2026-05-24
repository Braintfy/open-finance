# AGENTS.md — универсальные правила для AI-агентов

> Этот файл для **любого AI-агента** (Cline, Aider, Continue, Codeium, Windsurf, Claude Code).
> Cursor IDE дополнительно использует `.cursor/rules/*.mdc` (auto-attach по globs).
> Полные правила в `CLAUDE.md`. Здесь — самое важное в сжатом виде.

## Project Identity

- **Name:** Open Finance
- **Type:** AI-первая модульная финансовая платформа (SaaS + Tauri Desktop)
- **Audience:** Селлеры маркетплейсов, ИП, фрилансеры, малый бизнес РФ
- **Status:** v0.22.2 (см. `CHANGELOG.md`)

## Tech Stack

- **Frontend:** Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui
- **DB:** PostgreSQL 16 + pgvector (RAG) + Drizzle ORM
- **AI:** Claude / OpenAI / Yandex GPT / Ollama (через свою обёртку, не Vercel AI SDK)
- **Cache:** Redis 7 + BullMQ
- **Desktop:** Tauri 2.0 (Phase 2)
- **Mobile:** React Native + Expo (Phase 3)

## Bootstrap новой сессии (триггер — «загрузи контекст Open Finance»)

1. `START.md` — карта проекта, маршрутизация по типу задачи (~3K токенов).
2. `MEMORY.md` — текущее состояние, ключевые файлы, грабли (~5K токенов).
3. `git -C /Users/firay/open-finance/open-finance log --oneline -20` — свежие коммиты.

Дальше — только релевантное конкретной задаче. **НЕ грузить** `CHANGELOG.md` (2981 строка) и `PLAN.md` (1427 строк) целиком по умолчанию.

`mempalace wake-up --wing open-finance` — **не использовать** для стартового контекста (индекс содержит устаревшие версии Tauri-only, Prisma, Python sidecar). `mempalace search "..." --wing open-finance` — точечно для исторических вопросов. См. `docs/MEMPALACE_RUNBOOK.md`.

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

- Никогда не делать `git add/commit/push` — давать команды пользователю.
- Никогда не запускать миграции автоматически.
- Никогда не коммитить `.env`, секреты, ключи (см. `docs/SECURITY.md`).
- Не использовать Prisma (мы на Drizzle).
- Не использовать Vercel AI SDK (своя обёртка для AI).
- Не делать глубокую вложенность (`src/features/x/y/z/...`).
- Не использовать `import * as X` (явные импорты).
- Не использовать системные `alert/confirm/prompt` — только Dialog/AlertDialog.

## File Naming

- Components: `PascalCase.tsx` (`UserCard.tsx`)
- Utilities: `kebab-case.ts` (`format-currency.ts`)
- DB schemas: `kebab-case.ts` (`memory-chunks.ts`)
- AI tools: `verb-noun.ts` (`create-transaction.ts`)

## Project Structure (упрощённо)

```
src/
├── app/                  Next.js App Router
├── modules/              Бизнес-модули (плоско)
│   ├── cashflow/
│   ├── taxes/
│   ├── inbox/
│   └── communications/
├── components/           UI компоненты
│   ├── ui/               shadcn/ui примитивы
│   ├── blocks/           BlockGrid shell
│   ├── marketplaces/     Ozon sync UI
│   └── unit-economics/   Калькуляторы
└── lib/
    ├── db/               Drizzle schemas + client
    ├── ai/               AI orchestrator + tools + memory (RAG)
    │   ├── orchestrator.ts
    │   ├── providers/
    │   ├── tools/
    │   ├── vision/
    │   └── memory/
    ├── blocks/           BlockGrid types, registry, catalog
    ├── marketplaces/     Ozon Seller + Performance API
    ├── unit-economics/   Tariffs, calculate, bindings
    └── env.ts            type-safe env
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
5. Историю проекта искать через `git log` или `mempalace search "..." --wing open-finance` (точечно), не через `CHANGELOG.md` целиком.
6. Детальные нарративы по версиям v0.10-v0.22 — в `docs/memory-archive/`.

## Cursor IDE — path-scoped rules

В дополнение к этому файлу Cursor автоматически подгружает:

- **`.cursor/rules/project-context.mdc`** (`alwaysApply: true`) — короткий always-on контекст.
- **`.cursor/rules/blocks.mdc`** — при работе с `src/lib/blocks/**`, `src/components/blocks/**`.
- **`.cursor/rules/ai-tools.mdc`** — при работе с `src/lib/ai/**`.
- **`.cursor/rules/marketplaces.mdc`** — при работе с `src/lib/marketplaces/**`.
- **`.cursor/rules/drizzle.mdc`** — при работе с `src/lib/db/**`, `drizzle/**`.
- **`.cursor/rules/security.mdc`** — при работе с auth/crypto/billing.
- **`.cursor/rules/unit-economics.mdc`** — при работе с `src/lib/unit-economics/**`.

Для не-Cursor агентов — игнорировать; вся информация дублируется в основных файлах.

## После значимых изменений

1. `pnpm build` (или `pnpm typecheck`).
2. Обновить `MEMORY.md` (если изменились ключевые файлы/инварианты/грабли).
3. Записать новую грабли в `LEARNING_LOG.md`.
4. Добавить запись в `CHANGELOG.md`.
5. Дать пользователю git-команды для коммита (не выполнять самому).
6. (Опц.) `./scripts/sync-mempalace.sh` — обновить external AI handoff.
