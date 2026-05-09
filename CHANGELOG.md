# Changelog

## [0.4.0] - 2025-05-10

### Added
- **Фундамент проекта создан** — полностью с нуля под актуальный план:
  - `package.json` — Next.js 15 + React 19 RC, Drizzle ORM 0.36, Tailwind 3.4, shadcn/ui примитивы, Zustand, TanStack Query, cmdk
  - `tsconfig.json` с path aliases (`@/lib`, `@/modules`, `@/components`, `@/db`)
  - `next.config.mjs` с security headers + Tauri-friendly export режим
  - `tailwind.config.ts` + `globals.css` с CSS-переменными для тем (светлая по умолчанию)
  - `drizzle.config.ts` для миграций
  - `docker-compose.yml` — Postgres 16 с **pgvector** + Redis 7
  - `drizzle/init/01-extensions.sql` — extensions: vector, pgcrypto, pg_trgm
  - `.eslintrc.json` + `.prettierrc` + `.env.example`
- **Drizzle schemas (базовые):**
  - `tenants` — мультитенантность с тарифами и налоговыми режимами
  - `users` + `memberships` — пользователи и роли (owner/admin/manager/accountant/viewer)
  - `transactions` + `categories` — финансовые операции (в копейках для точности)
  - `blocks` — универсальные блоки модульного конструктора (Excel-like, charts, text)
  - `deadlines` — cross-cutting слой дедлайнов с recurrence + reminders
  - `memoryChunks` — RAG-память с pgvector (1536-dim embeddings)
  - `aiUsage` — счётчик токенов с лимитами по тарифу
  - `aiAuditLog` — аудит всех AI-действий с inverse_action для отката
  - `aiAgents` — кастомные AI-агенты пользователя (Phase 2)
- **AI Foundation (skeleton):**
  - `src/lib/ai/types.ts` — типы Tool, ToolContext, ChatMessage
  - `src/lib/ai/orchestrator.ts` — главная точка работы с AI + tool registry
  - `src/lib/ai/tools/index.ts` — реестр инструментов
  - `src/lib/ai/memory/search.ts` — hybrid search (semantic + FTS + RRF)
- **Module Registry:**
  - `src/lib/modules/types.ts` — Module/Widget/Plan типы
  - `src/lib/modules/registry.ts` — регистрация и поиск модулей
  - README для cashflow, inbox, communications модулей
- **App Router:**
  - `src/app/layout.tsx` с Inter + JetBrains Mono шрифтами и ThemeProvider
  - `src/app/page.tsx` — минимальный лендинг с CTA «Попробовать Pro 14 дней»
  - `src/app/api/health/route.ts` — health check endpoint
  - `src/components/theme-provider.tsx` (next-themes wrapper)
  - `src/middleware.ts` — заглушка под auth + tenant context
- **Документация для AI-агентов:**
  - `CLAUDE.md` — полностью переписан под актуальный стек (Drizzle вместо Prisma, AI-first архитектура)
  - `AGENTS.md` — универсальные правила для любого AI-агента
  - `MEMORY.md` — компактный контекст (5 разделов)
  - `README.md` — публичный README с быстрым стартом
  - `docs/MODULES.md` — как добавлять модули
  - `docs/AI_TOOLS.md` — реестр инструментов и стандарты
  - `docs/ARCHITECTURE.md` — карта архитектуры с диаграммами и потоками

### Changed
- **PLAN.md** — финальная итерация:
  - **Free тариф:** безлимитная история (убрано «30 дней»)
  - **Цены:** Pro 990 → 690 ₽/мес, Business 2 990 → 2 490 ₽, Enterprise 7 990 → 6 990 ₽ (доступнее)
  - **Trial Pro:** 14 дней без оплаты, без карты — кнопка «Попробовать»
  - **AI-агенты + счётчик токенов** — новый раздел про специализированные агенты с настраиваемыми скилами + лимиты по тарифам
  - **Tauri vs Electron сравнение** — обоснование выбора Tauri 2.0
  - **VPN-надстройка** — для зарубежных AI API через Vless/WireGuard в админке
  - **AI Orchestrator** — своя обёртка вместо Vercel AI SDK
  - **Светлая тема по умолчанию** + тёмная опция через CSS-переменные
  - **Mobile native** — React Native + Expo как приоритет (не PWA)
  - **Linear UX** — keyboard shortcuts стали опциональными, мышь+drag-n-drop по умолчанию
  - **Yandex GPT / GigaChat** — добавлены как РФ-fallback без VPN
  - **BYOK** — пользователь может вставить свой API-ключ
- **`.gitignore`:** привязка папок к корню (`/inbox/` вместо `inbox/`) — чтобы не блокировать `src/modules/inbox/`

### Memory
- Добавлено правило про обязательное использование Context7 при работе с библиотеками
- Добавлено правило безопасности (gitleaks, защита от утечек)

## [0.3.0] - 2025-05-10

