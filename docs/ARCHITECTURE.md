# ARCHITECTURE.md — карта архитектуры Open Finance

> **2026-11-17:** целевая архитектура пересмотрена — см. `docs/HUB_PLAN.md`, раздел 5. Ниже — карта прежней цели (публичный SaaS).

> Высокоуровневое описание системы. Для деталей смотрите соответствующие модули и `PLAN.md`.

## Системная диаграмма

```
┌──────────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Web (Next.js│  │Tauri Desktop│  │RN + Expo    │              │
│  │ App Router) │  │ (Phase 2)   │  │ (Phase 3)   │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         └───────────┬─────┴────────────────┘                     │
└────────────────────┼─────────────────────────────────────────────┘
                     │ HTTPS / tRPC / Server Actions
┌────────────────────┼─────────────────────────────────────────────┐
│                     │   API LAYER (Next.js)                       │
│  ┌──────────────────┴──────────────────────────────┐            │
│  │  Middleware (auth + tenant context)              │            │
│  └─────┬────────────────────────────────────────────┘            │
│        │                                                          │
│  ┌─────▼─────┐  ┌────────────┐  ┌──────────────┐                │
│  │ App Routes│  │tRPC Routers│  │ AI Endpoints │                │
│  └─────┬─────┘  └─────┬──────┘  └──────┬───────┘                │
└────────┼──────────────┼────────────────┼─────────────────────────┘
         │              │                │
┌────────▼──────────────▼────────────────▼─────────────────────────┐
│                  BUSINESS LOGIC LAYER                             │
│                                                                   │
│  ┌────────────────────────────────────────────────┐              │
│  │  AI ORCHESTRATOR                                │              │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐ │              │
│  │  │Providers │  │  Tools   │  │ Memory (RAG) │ │              │
│  │  │Claude/GPT│  │ Layer    │  │   pgvector   │ │              │
│  │  └──────────┘  └────┬─────┘  └──────────────┘ │              │
│  └─────────────────────┼─────────────────────────┘              │
│                        │                                          │
│  ┌─────────────────────▼─────────────────────────┐              │
│  │  MODULES (плоская структура)                   │              │
│  │  ┌──────┐ ┌─────┐ ┌─────┐ ┌──────┐ ┌────────┐│              │
│  │  │Cash  │ │Taxes│ │Inbox│ │Comms │ │Supply  ││              │
│  │  │flow  │ │     │ │     │ │      │ │        ││              │
│  │  └──┬───┘ └──┬──┘ └──┬──┘ └──┬───┘ └───┬────┘│              │
│  └─────┼────────┼────────┼───────┼─────────┼─────┘              │
│        │        │        │       │         │                     │
│  ┌─────▼────────▼────────▼───────▼─────────▼────────┐           │
│  │  CROSS-CUTTING SERVICES                            │           │
│  │  • Deadlines  • Notifications  • Audit log        │           │
│  │  • Billing    • Storage (S3)   • Workers (BullMQ) │           │
│  └────────────────────────────────────────────────────┘           │
└──────────────────────────────────────────────────────────────────┘
                        │
┌────────────────────────▼─────────────────────────────────────────┐
│                  DATA LAYER                                       │
│  ┌──────────────────┐  ┌────────────┐  ┌────────────┐           │
│  │ PostgreSQL 16    │  │  Redis 7   │  │   S3       │           │
│  │  + pgvector      │  │ + BullMQ   │  │  (MinIO/   │           │
│  │  + RLS           │  │            │  │   AWS)     │           │
│  └──────────────────┘  └────────────┘  └────────────┘           │
└──────────────────────────────────────────────────────────────────┘
                        │
┌────────────────────────▼─────────────────────────────────────────┐
│             EXTERNAL INTEGRATIONS                                 │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌────┐ ┌────────┐ ┌────────┐        │
│  │OZON  │ │WB    │ │YooMP │ │TG  │ │T-Касса │ │Cloud   │        │
│  │API   │ │API   │ │API   │ │Bot │ │        │ │Payments│        │
│  └──────┘ └──────┘ └──────┘ └────┘ └────────┘ └────────┘        │
│  ┌─────────────┐ ┌──────────┐ ┌────────────┐                    │
│  │Anthropic API│ │OpenAI API│ │ Yandex GPT │  via VPN if needed │
│  └─────────────┘ └──────────┘ └────────────┘                    │
└──────────────────────────────────────────────────────────────────┘
```

