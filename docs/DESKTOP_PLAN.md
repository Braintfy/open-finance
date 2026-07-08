# DESKTOP_PLAN.md — local-first десктоп-приложение (оркестрация для AI-агента)

> **Назначение:** пошаговый план создания отдельного десктоп-приложения Open Finance
> (Tauri 2, local-first). Написан как **оркестрация работы AI-агента (Claude Opus)**:
> каждая фаза — самостоятельное задание с готовым промптом, входными файлами,
> критериями готовности (DoD) и командами проверки. Выполнять фазы строго по порядку,
> одна фаза = один коммит (коммитит пользователь).
>
> **Статус:** план утверждён, работа не начата. Решение по рантайму принято ранее:
> Tauri 2 (см. `docs/DESKTOP_STRATEGY.md`).

---

## 1. Продуктовая цель

Приложение для macOS/Windows/Linux, которое пользователь скачивает и запускает —
**без Docker, без сервера, без аккаунта в облаке**:

- **Все данные локально** — БД в папке приложения (`~/Library/Application Support/OpenFinance` / `%APPDATA%`).
- **Все секреты локально** — ключи Ozon/AI вводятся в UI, шифруются, мастер-ключ в OS keychain.
- **Данные подтягиваются из внешних API по сети напрямую с машины пользователя** — Ozon Seller/Performance API, курсы ЦБ, AI-провайдеры (BYOK) или локальная Ollama.
- **Single-user** — без регистрации/логина, приложение сразу открывает дашборд.
- Функциональный паритет с web-версией: блоки, маркетплейсы, unit-экономика, cashflow, AI-анализ.

## 2. Ключевые констрейнты (агенту знать обязательно)

| # | Констрейнт | Следствие |
|---|---|---|
| C1 | `next.config.mjs`: `output:'export'` (TAURI_BUILD) **убивает API routes и middleware** — а у нас 84 API-роута | Static export НЕ подходит. Решение: **Next.js standalone-сервер как sidecar-процесс** на `localhost:<random-port>`, Tauri-окно открывает его |
| C2 | БД: Postgres 16 + pgvector, весь код на Drizzle + местами raw SQL с PG-синтаксисом | Миграция на SQLite = переписывание всего data-layer. Для v1 — **embedded Postgres** (бинарь-sidecar), данные в app-data. SQLite — отдельный спайк (Фаза 0 решает) |
| C3 | Redis + BullMQ используются для sync-джобов маркетплейсов | Локально Redis нет → нужна in-process замена очереди (или embedded redis-совместимый). Инвентаризация — Фаза 0 |
| C4 | MinIO/S3 — файлы Inbox | Заменить на локальную ФС-папку через storage-адаптер |
| C5 | Мультитенантность + auth (JWT cookie) во всех запросах | Не выпиливать: **desktop-режим = авто-provision одного tenant+user + авто-сессия**. Tenant-скоуп (`docs/TENANT_SCOPING.md`) сохраняется как есть |
| C6 | Бизнес-логика уже в `src/lib/` (правило из `docs/DESKTOP_STRATEGY.md`) | Переиспользуем; desktop-специфику класть в `src/lib/desktop/` и `apps/desktop/` |
| C7 | Проект open source (MIT), лицензирование Tauri-версии из `docs/LICENSING.md` **не применяется** | Никаких license-чеков в десктопе |

## 3. Целевая архитектура (v1)

```
┌─────────────────────────────── Tauri 2 (Rust shell) ───────────────────────────────┐
│  • окно WebView → http://localhost:<port>                                          │
│  • lifecycle: старт/стоп сайдкаров, single-instance, tray                          │
│  • OS keychain (мастер-секреты)  • auto-updater  • deep links                      │
└───────────────┬──────────────────────────────┬─────────────────────────────────────┘
                │ spawn                        │ spawn
                ▼                              ▼
   Next.js standalone (Node sidecar)   Embedded Postgres 16 + pgvector (sidecar)
   • все 84 API-роута как есть         • PGDATA в app-data юзера
   • DESKTOP_MODE=1:                   • порт локальный, пароль генерится
     – авто-сессия single-user         • pg_dump бэкапы по расписанию
     – очередь in-process (без Redis)
     – Inbox-файлы на ФС (без S3)
                │ по сети (ключи юзера, из локальной БД)
                ▼
   Ozon API · ЦБ РФ · Anthropic/OpenAI (BYOK) · Ollama (localhost)
```

## 4. Правила работы агента (каждая фаза)

