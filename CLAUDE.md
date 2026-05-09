# CLAUDE.md — Правила проекта Open Finance

## TL;DR (читай в первую очередь)
**Open Finance** — AI-первая модульная финансовая платформа: SaaS + Local-First (Tauri).
Главный референс: Notion + Linear + Claude Code по UX, Copilot Money по AI.

**Перед любой задачей:**
1. Читать `MEMORY.md` (компактный контекст)
2. Читать `CHANGELOG.md` (что изменено недавно)
3. Читать релевантные части `PLAN.md` (детальная карта)
4. Если задача про библиотеку — обязательно `mcp0_query-docs` через Context7

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
| **AI Orchestrator** | Своя обёртка (не Vercel AI SDK) — больше контроля |
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

---

## Архитектурные принципы

### AI-first (главное)
- AI — первоклассный гражданин, не дополнение
- Все мутации через **typed Tools Layer** (не прямой SQL)
- Семантическая память через **RAG** (pgvector + hybrid search)
- **Audit log** всех AI-действий с возможностью отката
- Без AI приложение работает как обычная финансовая программа

### Простая структура для AI
- Плоская: `src/modules/{name}/`, не `src/features/x/y/z/...`
- Явные импорты, без `import * as X`
- Comment-headers в каждом файле: `// PURPOSE: ...`
- README в каждой крупной папке (что тут, как добавить)
- НЕТ магии — никаких декораторов / DI-контейнеров

### Multi-tenant
- `tenant_id` в каждой таблице
- Postgres RLS через `enableRLS()` в Drizzle
- Tenant context в middleware
- НИКОГДА не делать запросы без `tenant_id` фильтра

---

## Жёсткие ограничения

- **Git**: НИКОГДА не делать `git add/commit/push` — только давать команды пользователю
- **БД**: НИКОГДА не запускать миграции автоматически — только давать команды
- **Секреты**: НИКОГДА не коммитить `.env`, ключи, пароли — см. `docs/SECURITY.md`
- **Интерактивные команды**: `-y`, `--yes`, `--force` (UI пользователя не позволяет вводить ответы)
- **Удаление данных**: ВСЕГДА с подтверждением, для tenant_id обязательна проверка

---

## Процесс работы (для каждой задачи)

1. **Анализ** — понять конечную цель, явные и неявные требования
2. **Roadmap** — обновить `update_plan` с атомарными шагами
3. **Чтение** — прочитать файлы которые планируется менять
4. **Поиск контекста** — `code_search` или `mcp0_query-docs` (Context7)
5. **Выполнение** — точечные правки через `edit` / `multi_edit`
6. **Верификация** — `pnpm typecheck` или `pnpm build`
7. **Документация** — обновить `CHANGELOG.md`
8. **Команды** — дать пользователю git-команды для коммита

---

## CHANGELOG формат

```markdown
## [X.Y.Z] - YYYY-MM-DD
### Added / Changed / Fixed / Removed
- **Компонент** — короткое описание (1-2 строки)
```

Версии:
- **MAJOR** — рабочий проект (не меняется в MVP)
- **MINOR** — крупные фичи (новый модуль, новая интеграция)
- **PATCH** — фиксы и мелкие улучшения

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

## Документация

- `docs/MODULES.md` — как добавить модуль
- `docs/AI_TOOLS.md` — реестр всех AI-инструментов
- `docs/BILLING.md` — реализация биллинга (Т-Касса/CloudPayments)
- `docs/LICENSING.md` — лицензирование Tauri-версии
- `docs/SECURITY.md` — обязательное чтение, правила секретов
- `docs/ARCHITECTURE.md` — карта архитектуры

---

## Подсказка по командам

```bash
# Установка
pnpm install

# Dev режим
pnpm dev               # Next.js dev server
pnpm docker:up         # PostgreSQL + Redis в Docker

# БД
pnpm db:generate       # сгенерировать миграции из schema
pnpm db:push           # применить schema напрямую (dev)
pnpm db:migrate        # применить миграции (prod-style)
pnpm db:studio         # GUI для просмотра БД

# Качество
pnpm typecheck         # TypeScript проверка
pnpm lint              # ESLint
pnpm format            # Prettier
pnpm build             # production build
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
1. `mcp0_resolve-library-id` — найти точный ID
2. `mcp0_query-docs` — конкретный вопрос
3. Не больше 3 вызовов на задачу
