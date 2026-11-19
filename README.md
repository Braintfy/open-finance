# Open Finance

Приватный self-hosted хаб продавца на маркетплейсах: Ozon, Wildberries, юнит-экономика, налоги, остатки, продажи с сайтов. Данные, ключи и AI-провайдеры остаются у владельца. Код открыт под лицензией MIT.

Текущая версия — первый заголовок `## [X.Y.Z]` в [CHANGELOG.md](CHANGELOG.md). Проект активно меняется и пока ближе к рабочему инструменту одного владельца, чем к готовому продукту «из коробки».

## Цель и статус

С 2026-11-17 канон цели описан в [docs/HUB_PLAN.md](docs/HUB_PLAN.md): один продавец, один сервер в локальной сети (мини-ПК или Mac), вход по паролю, регистрации нет. Раньше проект задумывался как публичный multi-tenant SaaS. От этого остались регистрация, биллинг-заглушка и часть кода, подлежащая удалению (см. HUB_PLAN). Описанное в старых документах про публичный запуск, Tauri и мобильное приложение не реализуется.

### Что работает сейчас

- **Ozon.** Синхронизация товаров, цен, заказов (FBO и FBS), остатков (в том числе FBS по своим складам), отчёта о реализации, начислений (`/v1/finance/accrual`), рекламы (Performance API) и аналитики. Методы сверены с живым API в ноябре 2026. Ежедневный запуск — `scripts/sync-ozon-daily.ts`, его нужно поставить в планировщик (пример systemd-таймера — `deploy/ozon-sync/`).
- **Аналитика Ozon.** Работает, но расчёты неполные. Прибыль пока считается без части удержаний, а формулы одной метрики местами расходятся. Это известная проблема, она описана в HUB_PLAN (раздел 3).
- **Калькуляторы юнит-экономики** (Ozon, Яндекс Маркет): комиссии, логистика, налоги, выкуп, актуальные тарифные паки.
- **Cashflow:** банковские операции и транзакции.
- **Склад, поставки, себестоимость:** партии, скользящая средняя, проведение и сторно документов, импорт из Ozon, сопоставление SKU. Модуль свежий и пока в стадии каркаса.
- **AI-помощники:** чат и анализ внутри страниц и блоков. Провайдеры: Ollama, OpenAI-совместимые, YandexGPT, GigaChat, mock. AI необязателен: без него всё остальное работает.
- **Блочный дашборд** (BlockGrid): конструктор для сводной страницы.
- **Почта (IMAP) и распознавание чеков:** работает, но заморожено и не развивается.

### Что запланировано

- **Слой метрик:** единый источник расчётов (журнал проводок, дневные факты, сверка с выплатами). В коде уже лежат чистые модули, дизайн в [docs/METRICS_LAYER_DESIGN.md](docs/METRICS_LAYER_DESIGN.md).
- **Wildberries:** пока отсутствует, кроме значения `wb` в типах.
- **Налоги:** страницы нет.
- **Продажи с сайтов:** коннектора нет, на складе заведены только места `site_*`.
- Переход новых разделов с блоков на обычные страницы, уборка заглушек AI-оркестратора.

## Стек

Единственный источник правды по зависимостям — `package.json`.

- Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Recharts
- PostgreSQL 16 + pgvector, Drizzle ORM
- Своя аутентификация: JWT в cookie (`jose` + `bcryptjs`); NextAuth не используется
- Своя обёртка над AI-провайдерами (не Vercel AI SDK)
- Менеджер пакетов: pnpm, Node.js 20 или новее

Redis и MinIO поднимаются в Docker Compose «на вырост», но приложение к ним сейчас не обращается: кэш и rate-limit работают в памяти процесса, S3-клиента в зависимостях нет.

## Быстрый старт

Нужны Node.js 20+, pnpm и Docker.

```bash
# 1. Зависимости
pnpm install

# 2. Конфигурация (секреты только здесь, файл вне git)
cp .env.example .env.local
# Откройте .env.local и задайте как минимум:
#   NEXTAUTH_SECRET, INBOX_SECRET_KEY, MARKETPLACE_SECRET_KEY
# Сгенерировать значение: openssl rand -base64 48

# 3. База данных (Postgres 16 + pgvector на 127.0.0.1:5434)
docker compose --env-file .env.local up -d postgres

# 4. Схема БД
pnpm db:migrate

# 5. Дополнительный SQL (индексы и DDL, которые drizzle-kit не умеет).
#    При первом старте контейнера автоматически применяется только 01-extensions.sql,
#    остальные файлы применяются вручную, по порядку:
for f in drizzle/init/*.sql; do
  case "$f" in */01-extensions.sql) continue;; esac
  docker exec -i openfinance-postgres psql -v ON_ERROR_STOP=1 -U openfinance_user -d openfinance_dev < "$f"
done

# 6. Администратор (см. ниже)
pnpm admin:create you@example.com 'надёжный-пароль' --admin

# 7. Запуск
pnpm dev
```