## Поток обработки запроса (пример: "Сколько я потратил на рекламу в марте?")

```
1. User вводит вопрос в AI chat (Web/Tauri/RN)
2. POST /api/ai/chat → AI Orchestrator
3. Orchestrator:
   a. Загружает Working memory (последние 10 сообщений)
   b. Семантический поиск в memory_chunks (RAG, top-K=10)
   c. Загружает Procedural memory (system prompt + tools schemas)
4. Отправляет в Claude API через VPN если нужно
5. Claude вызывает tool `query_transactions`
6. Tools Layer проверяет tenant_id и право доступа
7. Drizzle делает SQL: SUM(amount) WHERE category='marketing' AND month=3
8. Результат → audit log → Claude → ответ пользователю
9. Embeddings для нового сообщения → memory_chunks
```

## Ключевые потоки данных

### 1. Inbox flow
```
Пользователь → drop файл в папку/upload
  → S3/local FS
  → worker `inbox-watcher.ts` (cron daily + fs.watch)
  → OCR (Tesseract/Vision) или Whisper для голоса
  → AI Orchestrator с tool `process_inbox_file`
  → создаются: transactions, blocks, deadlines, contacts
  → embeddings → memory_chunks
  → дайджест в Telegram/Email
```

### 2. AI-секретарь flow
```
IMAP/Telegram/etc connect → opt-in пользователя
  → worker `communications-sync.ts` (hourly)
  → fetch новых сообщений
  → извлечение сущностей (заказ, контрагент, сумма, дата)
  → embeddings → memory_chunks
  → НЕ хранится raw текст
  → создание напоминаний и связей с заказами
```

### 3. Биллинг flow
```
User выбирает тариф → POST /api/billing/checkout
  → создание payment в БД (status=pending)
  → PaymentProvider.charge() (Т-Касса основной, CloudPayments резерв)
  → редирект на checkoutUrl
  → user оплачивает
  → провайдер шлёт webhook → /api/webhooks/{provider}
  → валидация подписи → обновление subscription
  → Tenant.plan обновляется
```

### 4. Дедлайны flow
```
Любой блок может иметь deadline
  → worker `deadlines-cron.ts` (каждый час)
  → находит дедлайны в окне [now+1d, now+30d]
  → согласно reminders.daysBefore → отправляет уведомление
  → каналы: in-app, telegram, email, push
```

## Слои абстракции (важно для AI-агентов)

### Слой 1: Drizzle schemas (`src/lib/db/schema/`)
- Описание таблиц
- Типы TypeScript автогенерируются
- НЕ содержат бизнес-логики

### Слой 2: Repository (опционально, `src/lib/db/repositories/`)
- Запросы группированные по сущности
- Всегда фильтр по `tenantId`
- НЕ должны вызываться из UI напрямую

### Слой 3: Modules (`src/modules/{name}/`)
- Бизнес-логика
- Использует Repository / Drizzle
- Регистрирует виджеты и AI-tools

### Слой 4: AI Orchestrator (`src/lib/ai/`)
- Связывает LLM + Memory + Tools
- НЕ дёргает БД напрямую — только через tools
- Пишет в audit log

### Слой 5: API (`src/app/api/`)
- HTTP/tRPC endpoints
- Делегирует в modules или AI orchestrator
- Middleware: auth + tenant context

### Слой 6: UI (`src/app/`, `src/components/`)
- React Server/Client компоненты
- Использует TanStack Query для данных
- Виджеты модулей подключаются через registry

## Версионирование

- **API:** semver через `Accept-Version: 1.0` header (потом, не сразу)
- **DB schema:** Drizzle migrations с timestamp
- **Releases:** `vX.Y.Z` теги в git, синхронизация с CHANGELOG

## Развёртывание

```
Dev: docker-compose (Postgres + Redis локально)
Staging: Docker на одной VM (Yandex Cloud / Selectel)
Production:
  - PostgreSQL: managed (Yandex Cloud Postgres)
  - Redis: managed (Yandex Cloud Redis)
  - App: Next.js на Yandex Cloud Compute или Kubernetes
  - S3: Yandex Object Storage
  - CDN: Cloudflare (с РФ-серверами для статики)
  - Monitoring: Sentry + собственный Grafana
```
