# Changelog

## [0.7.0] - 2026-05-10

### Added
- **shadcn/ui** установлен:
  - `components.json` (style: new-york, baseColor: zinc, lucide icons)
  - `src/components/ui/`: `button.tsx`, `input.tsx`, `label.tsx`, `card.tsx`, `alert.tsx`, `table.tsx`
  - Login/Register страницы переписаны на shadcn-компоненты
- **Cashflow модуль** (первый рабочий бизнес-модуль):
  - `src/lib/cashflow/queries.ts` — `listTransactions`, `getCashflowSummary`, `getTopCategories`, `listCategories`, `ensureDefaultCategories`. Все запросы скоупятся `tenantId`.
  - `src/lib/cashflow/import.ts` — парсер CSV (papaparse) + XLSX (xlsx). Авто-определение колонок «Дата/Сумма/Контрагент/Назначение». Поддержка форматов Тинькофф/Сбер/generic. Положительные суммы → доход, отрицательные → расход
  - `/api/cashflow/transactions` (GET/POST), `/api/cashflow/transactions/[id]` (PATCH/DELETE), `/api/cashflow/categories` (GET), `/api/cashflow/summary` (GET), `/api/cashflow/import` (POST с превью + commit)
  - `/cashflow` страница: сводка месяца (доходы/расходы/баланс), топ-5 категорий, лента последних 50 операций, формы добавления и импорта файла
  - 12 дефолтных категорий создаются при первой транзакции (Продажи маркетплейс, Закупка, Реклама, Налоги, и т.д.)
  - Dashboard: показывает баланс если есть транзакции, иначе — призыв к действию
- **SMTP через nodemailer** (с Beget по умолчанию):
  - `src/lib/email/transport.ts` — `sendMail()` с dev-fallback в консоль если SMTP не настроен
  - `src/lib/email/templates.ts` — `welcomeEmail`, `resetPasswordEmail` (минимальный inline-HTML)
  - Регистрация шлёт welcome-письмо, forgot-password шлёт reset-link
  - `docs/EMAIL_BEGET.md` — пошаговый гайд (создать ящик, SPF/DKIM/DMARC, troubleshooting)
- **Ollama менеджер моделей** (как LM Studio):
  - `src/lib/ai/providers/ollama.ts` — `isOllamaAvailable`, `listInstalledModels`, `pullModel` (со стримом прогресса), `deleteModel`, `generate`
  - `src/lib/ai/providers/ollama-catalog.ts` — каталог 6 рекомендованных моделей с метаданными (размер, RAM, для чего, рекомендация)
  - `/admin/ai/local-models` — UI: установленные модели + каталог, кнопка «Загрузить» с прогресс-баром, удаление, проверка доступности Ollama
  - API: `GET /api/admin/ai/local-models`, `POST /api/admin/ai/local-models/pull` (NDJSON стрим), `DELETE /api/admin/ai/local-models/[name]`
  - `docs/LOCAL_AI.md` — полностью переписан под Mac M3 18GB с таблицей скоростей моделей, troubleshooting, альтернативами
- **VPN proxy для зарубежных AI API:**
  - `docs/VPN_FOR_AI.md` — гайд по подключению bvpn.cc подписки (VLESS через Xray → SOCKS5 на 10808 → AI_PROXY_URL)
  - Альтернативы: WireGuard на VPS, Outline, Mullvad
- **Tauri vs Electron стратегия:**
  - `docs/DESKTOP_STRATEGY.md` — детальное сравнение для интеграций с Office Excel, 1С COM, файловый обмен
  - Решение: Tauri как основной, готовность к Electron-fork в 1 неделю если потребуется COM-автоматизация
- **Новые env**: `SMTP_HOST/PORT/USER/PASSWORD/FROM`, `APP_URL`
- **Зависимости**: `nodemailer`, `papaparse`, `xlsx` (deps); `@types/nodemailer`, `@types/papaparse` (devDeps)

### Changed
- Лендинг: версия 0.6.0 → 0.7.0
- Sidebar (`src/app/(app)/layout.tsx`): добавлена ссылка «AI модели» в админ-секцию
- `src/app/(app)/admin/page.tsx`: уточнено описание раздела локальных моделей

### Verified
- ✅ `pnpm build` проходит. **24 страницы** (было 16), middleware 53.7 kB. Все warnings — косметика (unused imports в schemas, ESLint конкретно `_`-префикс)
- ✅ Auth-пути работают: register шлёт welcome, forgot-password шлёт reset (в dev — в консоль)
- ✅ Cashflow роуты: `/cashflow`, `/api/cashflow/*` — все собраны

---

## [0.6.1] - 2026-05-10

