# Open Finance

> AI-первая модульная финансовая платформа для предпринимателей.
> Notion-style блоки + Linear UX + Claude Code минимализм + RAG-память + AI-секретарь.

[![Status](https://img.shields.io/badge/status-foundation-blue.svg)]()
[![Version](https://img.shields.io/badge/version-0.4.0-blue.svg)]()

## Что это

**Open Finance** — модульный конструктор финансов с AI-помощником, который работает поверх ВСЕХ ваших данных.

### Ключевые фичи

- **AI-первая архитектура** — RAG-память (pgvector), типизированные tools, audit log
- **Модульный конструктор** — собираете дашборд из блоков (виджеты + Excel-like таблицы)
- **Inbox для AI** — кидаете чеки/договоры/заметки → AI разносит по модулям
- **AI-секретарь** — подключение к email, Telegram, WhatsApp, VK для контекста
- **Налоги РФ нативно** — все режимы (УСН/НДС/ПСН/НПД/АУСН/ОСНО)
- **Дедлайны на любом блоке** — Notion-style, единый календарь
- **Local-First версия** (Tauri 2.0) — данные на устройстве, offline
- **Светлая тема по умолчанию** + тёмная опция

## Стек

- **Frontend:** Next.js 15 + TypeScript + Tailwind + shadcn/ui
- **DB:** PostgreSQL 16 + pgvector + Drizzle ORM
- **AI:** Claude / OpenAI / Yandex GPT / Ollama (своя обёртка)
- **Cache:** Redis 7 + BullMQ
- **Desktop:** Tauri 2.0 (Phase 2)
- **Mobile:** React Native + Expo (Phase 3)

## Быстрый старт

```bash
# 1. Установка зависимостей
pnpm install

# 2. Запуск БД (Postgres с pgvector + Redis)
pnpm docker:up

# 3. Создать .env.local на основе .env.example
cp .env.example .env.local

# 4. Применить схему БД
pnpm db:push

# 5. Запустить dev-сервер
pnpm dev
```

Открыть [http://localhost:3000](http://localhost:3000).

## Структура

```
open-finance/
├── src/
│   ├── app/                # Next.js App Router (страницы и API)
│   ├── modules/            # Бизнес-модули (cashflow, taxes, inbox, ...)
│   ├── components/         # UI компоненты
│   └── lib/
│       ├── db/             # Drizzle schemas
│       ├── ai/             # AI orchestrator + tools + memory (RAG)
│       └── env.ts          # type-safe env
├── drizzle/                # Миграции и SQL init
├── docs/                   # Документация для AI и людей
└── docker-compose.yml      # Postgres + Redis для разработки
```

## Документация

- [`PLAN.md`](./PLAN.md) — полный план продукта (1300+ строк)
- [`MEMORY.md`](./MEMORY.md) — компактный контекст для AI-агентов
- [`CLAUDE.md`](./CLAUDE.md) — правила для Claude Code
- [`AGENTS.md`](./AGENTS.md) — правила для любого AI-агента
- [`docs/SECURITY.md`](./docs/SECURITY.md) — безопасность и защита от утечек
- [`docs/BILLING.md`](./docs/BILLING.md) — реализация биллинга
- [`docs/LICENSING.md`](./docs/LICENSING.md) — лицензирование Tauri-версии
- [`docs/MODULES.md`](./docs/MODULES.md) — как добавить модуль
- [`docs/AI_TOOLS.md`](./docs/AI_TOOLS.md) — реестр AI-инструментов
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — карта архитектуры
- [`CHANGELOG.md`](./CHANGELOG.md) — история изменений

## Тарифы

| Тариф | Цена | Что включено |
|-------|------|-------------|
| Free | 0 ₽ | Дашборд, 1 источник, безлимитная история |
| Trial Pro | 0 ₽ / 14 дней | Полный Pro без оплаты |
| Pro | 690 ₽/мес | Все модули, AI, налоги |
| Business | 2 490 ₽/мес | + 5 пользователей, API |
| Enterprise | 6 990 ₽/мес | Безлимит, SLA |
| Local Lifetime | 9 990 ₽ разово | Tauri-версия, lifetime |

## Контрибьюшен

Проект в стадии foundation. Контрибьюшен правила появятся позже.

## Лицензия

TBD (вероятно MIT для open core, commercial для SaaS-версии)

---

Made with care for ИП и фрилансеров РФ.