Откройте http://localhost:3000.

Имя пользователя и базы в шаге 5 соответствуют значениям по умолчанию из `docker-compose.yml`. Если вы меняли `POSTGRES_USER` или `POSTGRES_DB`, подставьте свои.

Подробности про миграции и починку журнала: скил `of-db-migrate` (`.claude/skills/of-db-migrate/SKILL.md`) и [docs/DEPLOY_RPI5.md](docs/DEPLOY_RPI5.md).

### Администратор

```bash
# создать пользователя (флаг --admin даёт права администратора, --super-admin — суперадмина)
pnpm admin:create <email> <пароль> [--admin|--super-admin]

# сбросить пароль существующего
pnpm admin:reset-password <email>            # сгенерировать и показать новый пароль
echo -n 'пароль' | pnpm admin:reset-password <email> --stdin   # задать свой
pnpm admin:reset-password --list             # список пользователей
```

Пароль не короче 8 символов. Скрипты читают `DATABASE_URL` из `.env.local`. Пароль аргументом командной строки остаётся в истории оболочки, поэтому для своего пароля используйте `--stdin`. Регистрация через сайт по умолчанию выключена (`FEATURE_OPEN_REGISTRATION`), пользователей создаёт владелец.

### Подключение Ozon

Ключи Ozon (Client-Id и Api-Key, ключ Performance API для рекламы) вводятся в интерфейсе: «Настройки → Интеграции». В базе они хранятся в зашифрованном виде, ключ шифрования берётся из `MARKETPLACE_SECRET_KEY`. Меняйте этот ключ осознанно: он нужен для расшифровки уже сохранённых данных (для перешифровки есть `pnpm admin:reencrypt-secrets`).

### AI (необязательно)

Локально: Ollama (`OLLAMA_BASE_URL`, модель задаётся в `.env.local`), см. [docs/LOCAL_AI.md](docs/LOCAL_AI.md). Внешние провайдеры: ключи в `.env.local`, при необходимости прокси ([docs/VPN_FOR_AI.md](docs/VPN_FOR_AI.md)). Для проверки интерфейса без ключей есть mock-провайдер (`AI_MOCK_ENABLED`).

### Порты по умолчанию

| Сервис | Порт |
|---|---|
| Приложение | 3000 |
| Postgres | 5434 |
| Redis | 6380 |
| MinIO API / консоль | 9100 / 9101 |

Все сервисы Compose слушают только `127.0.0.1`.

## Команды

```bash
pnpm dev                 # dev-сервер
pnpm build               # production-сборка
pnpm typecheck           # проверка типов
pnpm lint                # ESLint
pnpm db:generate         # сгенерировать миграцию из схемы
pnpm db:migrate          # применить миграции
pnpm db:studio           # GUI для БД
pnpm tsx scripts/test-<имя>.ts   # smoke-тест (тест-раннера нет, скрипты самостоятельные)
```

Тестов через vitest или jest нет: каждый `scripts/test-*.ts` запускается отдельно и завершается с кодом 1 при падении.

## Структура проекта

```
src/
  app/            # маршруты Next.js: страницы (app/app/**), API (app/api/**), вход (app/(auth))
  components/     # UI-компоненты по доменам
  lib/
    marketplaces/ # Ozon: клиент, синк, маппинг, upsert
    unit-economics/ # калькуляторы и тарифы
    stock/        # склад, поставки, себестоимость
    cashflow/     # банк и транзакции
    metrics/      # слой метрик (чистые модули, в разработке)
    blocks/       # конструктор блоков для сводной
    ai/           # провайдеры, vision, чат, tools (каркас)
    auth/         # JWT-сессии, гварды tenant
    db/           # схема Drizzle
    inbox/        # почта и распознавание чеков
drizzle/          # миграции и init-SQL
scripts/          # CLI: админ, синк, smoke-тесты
docs/             # документация
deploy/           # юниты и скрипты сервера: автосинк Ozon, бэкап, VPN для AI (xray), консоль состояния
```