### Fixed
- **Падение middleware на старте dev-сервера** (`ZodError: NEXTAUTH_SECRET min(32)`):
  - В `src/lib/env.ts` убрана `min(32)` валидация — теперь `optional().or(z.literal(''))`. Edge runtime корректно парсит env даже с пустыми значениями
  - Реальная проверка длины секрета теперь в `src/lib/auth/session.ts:getSecretKey()`: prod требует 32+, dev получает безопасный fallback
  - В `.env.example` добавлена подсказка `openssl rand -base64 48` для генерации
- **Build verification** — добавлено правило в memory: всегда запускать `pnpm build` перед сообщением «готово». Build проверяется на edge-runtime совместимость, Suspense boundaries, zod runtime валидацию

### Added
- Сгенерирован безопасный 64-символьный `NEXTAUTH_SECRET` в `.env.local` пользователя (через `openssl rand -base64 48`)

### Verified
- ✅ `pnpm build` проходит. 16 страниц, middleware 53.5 kB. Все warnings — косметика (unused imports)

---

## [0.6.0] - 2026-05-10

### Added
- **Реальный auth поверх JWT cookie + bcrypt** (без NextAuth, чтобы не зависеть от beta v5):
  - `src/lib/auth/password.ts` — `hashPassword`/`verifyPassword`/`generatePasswordResetToken`. bcrypt 12 rounds
  - `src/lib/auth/session.ts` — `jose` JWT в httpOnly cookie `of_session`. Edge-runtime совместимо. TTL 30 дней
  - `src/lib/auth/actions.ts` — `register`/`login`/`logout`/`requestPasswordReset`/`confirmPasswordReset`. Транзакции для атомарной regsitration (user + tenant + membership owner за раз)
  - `src/lib/auth/index.ts` — единая точка входа `auth()`/`signIn()`/`signUp()`/`signOut()`. API совместим с NextAuth v5 для будущей миграции
- **API routes:**
  - `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/forgot-password`
  - `POST /api/onboarding/complete` — фиксирует выбор шаблона и помечает tenant как прошедший онбординг
- **Страницы:**
  - `src/app/(auth)/login/page.tsx` + `register` + `forgot-password` — минималистичный UI, поддержка `?next=` редиректа
  - `src/app/(app)/layout.tsx` — приватный layout с сайдбаром, навигацией и `LogoutButton`. Для admin показывается доп. секция
  - `src/app/(app)/dashboard/page.tsx` — главный экран с проверкой onboardingCompleted
  - `src/app/(app)/onboarding/page.tsx` — упрощённый визард на одном шаге (выбор типа деятельности из 6). Полный визард — Этап 1
  - `src/app/(app)/admin/page.tsx` — админ-панель со статистикой (users/tenants/подписки), списком разделов
  - `src/components/logout-button.tsx`
- **Middleware** — реальная JWT проверка вместо заглушки:
  - Public paths: `/`, `/login`, `/register`, `/forgot-password`, `/reset-password`, `/api/auth`, `/api/health`
  - Admin paths: `/admin`, `/api/admin` — нужна роль `admin`/`super_admin`, иначе редирект `/dashboard` или 403 для API
  - Прокидывает `x-user-id`, `x-tenant-id`, `x-user-role` в заголовки для server components
- **Schema users расширена:** `globalRole` (`user`/`admin`/`super_admin`), `passwordResetToken`, `passwordResetExpiresAt`, `lastLoginAt`
- **CLI скрипты для админа:**
  - `pnpm db:seed` — `scripts/seed.ts` создаёт дефолтного `super_admin` с email/паролем из `SEED_*` env (дефолт: `admin@openfinance.local` / `admin12345`)
  - `pnpm admin:reset-password <email> <new-password>` — `scripts/reset-password.ts`
  - `pnpm admin:create <email> <password> [--admin|--super-admin]` — `scripts/create-user.ts`
- **Auth dependencies:** `bcryptjs`, `jose` (deps); `@types/bcryptjs`, `tsx` (devDeps)
- **`SEED_ADMIN_*`** в `.env.example`

### Changed
- **Postgres порт `5433` → `5434`** во всех файлах (.env.example, README, drizzle.config.ts) — пользователь сменил в docker-compose
- **Лендинг:** кнопка «Попробовать Pro» теперь ведёт на `/register` (раньше `/dashboard`). Версия в надписи 0.4.0 → 0.6.0

### Notes
- **Lint-ошибки про `bcryptjs`/`jose`/`@components/logout-button`** ожидаемы до `pnpm install` — после исчезнут
- Reset-password ссылка пока не отправляется на email (нет SMTP) — токен пишется в консоль сервера в dev. Email-доставка будет в Этапе 1 после интеграции SMTP/SendGrid

