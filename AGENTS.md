# AGENTS.md — универсальные правила для AI-агентов

> Этот файл предназначен для **любого AI-агента** работающего с кодом проекта (Cursor, Cline, Aider, Continue, Codeium, Windsurf, Claude Code).
> Полные правила в `CLAUDE.md`. Здесь — самое важное в сжатом виде.

## Project Identity
- **Name:** Open Finance
- **Type:** AI-первая модульная финансовая платформа (SaaS + Tauri Desktop)
- **Audience:** Селлеры маркетплейсов, ИП, фрилансеры, малый бизнес РФ
- **Status:** Foundation phase (v0.4.0)

## Tech Stack
- **Frontend:** Next.js 15 App Router + TypeScript + Tailwind + shadcn/ui
- **DB:** PostgreSQL 16 + pgvector (RAG) + Drizzle ORM
- **AI:** Claude / OpenAI / Yandex GPT / Ollama (через свою обёртку)
- **Cache:** Redis 7 + BullMQ
- **Desktop:** Tauri 2.0 (Phase 2)
- **Mobile:** React Native + Expo (Phase 3)

## Critical Rules

### MUST
- ✅ Перед изменениями читать `MEMORY.md` → `CHANGELOG.md` → `PLAN.md`
- ✅ Использовать `pnpm` (не npm/yarn)
- ✅ Comment-headers `// PURPOSE: ...` в каждом новом файле
- ✅ Все AI-мутации через **Tools Layer** (`src/lib/ai/tools/`)
- ✅ `tenant_id` в каждом запросе к БД
- ✅ Использовать Context7 при работе с библиотеками

### MUST NOT
- ❌ Никогда не делать `git add/commit/push` — давать команды пользователю
- ❌ Никогда не запускать миграции автоматически
- ❌ Никогда не коммитить `.env`, секреты, ключи (см. `docs/SECURITY.md`)
- ❌ Не использовать Prisma (мы на Drizzle)
- ❌ Не использовать Vercel AI SDK (своя обёртка для AI)
- ❌ Не делать глубокую вложенность (`src/features/x/y/z/...`)
- ❌ Не использовать `import * as X` (явные импорты)

## File Naming
- Components: `PascalCase.tsx` (`UserCard.tsx`)
- Utilities: `kebab-case.ts` (`format-currency.ts`)
- DB schemas: `kebab-case.ts` (`memory-chunks.ts`)
- AI tools: `verb-noun.ts` (`create-transaction.ts`)

## Project Structure (упрощённо)
```
src/
├── app/                # Next.js App Router
├── modules/            # Бизнес-модули (плоско, не вложено)
│   ├── cashflow/
│   ├── taxes/
│   ├── inbox/
│   ├── communications/
│   └── ...
├── components/         # UI компоненты
│   ├── ui/             # shadcn/ui примитивы
│   └── ...
└── lib/
    ├── db/             # Drizzle schemas + client
    ├── ai/             # AI orchestrator + tools + memory (RAG)
    │   ├── orchestrator.ts
    │   ├── providers/
    │   ├── tools/
    │   └── memory/
    └── env.ts          # type-safe env
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

## When in doubt
1. Спросить у пользователя — лучше уточнить
2. Прочитать `PLAN.md` — там детальное обоснование архитектуры
3. Использовать Context7 (`mcp0_query-docs`) для актуальной документации
4. Прочитать `docs/SECURITY.md` если работа касается секретов / сети / биллинга