### Changed
- **PLAN.md** — третья волна доработок:
  - **Free тариф:** убрано ограничение в 30 дней — теперь **безлимитная история** на всех тарифах
  - **AI-first архитектура:** добавлен большой раздел про AI как первоклассный гражданин системы (Memory Layer / Tools Layer / Orchestrator)
  - **RAG-память:** pgvector + sqlite-vec, схема `memory_chunks` с HNSW индексом, hybrid search (semantic + FTS + RRF)
  - **Tools Layer:** типизированные инструменты для AI (Zod → JSON Schema), audit log + откат
  - **Linear UX:** keyboard shortcuts стали опциональными (мышь + drag-n-drop по умолчанию, прогрессивное раскрытие подсказок)
  - **Простая структура для AI:** антипаттерны (глубокая вложенность, барреллы) + правила (плоская структура, явные импорты, comment-headers, README в папках)
  - **Файлы конвенций:** CLAUDE.md, AGENTS.md, .cursor/rules/ — для онбординга AI-агентов
  - **Стек обновлён:** добавлены pgvector, sqlite-vec, Vercel AI SDK, OpenAI embeddings, Tesseract OCR, Whisper, grammY/GramJS

### Added
- **Inbox — drop-папка для AI** (Этап 7.5): `~/OpenFinance/Inbox/` или S3-bucket, AI ежедневно проверяет, парсит чеки/договоры/Excel/заметки/голосовые → создаёт транзакции/блоки/напоминания. Auto-mode + Approve-mode + per-type rules. Email-to-Inbox через `inbox.{user}@openfinance.ru`.
- **AI-секретарь** (Этап 8): интеграция с Email IMAP, Telegram (Bot+MTProto), WhatsApp Business, VK, MAX, Google Contacts, iCloud CardDAV. Granular permissions, opt-in, audit log, кнопка «Стереть всю память».
- **`.gitignore`** — полный список исключений (.env, *.pem, базы, inbox/, data/, секретные ключи, gitignored notes)
- **`docs/SECURITY.md`** — обязательное чтение для AI и людей: правила работы с секретами, чек-листы, защита от утечек, 152-ФЗ
- **Память:** правила безопасности добавлены в MemPalace для контроля при коммитах

### Roadmap
- Расширен с 13 до **14 этапов**: добавлены Этап 7.5 (Inbox) и Этап 8 (AI-секретарь). Остальные перенумерованы.

## [0.2.0] - 2025-05-10

### Changed
- **PLAN.md** — крупный апгрейд плана:
  - **Налоги:** добавлен модуль с поддержкой всех режимов РФ (УСН 6%/15%, НДС 5%/7%/20%, ПСН, НПД, АУСН, ОСНО, ЕСХН) + AI-сценарии сравнения
  - **ORM:** Prisma → **Drizzle ORM** (детальное обоснование: bundle size, серверлесс, нативная RLS, единая схема Postgres+SQLite)
  - **Local-First версия:** новый раздел про Tauri 2.0 + SQLite + лицензирование (3 варианта монетизации: Lifetime/Subscription/Free Local)
  - **Excel-like блоки** добавлены в базовую версию (mini-spreadsheet, формулы, шаблоны: бюджет/поставки/ROI/цели/подписки)
  - **Биллинг:** Т-Касса (основной) + CloudPayments (резервный) с архитектурой `PaymentProvider` + резерв на YooKassa/Robokassa/Stripe
  - **Дедлайны и напоминания:** cross-cutting фича — на любом блоке (налоги, поставки с Китая, заказы, цели)
  - **Дизайн и UX:** отдельный блок с принципами из Notion/Linear/Obsidian/Claude Code/Codex (slash-команды, Cmd+K palette, block editor, дизайн-система, цвета, типографика)
  - **Roadmap** расширен до 13 этапов (добавлены Excel-блоки, Tauri Local-First, поставки, дедлайны)
  - **Структура проекта** обновлена под Drizzle + новые модули (supply, orders, planner, deadlines, blocks)
- **Шаблоны блоков** в базовую версию: Личный бюджет, Поставки с Китая, ROI калькулятор, Сравнение поставщиков, Долги/займы, Подписки, Цели

### Added
- **docs/BILLING.md** — пошаговая инструкция по реализации биллинга (Т-Касса + CloudPayments) для будущего AI агента: API, схема БД, безопасность, чеклист
- **docs/LICENSING.md** — инструкция по реализации лицензирования (JWT RS256, Tauri keyring, поток активации) для AI агента

## [0.1.0] - 2025-05-09

### Changed
- **PLAN.md** — полная переработка концепции проекта:
  - Убран yoolip.ai как референс, оставлен только в таблице конкурентов для сравнения
  - Новое позиционирование: AI Финансовый Управляющий (не аналитика с AI-довеском)
  - Добавлен модульный конструктор как ядро продукта (базовые / бизнес / AI-надстройки)
  - Добавлен анализ рынка: 5 российских + 4 мировых конкурента с таблицами сравнения
  - Добавлена целевая аудитория (селлеры, ИП, фрилансеры, малый бизнес)
  - Добавлена детальная AI-функциональность (предиктивный анализ, коучинг, сценарии)
  - Пересмотрены тарифы: Pro от 990₽/мес (доступность как приоритет)
  - Roadmap расширен до 10 этапов (добавлен AI Советник и Smart-уведомления отдельно)
  - Обновлена структура проекта под модульную архитектуру

### Added
- **CHANGELOG.md** — создан лог изменений проекта