1. Прочитай `AGENTS.md`, `MEMORY.md`, файлы из «Читать перед стартом» фазы.
2. Не ломай web/SaaS-режим: desktop-ветвления только через `env.DESKTOP_MODE` / адаптеры.
3. Проверка перед сдачей: `pnpm typecheck && pnpm build` (web) + команды фазы.
4. Обнови `CHANGELOG.md` (MINOR на фазу) и раздел «Лог» этого файла (внизу).
5. Git-команды НЕ выполнять — только предложить коммит-сообщение пользователю.
6. БД/установочные команды (`pnpm db:*`, `brew install`, `cargo`, downloads) — предлагать пользователю, не запускать молча.
7. Если находишь противоречие плана с кодом — остановись и опиши проблему, не импровизируй.

---

## 5. Фазы

### Фаза 0 — Discovery + ADR (решения до кода)

**Цель:** снять неопределённости C2/C3, зафиксировать архитектурные решения письменно.

**Промпт для Опуса:**
> Прочитай `docs/DESKTOP_PLAN.md` (весь), `docs/DESKTOP_STRATEGY.md`, `next.config.mjs`, `docker-compose.yml`, `src/lib/env.ts`, `src/lib/db/index.ts`, `package.json`.
> Составь `docs/desktop/ADR-001-runtime.md` с решениями по четырём вопросам, для каждого: варианты, trade-offs, рекомендация, объём работ:
> 1. **БД:** embedded Postgres (какой дистрибутив-бинарь: postgresql-portable / embedded-postgres / zonky) vs миграция на SQLite+sqlite-vec. Проверь фактическое использование PG-специфики: `grep -rn "sql\`" src/lib | wc -l`, pgvector (`memory_chunks`), `jsonb`, `generated`, оконные функции.
> 2. **Очередь:** найди все места BullMQ/Redis (`grep -rn "bullmq\|ioredis\|redis" src --include="*.ts" -l`), предложи in-process замену (p-queue + интервальные джобы) за общим интерфейсом `src/lib/queue/adapter.ts`.
> 3. **Node sidecar:** как паковать standalone Next (`output:'standalone'`) + Node runtime в Tauri sidecar для mac/win/linux; замерь размер.
> 4. **Секреты:** tauri-plugin-keyring vs stronghold; схема: мастер-ключи (`NEXTAUTH_SECRET`, `INBOX_SECRET_KEY`, `MARKETPLACE_SECRET_KEY`, PG-пароль) генерятся при первом запуске → keychain → передаются сайдкару через env при spawn.
> Код НЕ пиши. Результат — только ADR-документ с финальными рекомендациями.

**Читать перед стартом:** перечислено в промпте.
**DoD:** `docs/desktop/ADR-001-runtime.md` существует, по всем 4 вопросам есть однозначная рекомендация + оценка объёма; противоречий с констрейнтами C1–C7 нет.
**Проверка:** ручное ревью ADR пользователем → правки плана Фаз 2–4 при необходимости.

### Фаза 1 — Каркас Tauri 2 поверх dev-сервера

**Цель:** открывающееся десктоп-окно с текущим приложением (пока против `pnpm dev`).

**Промпт для Опуса:**
> Создай Tauri 2 каркас в `apps/desktop/` (Rust `src-tauri`): окно 1280×800 (min 1024×700), title «Open Finance», single-instance, macOS traffic lights. В dev-режиме окно грузит `http://localhost:3000` (существующий `pnpm dev`). Добавь скрипты в корневой `package.json`: `desktop:dev` (конкурентный запуск next dev + tauri dev), `desktop:build` (пока заглушка с TODO). Иконки — временные из букв OF (сгенерируй через `tauri icon`). Не трогай `next.config.mjs` и web-код. Задокументируй запуск в `apps/desktop/README.md`.

**Читать перед стартом:** `docs/desktop/ADR-001-runtime.md`, Tauri 2 docs (`https://v2.tauri.app/start/`).
**DoD:** `pnpm desktop:dev` открывает нативное окно с приложением; web-режим (`pnpm dev`, `pnpm build`) не изменился.
**Проверка:** `pnpm desktop:dev` (пользователь, требует `cargo`); `pnpm typecheck && pnpm build`.

### Фаза 2 — Сайдкары: standalone Next + embedded Postgres

**Цель:** приложение работает без внешних зависимостей (Docker/терминала).

