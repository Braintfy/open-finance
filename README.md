# Open Finance

> **Open-source** AI-первая модульная финансовая платформа для предпринимателей. Self-hosted: данные, ключи и AI — у вас.
> Notion-style блоки + Linear UX + Claude Code минимализм + RAG-память + AI-секретарь.

[![Status](https://img.shields.io/badge/status-active-blue.svg)]() [![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

> Текущая версия — первый заголовок `## [X.Y.Z]` в [CHANGELOG.md](CHANGELOG.md) (версия в `package.json` не сопровождается).

## Что это

**Open Finance** — модульный конструктор финансов с AI-помощником, который работает поверх ВСЕХ ваших данных. Код полностью открыт (MIT): разворачиваете у себя — все функции включены, без тарифов и внешних сервисов (кроме тех, что подключаете сами: Ozon API, AI-провайдеры, SMTP).

Для личного использования — см. [`docs/PERSONAL_USE.md`](./docs/PERSONAL_USE.md) (секреты, фича-флаги, что отключить).

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

Актуальный источник правды — `package.json`; разбивка «есть / shim / план» — [`CLAUDE.md`](./CLAUDE.md#стек).

**Сейчас:**
- **Frontend:** Next.js 15 + TypeScript + Tailwind + shadcn/ui
- **DB:** PostgreSQL 16 + pgvector + Drizzle ORM
- **Auth:** свой JWT-cookie (`jose` + `bcryptjs`) — NextAuth не используется
- **AI:** Ollama / OpenAI-compat (в т.ч. Claude через VPN) / Yandex GPT / GigaChat — своя обёртка, не Vercel AI SDK
- **Таблицы/файлы:** `fast-formula-parser` + `xlsx`, `@mdxeditor/editor`, Recharts, react-grid-layout

**Пока не подключено:** Redis/BullMQ (в `src/lib/redis.ts` in-memory shim — контейнер `redis:7` в compose поднимается «на вырост»), S3-SDK для MinIO, Sentry.

**План:** Tauri 2.0 (Phase 2), React Native + Expo (Phase 3).

## Быстрый старт

```bash
# 1. Подготовить env (первый раз)
cp .env.example .env.local

# 2. Установка зависимостей
pnpm install

# 3. Запуск БД+кэш+S3 (Postgres с pgvector на 5434, Redis 6380, MinIO 9100, Adminer 8081)
pnpm docker:up

# 4. Применить схему БД
pnpm db:push

# 5. Применить init-SQL: индексы и DDL, которые drizzle-kit не умеет.
#    Автоматом при первом старте контейнера отрабатывает ТОЛЬКО 01-extensions.sql,
#    остальные (02…17) применяются вручную ВСЕГДА — см. раздел «Применение миграций БД».
for f in drizzle/init/*.sql; do
  case "$f" in */01-extensions.sql) continue;; esac
  docker exec -i openfinance-postgres psql -v ON_ERROR_STOP=1 -U openfinance_user -d openfinance_dev < "$f"
done

# 6. (Опционально) Локальный AI — Ollama. См. docs/LOCAL_AI.md
brew install ollama && brew services start ollama && ollama pull qwen2.5:7b

# 7. Dev-сервер (webpack + typedRoutes)
pnpm dev
# или быстрый Turbopack (без typedRoutes):
pnpm dev:turbo
```

Открыть [http://localhost:3000](http://localhost:3000).
Adminer (web UI для Postgres): [http://localhost:8081](http://localhost:8081) (server: `postgres`, login/db: `openfinance_user` / `openfinance_dev`).

### Порты

| Сервис | Порт | Почему не дефолтный |
|---------|------|-------------------|
| Postgres | 5434 | чтобы не конфликтовать с другими локальными PG (например `braint` на 5432) |
| Redis | 6380 | тоже во избежание конфликтов |
| MinIO API | 9100 | |
| MinIO Console | 9101 | |
| Adminer | 8081 | без конфликта с 8080 |
| Ollama (хост) | 11434 | дефолт |

## Применение миграций БД

Drizzle-схема (таблицы) применяется через `pnpm db:push`. SQL-файлы из `drizzle/init/` — индексы и DDL, которые drizzle-kit не умеет.

> **Автоматически выполняется ТОЛЬКО `drizzle/init/01-extensions.sql`** — в `docker-entrypoint-initdb.d` смонтирован ровно один этот файл (см. `docker-compose.yml`; так сделано намеренно, коммит `3f7245e`). **Все остальные `02…17-*.sql` применяются ВРУЧНУЮ, всегда** — и на свежей БД, и на работающей.

```bash
# Локально (Docker) — применить ВСЕ init-файлы кроме 01 (он уже отработал в initdb), по порядку
for f in drizzle/init/*.sql; do
  case "$f" in */01-extensions.sql) continue;; esac
  echo "== $f"
  docker exec -i openfinance-postgres psql -v ON_ERROR_STOP=1 -U openfinance_user -d openfinance_dev < "$f"
done

# Или поштучно
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/02-vector-indexes.sql

# Проверить что таблица создалась
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev -c '\d ozon_analytics_daily'

# Откатить миграцию (если нужно)
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev -c 'DROP TABLE IF EXISTS ozon_analytics_daily;'
```

Актуальный список файлов — `ls drizzle/init/` (сейчас 17: `01-extensions` … `16-workspaces`, `17-ozon-fbs-stocks`). Числа в README не перечисляем поимённо, чтобы список не протухал.

## Деплой на Ubuntu-сервер

> Production-стек: Ubuntu 22.04+, Docker (Postgres+Redis), Node.js 20+, pnpm, systemd, nginx + certbot. Приложение клонируется в `/var/www/open-finance`, БД и кэш живут в Docker.

### 1. Подготовка сервера (один раз)

```bash
# Обновление + базовые утилиты
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx ufw certbot python3-certbot-nginx

# Docker + Docker Compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

# Node.js 20 + pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pnpm

# Firewall
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

### 2. Клонирование и настройка

```bash
sudo mkdir -p /var/www/open-finance && sudo chown $USER:$USER /var/www/open-finance
git clone https://github.com/<your-org>/open-finance.git /var/www/open-finance
cd /var/www/open-finance

# Production env (заполнить секретами: DATABASE_URL, REDIS_URL, JWT_SECRET, AI keys, OZON_*, S3, SMTP, APP_URL=https://yourdomain.com)
cp .env.example .env.production
nano .env.production

# Зависимости + build
pnpm install --frozen-lockfile
pnpm build
```

### 3. Запуск БД и кэша (Docker)

```bash
pnpm docker:up                # postgres:5434, redis:6380, minio, adminer
pnpm db:push                  # таблицы через Drizzle

# SQL-индексы и DDL: initdb выполняет ТОЛЬКО 01-extensions.sql,
# остальные (02…17 и все новые) — вручную, по порядку
for f in drizzle/init/*.sql; do
  case "$f" in */01-extensions.sql) continue;; esac
  docker exec -i openfinance-postgres psql -v ON_ERROR_STOP=1 -U openfinance_user -d openfinance_dev < "$f"
done
```

### 4. systemd-сервис для Next.js

```bash
sudo tee /etc/systemd/system/open-finance.service > /dev/null <<'EOF'
[Unit]
Description=Open Finance (Next.js)
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/open-finance
EnvironmentFile=/var/www/open-finance/.env.production
ExecStart=/usr/bin/pnpm start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo chown -R www-data:www-data /var/www/open-finance
sudo systemctl daemon-reload
sudo systemctl enable --now open-finance
sudo systemctl status open-finance
```

### 5. Nginx + HTTPS

```bash
sudo tee /etc/nginx/sites-available/open-finance > /dev/null <<'EOF'
server {
    server_name yourdomain.com;
    client_max_body_size 25M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    listen 80;
}
EOF

sudo ln -sf /etc/nginx/sites-available/open-finance /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# Получить SSL (автоматически перепишет конфиг на 443)
sudo certbot --nginx -d yourdomain.com --redirect --agree-tos -m you@example.com
```

### 6. Обновление до новой версии (CI/CD рутина)

```bash
cd /var/www/open-finance
git pull origin main
pnpm install --frozen-lockfile
pnpm build

# Применить новые SQL-миграции (если в этом релизе появились в drizzle/init/)
pnpm db:push
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/<new-file>.sql

sudo systemctl restart open-finance
sudo systemctl status open-finance --no-pager
```

### 7. Бэкапы Postgres (cron)

```bash
sudo mkdir -p /var/backups/open-finance
sudo tee /etc/cron.daily/open-finance-db-backup > /dev/null <<'EOF'
#!/bin/bash
TS=$(date +%Y%m%d-%H%M%S)
docker exec openfinance-postgres pg_dump -U openfinance_user openfinance_dev \
  | gzip > /var/backups/open-finance/db-$TS.sql.gz
find /var/backups/open-finance -name 'db-*.sql.gz' -mtime +14 -delete
EOF
sudo chmod +x /etc/cron.daily/open-finance-db-backup
```

### 8. Логи и диагностика

```bash
sudo journalctl -u open-finance -f          # логи приложения
docker logs -f openfinance-postgres         # логи БД
docker logs -f openfinance-redis            # логи Redis
docker exec -it openfinance-postgres psql -U openfinance_user -d openfinance_dev   # psql shell
```

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
- [`docs/LOCAL_AI.md`](./docs/LOCAL_AI.md) — локальный AI через Ollama в dev
- [`docs/PERSONAL_USE.md`](./docs/PERSONAL_USE.md) — инструкция для личного self-hosted инстанса
- [`docs/DEPLOY_RPI5.md`](./docs/DEPLOY_RPI5.md) — деплой на Raspberry Pi 5 (фазы A-H, рутина обновления в §10)
- [`docs/LK_V2_PLAN.md`](./docs/LK_V2_PLAN.md) — план ЛК v2: воркспейсы, переработка блоков, VLESS-VPN
- [`docs/TENANT_SCOPING.md`](./docs/TENANT_SCOPING.md) — tenant-гейт `requireTenant()` (вместо Postgres RLS)
- [`docs/SECURITY_AUDIT.md`](./docs/SECURITY_AUDIT.md) — аудит безопасности, статусы находок I1-I7
- [`docs/DESKTOP_PLAN.md`](./docs/DESKTOP_PLAN.md) — план local-first десктоп-приложения (оркестрация для AI-агента)
- [`docs/DESKTOP_STRATEGY.md`](./docs/DESKTOP_STRATEGY.md) — выбор стека десктопа (Tauri vs Electron)
- [`docs/ONBOARDING.md`](./docs/ONBOARDING.md) — спецификация onboarding-визарда
- [`FEED.md`](./FEED.md) — заготовки постов для Telegram-канала
- [`CHANGELOG.md`](./CHANGELOG.md) — история изменений

## Open Source

Весь код открыт (MIT), все функции доступны без оплаты. Нюансы из SaaS-прошлого проекта:

- **Планы/биллинг** — в коде остался plan-гейт (free/trial → 1 магазин маркетплейса) и mock-биллинг. Для self-hosted задайте `FEATURE_DEFAULT_PLAN=pro` — все лимиты сняты, платёжные ключи не нужны (`FEATURE_BILLING_MOCK=true` по умолчанию).
- **Внешние сервисы опциональны** — SMTP, SmartCaptcha, Sentry, AI-ключи: пусто = выключено/fallback. AI работает локально через Ollama.
- **Десктоп (local-first)** — план отдельного Tauri-приложения: [`docs/DESKTOP_PLAN.md`](./docs/DESKTOP_PLAN.md).

Подробная инструкция для личного инстанса: [`docs/PERSONAL_USE.md`](./docs/PERSONAL_USE.md).

## Контрибьюшен

Issue и PR приветствуются. Перед PR: `pnpm typecheck && pnpm build`, правила для AI-агентов — в [`AGENTS.md`](./AGENTS.md), безопасность — [`docs/SECURITY.md`](./docs/SECURITY.md) и [`docs/TENANT_SCOPING.md`](./docs/TENANT_SCOPING.md).

## Лицензия

[MIT](./LICENSE)

---

Made with care for ИП и фрилансеров РФ.