---

## [0.5.0] - 2026-05-10

### Fixed
- **CVE-2025-66478 в Next.js** — обновлён `next` 15.0.3 → 15.5.4 (последний патченный 15.x)
- **Turbopack + typedRoutes несовместимость** — `next.config.mjs` теперь делает `experimental.typedRoutes: true` только для webpack-режима; при `NEXT_TURBO=1` флаг не подставляется
- **Дефолтный `pnpm dev`** переключён на webpack для типизированных роутов; добавлен `pnpm dev:turbo` для Turbopack-сборки
- **drizzle-kit не подхватывает .env.local** — `drizzle.config.ts` теперь сам подгружает `.env.local`/`.env` через `dotenv`

### Changed
- **React 19 RC → React 18.3.1** — зафиксирована стабильная версия (по требованию: «зафиксируй стабильность»). React 19 вернётся когда выйдет stable
- **drizzle-orm `^0.36.4` → `^0.45.2`**, **drizzle-kit `^0.28.1` → `^0.31.10`**, **eslint-config-next `15.0.3` → `15.5.4`**
- **docker-compose.yml** переписан по образцу `/Users/firay/braint`:
  - Postgres на `5433` (чтобы не конфликтовать с другими локальными Postgres)
  - Redis на `6380`, MinIO на `9100/9101`, Adminer на `8081`
  - Все порты bind к `127.0.0.1` для безопасности
  - Healthcheck на каждый сервис, отдельный network `openfinance_network`
- **`.env.example`** дополнен: `POSTGRES_*` блок, MinIO/Adminer порты, `AI_DEFAULT_PROVIDER`, `OLLAMA_*`, `AI_MOCK_ENABLED`, `AI_PROXY_*` (VPN), `S3_REGION`/`S3_FORCE_PATH_STYLE`, feature flags (`FEATURE_OPEN_REGISTRATION`, `FEATURE_ONBOARDING_WIZARD`, `FEATURE_BILLING_MOCK`, `FEATURE_DEFAULT_PLAN`), `AUTH_DRIVER`
- **`src/lib/env.ts`** — расширена zod-схема под новые env, типизированные feature flags
- **Schema `tenants`** — добавлены поля `onboardingCompleted: boolean`, `setupAnswers: jsonb`, новый тип `SetupAnswers`. В `TenantSettings` — `aiProvider` уточнён под текущие провайдеры, добавлен `openRegistration` флаг
- **`drizzle/init/01-extensions.sql`** — добавлены `unaccent` + функция `normalize_search_text` (по образцу braint)

### Added
- **`drizzle/init/02-vector-indexes.sql`** — отдельный скрипт для индексов которые drizzle-kit не умеет: HNSW на `memory_chunks.embedding` (cosine, m=16, ef_construction=64), GIN FTS русский, trigram на `transactions.counterparty`. Применяется вручную после `db:push`
- **`docs/LOCAL_AI.md`** — гайд по локальной AI-модели через Ollama для dev (3 способа установки, выбор модели по железу, план UI в админке)
- **`docs/ONBOARDING.md`** — спецификация onboarding-визарда: 6 шагов, 6 шаблонов под тип пользователя, архитектура
- **`src/lib/onboarding/templates.ts`** — реестр шаблонов модулей и AI-агентов под тип пользователя (selller/freelancer/small_business/self_employed/personal/other)
- **`src/lib/auth/index.ts`** — точка входа auth с переключателем `AUTH_DRIVER=v5|v4` (запас на случай beta-проблем NextAuth.js 5)
- **`src/lib/billing/mock.ts`** — заглушка биллинга которая всегда возвращает success (для dev и e2e тестов; активна при `FEATURE_BILLING_MOCK=true`)
- **`src/lib/ai/providers/mock.ts`** — детерминированный AI-провайдер для разработки без API ключей (срабатывает на ключевые слова: налог/чек/баланс/дедлайн)
- **`FEED.md`** — заготовка постов для Telegram-канала Open Finance (10 готовых + 8 идей в бэклоге, стиль `@braintmind`)
- **`pnpm ollama:check`** — скрипт быстрой проверки доступности локальной Ollama
- **`dotenv`** в devDependencies — для загрузки env в drizzle-kit

### Notes
- Команды для проверки после фиксов:
  ```bash
  pnpm install --force         # переустановит с новыми версиями
  pnpm docker:up               # поднимет Postgres+Redis+MinIO+Adminer
  pnpm db:push                 # применит схемы
  docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/02-vector-indexes.sql
  pnpm dev                     # webpack + typedRoutes
  ```

---

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