**Промпт для Опуса:**
> По ADR-001 реализуй запуск двух сайдкаров из Tauri (Rust): (1) embedded Postgres с PGDATA в app-data (`dirs::data_dir()/OpenFinance/pg`), порт свободный случайный, пароль из keychain; при первом запуске — `initdb` + применение `drizzle/init/*.sql` и drizzle-миграций (программно, `src/lib/db/migrate.ts`); (2) Next standalone (`next build && output:'standalone'`) на случайном порту, env передаётся при spawn: `DATABASE_URL` (локальный PG), `DESKTOP_MODE=1`, секреты из keychain. Окно ждёт health-check `GET /api/health` и открывает URL. Останов сайдкаров при выходе (graceful, pg_ctl stop). Добавь `desktop:build` собирающий всё в бандл. Порядок инициализации и структуру app-data задокументируй в `apps/desktop/README.md`.

**Читать перед стартом:** ADR-001, `src/lib/db/`, `drizzle/`, `src/app/api/health/route.ts`, `README.md` §Быстрый старт.
**DoD:** на чистой машине (без Docker/Postgres) `desktop:build`-бандл запускается, создаёт БД, открывает приложение; повторный запуск переиспользует данные; выход не оставляет процессов-сирот.
**Проверка:** `pnpm desktop:build` + ручной smoke на маке пользователя; `ps aux | grep -E 'postgres|node'` после выхода — пусто.

### Фаза 3 — Desktop-режим: single-user + секреты в keychain

**Цель:** без логина; мастер-секреты не в файлах.

**Промпт для Опуса:**
> Введи `DESKTOP_MODE` в `src/lib/env.ts` (boolean, default false). При `DESKTOP_MODE=1`: (1) на первом запуске сервер авто-создаёт tenant «Local» + user `local@desktop` (plan `pro`, consent авто) если их нет — вынеси в `src/lib/desktop/provision.ts`, вызов из `instrumentation.ts`; (2) middleware выдаёт авто-сессию этого юзера вместо редиректа на `/login` (сессия обычным JWT — `NEXTAUTH_SECRET` уже из keychain); (3) лендинг `/` редиректит на `/app/dashboard`; страницы `/login|/register|/forgot-password` недоступны (redirect); (4) rate-limit auth и captcha пропускаются. Tenant-скоуп в роутах НЕ меняется (guards работают как раньше). В Tauri добавь генерацию мастер-секретов при первом старте (`openssl`-эквивалент в Rust, 48 байт base64) и хранение в keychain (по ADR-001); ключи Ozon/AI продолжают жить зашифрованными в локальной БД (`MARKETPLACE_SECRET_KEY` из keychain).

**Читать перед стартом:** `src/middleware.ts`, `src/lib/auth/{session,actions}.ts`, `src/instrumentation.ts`, `src/lib/security/assert-secrets.ts`, `docs/TENANT_SCOPING.md`.
**DoD:** первый запуск открывает дашборд без логина; секреты отсутствуют в файлах (только keychain); web-режим без `DESKTOP_MODE` не изменён (login-флоу как раньше); `pnpm check:tenant-isolation` проходит.
**Проверка:** smoke в бандле; в web: `pnpm typecheck && pnpm build` + ручной прогон `/login`.

### Фаза 4 — Очередь без Redis + Inbox на ФС + sync по сети

**Цель:** полный цикл «добавил ключи Ozon в UI → синк → блоки с данными» локально.

**Промпт для Опуса:**
> (1) По ADR-001 сделай `src/lib/queue/adapter.ts` с интерфейсом (add/process/progress/repeatable) и двумя реализациями: BullMQ (как сейчас, web) и in-process (desktop: p-queue + setInterval-шедулер, персист статуса джоба в существующую таблицу `ozon_sync_jobs`). Переключение по `DESKTOP_MODE`. Мигрируй всех потребителей BullMQ на адаптер. (2) Storage-адаптер для Inbox: S3 (web) / локальная папка `app-data/OpenFinance/inbox` (desktop) — за интерфейсом `src/lib/storage/adapter.ts`. (3) Проверь, что Ozon-клиент и клиент курсов ЦБ работают из десктопа (обычный fetch, ключи из локальной БД). Рестарт приложения посреди синка не должен вешать джоб навсегда (stale-таймаут).