Принципы: плоская структура, явные импорты, никакой магии (декораторов, DI). Идентификатор арендатора (`tenant_id`) есть в таблицах и берётся только из сессии, это исторически сложившаяся модель изоляции ([docs/TENANT_SCOPING.md](docs/TENANT_SCOPING.md)).

## Документация

| Файл | О чём |
|---|---|
| [docs/HUB_PLAN.md](docs/HUB_PLAN.md) | цель, карта проекта, архитектура и этапы (канон) |
| [docs/METRICS_LAYER_DESIGN.md](docs/METRICS_LAYER_DESIGN.md) | дизайн слоя метрик |
| [docs/STOCK_MODULE_DESIGN.md](docs/STOCK_MODULE_DESIGN.md) | склад, поставки, себестоимость |
| [docs/UNIT_ECONOMICS_TABS.md](docs/UNIT_ECONOMICS_TABS.md) | вкладки юнит-экономики |
| [docs/MARKETPLACES_OZON_PERFORMANCE.md](docs/MARKETPLACES_OZON_PERFORMANCE.md) | Ozon Performance API |
| [docs/LOCAL_RUN.md](docs/LOCAL_RUN.md) | локальный запуск на ПК |
| [docs/DEPLOY_RPI5.md](docs/DEPLOY_RPI5.md) | деплой на Raspberry Pi 5 (прежний сервер) |
| [docs/BACKUP_RESTORE.md](docs/BACKUP_RESTORE.md) | бэкап и восстановление |
| [docs/SECURITY.md](docs/SECURITY.md) | правила работы с секретами и сетью |
| [docs/AI_TOOLS.md](docs/AI_TOOLS.md) | реестр AI-инструментов |
| [docs/PAGE_PERIODS.md](docs/PAGE_PERIODS.md) | система периодов страниц |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | карта архитектуры (часть блоков — план) |
| [CHANGELOG.md](CHANGELOG.md) | история версий |

Документы про SaaS-запуск, биллинг и десктоп ([docs/BILLING.md](docs/BILLING.md), [docs/DESKTOP_PLAN.md](docs/DESKTOP_PLAN.md), [docs/ROADMAP_V2.md](docs/ROADMAP_V2.md)) отражают прежний курс и сохранены как история.

В репозитории есть `CLAUDE.md`, `AGENTS.md`, `START.md`, `MEMORY.md` и каталог `.claude/`: это правила и память для AI-агентов, которые ведут разработку. Для запуска проекта они не нужны.

## Безопасность

- Секреты (`.env.local`, ключи API, пароли, токены) хранятся только на вашей машине и никогда не коммитятся. `.env.local` в `.gitignore`.
- Значения в `.env.example` являются заглушками для локальной разработки. Перед любым развёртыванием вне своей машины замените все пароли и ключи.
- Не открывайте приложение в интернет без защищённого канала (VPN, обратный прокси с аутентификацией). Модель проекта рассчитана на доступ из закрытой сети.
- Ключи маркетплейсов и почты шифруются в базе; не теряйте `MARKETPLACE_SECRET_KEY` и `INBOX_SECRET_KEY`.
- О найденных уязвимостях сообщайте приватно: через GitHub Security Advisories («Report a vulnerability» на вкладке Security репозитория), не публичным issue. Публичное описание уязвимости до исправления просим не размещать.

Подробнее: [docs/SECURITY.md](docs/SECURITY.md), [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md).

## Участие в разработке

Проект ведётся в первую очередь под нужды одного владельца, но issue и pull request приветствуются.

1. Откройте issue с описанием проблемы или идеи до крупного изменения.
2. Перед PR прогоните `pnpm typecheck`, `pnpm lint` и релевантные `scripts/test-*.ts`.
3. Соблюдайте ограничения: Drizzle (не Prisma), pnpm (не npm/yarn), явные импорты, новый файл начинается с комментария `// PURPOSE: ...`, запросы к БД фильтруются по `tenant_id` из сессии.
4. Миграции БД не применяйте автоматически, опишите их в PR.
5. Не добавляйте в коммиты секреты и реальные бизнес-данные.

## Лицензия

MIT, см. файл [LICENSE](LICENSE). Автор в файле указан как «Open Finance contributors».
