# MEMORY.md — Open Finance

## Что это
**Open Finance** — AI-первая модульная финансовая платформа.
- **SaaS** (Next.js) + **Local-First** (Tauri 2.0)
- Multi-tenant, RLS, RAG-память на pgvector
- Главный AI работает поверх ВСЕХ данных пользователя

## Аудитория
ИП, селлеры маркетплейсов (OZON/WB/Я.Маркет), фрилансеры, малый бизнес РФ.

## Тарифы
- **Free** — безлимитная история, 1 источник, базовые виджеты + Excel-блоки
- **Trial Pro** — 14 дней бесплатно после регистрации (без карты)
- **Pro 690 ₽/мес** — все модули, AI, налоги, прогнозы
- **Business 2 490 ₽/мес** — + 5 пользователей, API
- **Enterprise 6 990 ₽/мес** — безлимит, SLA
- **Local Lifetime 9 990 ₽** разово / **Subscription 990 ₽/мес**

## Ключевые фичи
1. **Модульный конструктор** — пользователь собирает свой дашборд из блоков
2. **Excel-like блоки** — мини-spreadsheet с формулами + шаблоны
3. **AI-первая архитектура** — RAG (pgvector) + Tools Layer + Audit log
4. **Inbox для AI** — drop-папка, AI ежедневно парсит файлы и создаёт сущности
5. **AI-секретарь** — email/TG/WA/VK для понимания контекста и связей
6. **Налоги РФ нативно** — все режимы (УСН/НДС/ПСН/НПД/АУСН/ОСНО)
7. **Дедлайны на любом блоке** — Notion-style, единый календарь
8. **AI-агенты с скилами** — Phase 2, пользователь создаёт «отдел»
9. **Счётчик токенов** — контроль трат, защита от перерасхода
10. **VPN-надстройка** — для работы с зарубежными AI API из РФ

## Архитектура (главное)
- **ORM:** Drizzle (НЕ Prisma)
- **DB SaaS:** PostgreSQL 16 + pgvector
- **DB Local:** SQLite + sqlite-vec
- **AI Provider:** Claude через VPN, OpenAI резерв, Yandex GPT/GigaChat без VPN
- **AI Orchestrator:** своя обёртка (не Vercel AI SDK)
- **Embeddings:** OpenAI text-embedding-3-small (1536) или Ollama nomic-embed
- **Multi-tenant:** RLS через `enableRLS()`, `tenant_id` везде

## Дизайн
- **Светлая тема по умолчанию** + тёмная опция через CSS-переменные
- **Мышь + drag-n-drop** по умолчанию, keyboard shortcuts опционально
- **Минимализм** — Inter + JetBrains Mono, 4px grid

## Файлы конвенций для AI
- `CLAUDE.md` — правила для Claude Code
- `AGENTS.md` — правила для любого AI-агента
- `docs/SECURITY.md` — обязательное чтение про секреты/утечки
- `docs/BILLING.md` — реализация Т-Касса/CloudPayments
- `docs/LICENSING.md` — лицензирование Tauri-версии

## Связь с другими проектами
- `/Users/firay/open-finance/` — локальная версия (personal use, старый код)
- `/Users/firay/NALOG/` — алгоритмы налогов для миграции в `modules/taxes/`

## Текущий статус (v0.9.19)
- Фаза: **AI Micro-Agent + External Providers + VPN/Diagnostics**
- Готово: auth, cashflow CRUD, Block-Grid (drag/resize/persist), Block Relationships (обновлённый список связей + выбор field/cell), Cmd+K Command Palette, Chart block, mindmap overlay, cross-page pins, custom data block, sheet block (Excel-формулы + @Блок picker + копейки), excel.cell block (`@связать` в настройках), **AI Micro-Agent** (модалка + блок + block-capabilities + streaming + token counter + stop + chat-capable filter), **AI Providers Hub** (OpenAI/Claude/OpenRouter/VseGPT external + HTTP-proxy через undici + diagnostics)
- Block catalog: `stat.income`, `stat.expense`, `stat.balance`, `stat.custom`, `top-categories`, `transactions`, `sheet`, `excel.cell`, `navigate.card`, `computed.sum`, `custom.data`, `chart.cashflow`, `ai.micro-agent`
- AI runtime:
  - `/api/ai/chat` — NDJSON streaming, auto-routes Ollama vs External (по `tenant.settings.aiExternal.enabled`)
  - **Local (Ollama):** chat-capable filter, fallback на установленную chat-модель, не embedding
  - **External:** `streamOpenAICompat` (OpenAI-compat /v1/chat/completions с SSE), proxy через undici ProxyAgent
  - **HF pull:** `parseHuggingFaceUrl` → `hf.co/user/repo:Q4_K_M`
- Admin pages:
  - `/admin/ai/local-models` — каталог по 7 категориям + HuggingFace input + установленные/в памяти + детали
  - `/admin/ai/providers` — диагностика + внешний API (5 пресетов) + прокси (HTTP/HTTPS) + test connection
  - `/admin/ai/system-prompt` — общий system prompt для tenant'а
- Tenant settings JSONB: `aiProvider`, `aiModel`, `aiSystemPrompt`, `aiExternal{provider,baseUrl,apiKey,defaultModel,useProxy}`, `aiProxy{url,type,username,password}`
- Каталог моделей: 19 моделей в категориях (chat-tiny / chat-light / chat-medium / chat-heavy / vision / code / embedding)
- Следующий шаг: AES-256-GCM шифрование секретов, Whisper transcription, Cmd+K AI action, create_block on apply, RAG memory

## Команды
```bash
pnpm install
pnpm docker:up      # Postgres+Redis
pnpm db:push        # Применить schema (dev)
pnpm dev            # Next.js
```