**Читать перед стартом:** ADR-001 §очередь, `src/lib/marketplaces/ozon/`, все файлы с `bullmq|ioredis`, `src/lib/inbox/`.
**DoD:** в desktop-бандле: добавление Ozon-аккаунта → синк проходит все стадии → KPI/аналитика отображаются; web-режим продолжает использовать BullMQ/S3; typecheck/build зелёные.
**Проверка:** smoke с реальными ключами Ozon (пользователь); `pnpm typecheck && pnpm build`.

### Фаза 5 — AI локально: Ollama-детект + BYOK

**Цель:** AI работает out-of-the-box (Ollama) или по ключу пользователя.

**Промпт для Опуса:**
> В desktop-режиме: (1) авто-детект Ollama на `localhost:11434` при старте и в настройках AI (кнопка «Проверить»); если есть — `AI_DEFAULT_PROVIDER=ollama` по умолчанию; (2) BYOK-ключи (Anthropic/OpenAI/Yandex) — существующий UI `/app/settings` + `ai/credentials`, убедись что работает без облачных env; (3) если AI недоступен — graceful: блоки работают, AI-кнопки показывают подсказку «Подключите AI в настройках» (см. паттерн `AI_MOCK_ENABLED`); (4) добавь в онбординг десктопа (первый запуск) шаг выбора AI: Ollama (рекомендация с ссылкой на установку) / свой ключ / позже.

**Читать перед стартом:** `docs/LOCAL_AI.md`, `src/lib/ai/providers/`, `src/app/api/ai/credentials/route.ts`.
**DoD:** на машине с Ollama — AI-чат и анализ блоков работают без единого ключа; без Ollama и ключей — UI деградирует без ошибок.
**Проверка:** smoke два сценария (с/без Ollama); `pnpm typecheck && pnpm build`.

### Фаза 6 — Packaging, updater, CI

**Цель:** устанавливаемые артефакты + автообновления.

**Промпт для Опуса:**
> (1) Финальные иконки (из `public/` логотипа), метаданные бандла, категория Finance. (2) Цели: macOS `.dmg` (aarch64 + x86_64), Windows `.msi` (NSIS), Linux `.AppImage`+`.deb`. (3) Tauri auto-updater: манифест на GitHub Releases, подпись updater-ключом (ключ генерит пользователь, в CI — секрет). (4) GitHub Actions workflow `desktop-release.yml`: тег `desktop-v*` → матрица сборок → draft release с артефактами. (5) Код-подпись: для macOS — задокументируй шаги с Apple Developer ID (без сертификата — инструкция про Gatekeeper right-click open), Windows — без подписи с предупреждением SmartScreen. Задокументируй релизный процесс в `apps/desktop/RELEASING.md`.

**Читать перед стартом:** Tauri 2 docs: bundler, updater, GitHub Action.
**DoD:** workflow собирает все артефакты на тег; updater видит новую версию и обновляется (проверка на двух подряд тегах); `RELEASING.md` полон.
**Проверка:** тестовый тег `desktop-v0.0.1-alpha` в форке/ветке (пользователь).

### Фаза 7 — QA-гейт и первый релиз

**Цель:** воспроизводимый чек-лист качества → `desktop-v0.1.0`.

**Промпт для Опуса:**
> Составь и прогони `apps/desktop/QA.md`: чистая установка (mac/win), первый запуск <10с до дашборда, оффлайн-старт (без сети приложение открывается, sync даёт понятную ошибку), добавление Ozon-ключей + полный синк, AI через Ollama, бэкап/восстановление папки данных, обновление с предыдущей версии (миграции БД), удаление приложения (что остаётся в app-data — задокументировать), потребление RAM idle < 400MB суммарно. Все падения — фиксы отдельными пунктами с регрессионной проверкой. По зелёному чек-листу — предложи релиз `desktop-v0.1.0`.

**DoD:** QA.md полностью зелёный на macOS (минимум) + Windows (желательно); известные ограничения задокументированы в README десктопа.
**Проверка:** ручной прогон QA.md пользователем.

---

## 6. Что осознанно НЕ входит в v1

- Sync локальной БД с облачным инстансом (конфликт-резолюшн) — v2, после спроса.
- Мобильная версия (Tauri Mobile / React Native) — отдельный план.
- COM-интеграции Excel/1С (Electron-fork сценарий из `docs/DESKTOP_STRATEGY.md`) — по опросу пользователей.
- Многопользовательский режим на десктопе.
- Лицензирование/платные фичи (`docs/LICENSING.md`) — проект open source, не применяется.

## 7. Лог выполнения

| Дата | Фаза | Результат | Коммит |
|---|---|---|---|
| — | — | План создан, работа не начата | — |
