# DEPLOY_RPI5.md — деплой Open Finance на Raspberry Pi 5 (16GB)

> Канонический план прод-деплоя на собственный минисервер Raspberry Pi 5 (16GB RAM, ARM64).
> Составлен 2026-08-06 по результатам мультиагентного аудита репозитория (v0.47.1).
> **Роли:** пользователь прошивает ОС и передаёт доступы; настройку, деплой и обновления выполняет Claude по SSH (оркестрация — Fable, исполнение — субагенты Opus 5). Жёсткие правила CLAUDE.md действуют и на сервере: git-команды и миграции — только с подтверждения.

## 0. Итоговая архитектура

```
Интернет ──TLS──> nginx (:443) ──> next start (:3000, ОДИН процесс, systemd)
                                        │
                                        ├─> Postgres 16 + pgvector (Docker, 127.0.0.1:5434, данные на SSD)
                                        ├─> HTTP-прокси для AI (Xray http-inbound 127.0.0.1:10809, systemd) ──VPN──> api.anthropic.com / api.openai.com
                                        └─> (опц.) Ollama (:11434, qwen2.5:3b, офлайн-подстраховка)
```

Redis, MinIO, Adminer из docker-compose **НЕ поднимаем**: код их не использует (`src/lib/redis.ts` — in-memory заглушка, S3-клиента нет; Adminer в проде — дыра). Фоновых воркеров в проекте нет — весь рантайм это один процесс `next start`.

## 1. Что нужно от пользователя (чеклист данных)

- [ ] ОС прошита: **Raspberry Pi OS Lite (64-bit!)**, SSH включён. 32-битная ОС не подойдёт (нет `@next/swc-linux-arm*` под armv7).
- [ ] IP Pi в локальной сети + логин/пароль (или ключ) SSH.
- [ ] **VPN для AI:** подписка/конфиг (bvpn.cc VLESS-ссылка из docs/VPN_FOR_AI.md, либо WireGuard-конфиг своего VPS) — что есть.
- [ ] **Домен и способ доступа** (решение): (а) публичный домен + порт-форвардинг 80/443 на роутере + certbot; (б) Cloudflare Tunnel (без открытия портов); (в) только LAN + свой CA (mkcert). Для (а)/(б) — домен/поддомен. HTTPS обязателен в любом варианте: прод-cookie `secure: true`, по HTTP вход не работает.
- [ ] (Опц.) SSD: NVMe HAT или USB3-SSD — сильно рекомендуется, Postgres на microSD деградирует.
- [ ] (Опц.) SMTP-креды (Beget) для писем сброса пароля; иначе письма падают в логи сервера.
- [ ] (Опц.) SmartCaptcha: для прод-домена нужен **отдельный** ресурс капчи в Yandex Cloud (ключ привязан к доменам). Для личного инстанса с закрытой регистрацией можно не включать (пустые ключи = капча выключена).

## 2. Фаза A — фиксы в репо ДО деплоя (на dev-машине)

Найдены аудитом, без них деплой сломается или прокси не заработает:

1. **`pnpm add undici`** — БЛОКЕР: AI-прокси реализован через `undici.ProxyAgent` (`src/lib/ai/providers/proxy.ts`), но пакета нет в зависимостях → при включении прокси любой внешний AI-запрос падает «Пакет undici не установлен».
2. **docker-compose: монтировать только `01-extensions.sql`** — БЛОКЕР первого запуска: сейчас в `/docker-entrypoint-initdb.d` монтируется весь `drizzle/init/`, и на пустом volume контейнер падает (`03-boards.sql` → `relation "tenants" does not exist`, exit 3). Заменить на `- ./drizzle/init/01-extensions.sql:/docker-entrypoint-initdb.d/01-extensions.sql:ro`.
3. (Желательно) `/api/health` — сейчас статичный JSON с захардкоженной версией '0.4.0' без проверки БД; сделать реальный чек Postgres для мониторинга.
4. (Желательно) `failStaleSyncJobs` добивает только `pending`; job, убитый рестартом в `running`, висит вечно — расширить на `running` старше N минут.

## 3. Фаза B — базовая настройка Pi (по SSH)

1. `apt update && apt full-upgrade`, `timedatectl set-timezone Europe/Moscow`, проверить NTP (код считает МСК фиксированным UTC+3 — часы должны быть точными).
2. SSH-hardening: ключи, `PasswordAuthentication no` (после проверки ключа), fail2ban.
3. `ufw`: allow 22/80/443, deny остальное. Docker-порты в compose уже на 127.0.0.1 — **не менять на 0.0.0.0** (Docker обходит ufw).
4. zram/swap ≥4GB (на 16GB — подстраховка от OOM при `next build`), `unattended-upgrades`.
5. SSD: перенести систему или как минимум данные Postgres и бэкапы на SSD.
6. Docker + compose plugin (get.docker.com).
7. **Node 22 (NodeSource arm64)** — в Pi OS дефолтный Node старый, `engines: >=20`; затем `corepack enable && corepack prepare pnpm@9.12.3 --activate`.
8. Проверить доступность `cdn.sheetjs.com` — зависимость `xlsx` ставится тарболом оттуда, без него `pnpm install --frozen-lockfile` упадёт (если закрыт — качать через прокси из фазы C).

## 4. Фаза C — VPN/прокси для AI

Канон кода (docs/VPN_FOR_AI.md частично устарела — не читать буквально):

- Прокси применяется **только** в `openai-compat.ts` через undici `ProxyAgent`; конфиг живёт в БД (`tenants.settings.aiProxy`), UI — `/app/admin/ai/providers`. Env `AI_PROXY_*` — мёртвые, не задавать.
- **SOCKS5 не поддержан** (явный throw). Нужен **HTTP-inbound**: Xray-core как systemd-сервис, outbound VLESS (из подписки), inbound `"protocol": "http"` на `127.0.0.1:10809`.
- Проверка: `curl -x http://127.0.0.1:10809 https://api.anthropic.com/v1/models -H "x-api-key: ..." -m 15`.
- В админке: `http://127.0.0.1:10809`, type=http, и **обязательно галка useProxy на самом ключе** (условие `config.useProxy && proxy.enabled`; персональный ключ пользователя перебивает tenant-ключ).
- Пароль на прокси не ставить (хранится в JSONB открытым текстом; loopback-inbound без auth безопаснее).
- **Vision-провайдеры (OCR чеков) прокси игнорируют** — бьют напрямую в api.anthropic.com/api.openai.com. Варианты: Yandex Vision (без VPN), или OS-level VPN c policy-routing (сложно: Ozon API/ЦБ/капча должны ходить напрямую, иначе гео-отлупы).
- Ollama тянет модели с registry.ollama.ai — при блокировках задать прокси самому сервису: `systemctl edit ollama` → `Environment="HTTPS_PROXY=http://127.0.0.1:10809"`.
- **План Б без VPN:** DeepSeek / VseGPT / YandexGPT / GigaChat работают из РФ напрямую (`PROVIDER_META.requiresVpn=false`).
- (Опц.) Ollama на Pi: CPU-only, реалистично `qwen2.5:3b` (фоновые задачи); 7b ~2 ток/с — для чата слабо. Не критично: это подстраховка, не основной провайдер. `OLLAMA_KEEP_ALIVE=5m`, останавливать при `next build`.

## 5. Фаза D — база данных

Стратегия: **только `db:migrate`** (никогда не `db:push` на проде — проверено: push сносит HNSW/FTS/trgm-индексы, которых нет в Drizzle-схеме, и не совместим с migrate задним числом).

```bash
docker compose up -d postgres        # после фикса A2; пароль POSTGRES_PASSWORD — новый, не дев
# 01-extensions применится сам при первом init (vector, uuid-ossp, pgcrypto, pg_trgm, unaccent)
export DATABASE_URL='postgresql://openfinance_user:НОВЫЙ_ПАРОЛЬ@127.0.0.1:5434/openfinance'
pnpm db:migrate                      # 0000..0009 → 38 таблиц
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance -v ON_ERROR_STOP=1 < drizzle/init/02-vector-indexes.sql
SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD='СВОЙ' pnpm db:seed   # НЕ дефолтный admin@openfinance.local/admin12345
```

Грабли: CLI-скрипты и drizzle.config читают только `.env.local`/`.env` (НЕ `.env.production`) → `DATABASE_URL` всегда передавать явно в шелле, иначе они молча уйдут на дев-дефолт. Файлы `drizzle/init/03-15` на свежей БД не нужны (дубликаты миграций); `02-vector-indexes.sql` повторять после любых схемных операций. RLS в БД НЕТ — изоляция только `requireTenant()` в коде.

## 6. Фаза E — приложение

```bash
git clone <repo> /var/www/open-finance && cd /var/www/open-finance
# .env.production собрать вручную, НЕ копировать .env.example как есть:
#   NODE_ENV=production            ← в .env.example стоит development — САМАЯ опасная ловушка
#   DATABASE_URL=...               ← прод-URL
#   NEXTAUTH_SECRET=$(openssl rand -base64 48)      ← БЕЗ кавычек (systemd EnvironmentFile не парсит кавычки как shell)
#   INBOX_SECRET_KEY=$(openssl rand -base64 48)
#   MARKETPLACE_SECRET_KEY=$(openssl rand -base64 48)   ← fail-fast его НЕ проверяет — не забыть; генерить ДО первого подключения интеграций
#   APP_URL=https://домен  NEXTAUTH_URL=https://домен
#   FEATURE_DEFAULT_PLAN=pro  FEATURE_BILLING_MOCK=true
#   FEATURE_OPEN_REGISTRATION=true → после регистрации своего аккаунта переключить в false
#   (опц.) SMTP_*, SmartCaptcha-ключи (NEXT_PUBLIC_-ключ нужен УЖЕ на этапе build — вшивается в бандл)
# .env.local на сервере НЕ создавать (перебивает .env.production)
pnpm install --frozen-lockfile       # строго на Pi: node_modules с macOS не переносимы (swc/sharp platform-бинари)
set -a && . ./.env.production && set +a   # NEXT_PUBLIC_* и CHANGELOG.md нужны на билде
NODE_OPTIONS=--max-old-space-size=6144 pnpm build   # на 16GB запас есть; десятки минут на Pi — норма
```

Если sharp сегфолтится — это 16K-страницы ядра Pi 5: `kernel=kernel8.img` в `/boot/firmware/config.txt` (4K pages) и перезагрузка.

## 7. Фаза F — systemd + nginx + TLS

systemd-юнит (`/etc/systemd/system/open-finance.service`), отличия от README-версии:
- `ExecStart` — абсолютный путь `which pnpm` (corepack кладёт не в /usr/bin);
- `Environment=NODE_ENV=production TZ=Europe/Moscow PORT=3000`, `EnvironmentFile=/var/www/open-finance/.env.production`;
- `Restart=on-failure`, `RestartSec=5`, `StartLimitBurst=5`, `StartLimitIntervalSec=120` (fail-fast секретов иначе уйдёт в вечный restart-loop);
- **ровно один инстанс** — никаких PM2 cluster: rate-limit, token-bucket Ozon (40 RPS), кэши — всё in-memory per-process.

nginx (правки к конфигу из README — там их нет):
- `proxy_buffering off; proxy_cache off; proxy_read_timeout 300s;` — иначе NDJSON-стриминг AI приходит пачкой в конце/рвётся, а поллинг длинного Ozon sync отваливается по 60s;
- `proxy_set_header X-Forwarded-For $remote_addr;` (НЕ `$proxy_add_x_forwarded_for` — клиентский заголовок спуфит per-IP rate-limit);
- зачистка внутренних заголовков: `proxy_set_header X-User-Id ""; X-Tenant-Id ""; X-User-Role "";`
- `client_max_body_size 25M`.

TLS по выбранному варианту (certbot / CF Tunnel / mkcert). HSTS отдаётся всегда (`includeSubDomains`) — вешать на выделенный поддомен, чтобы год не блокировать соседние HTTP-сервисы домена.

## 8. Фаза G — пост-настройка и проверки

1. Вход админом → смена пароля → регистрация рабочего аккаунта → `FEATURE_OPEN_REGISTRATION=false` + restart.
2. `/app/admin/ai/providers`: ключ провайдера, прокси `http://127.0.0.1:10809`, useProxy; кнопка теста + `/api/admin/ai/diagnostics`.
3. Подключить Ozon-аккаунт (ключи вводятся в UI, шифруются в БД — env `OZON_*` не существует), запустить полный sync (15 стейджей, десятки минут — норма; следить за `ozon_sync_jobs`).
4. IMAP-канал (опц.). Автозабора почты и автосинка Ozon НЕТ (поля autoSyncCron в UI — задел, воркер не написан) — при необходимости добавим systemd-timer отдельной задачей.
5. Смоук: вход по HTTPS, AI-чат стримит, блоки Ozon-аналитики живые, `pnpm check:tenant-isolation`.

## 9. Фаза H — бэкапы

- cron: `pg_dump | gzip | age -r <ключ>` → SSD + **выгрузка за пределы Pi** (дамп содержит финданные, ПДн и зашифрованные секреты).
- **`.env.production` бэкапить отдельно от дампов**: без `INBOX_SECRET_KEY`/`MARKETPLACE_SECRET_KEY` восстановленный дамп не расшифрует креды Ozon/IMAP (ротация — `LEGACY_SECRET_KEYS=... pnpm admin:reencrypt-secrets`).
- Мониторинг: свой чек с запросом к БД (не `/api/health`, пока не починен), `journalctl -u open-finance`.

## 10. Рутина обновления (после первого деплоя)

```bash
# перед рестартом: SELECT id,status FROM ozon_sync_jobs WHERE status IN ('pending','running');  — не деплоить посреди синка (graceful shutdown нет)
git -C /var/www/open-finance pull
pnpm install --frozen-lockfile
set -a && . ./.env.production && set +a
NODE_OPTIONS=--max-old-space-size=6144 pnpm build
DATABASE_URL=... pnpm db:migrate            # только migrate; после схемных изменений — повторить 02-vector-indexes.sql
sudo systemctl restart open-finance
```

## 11. Быстрый реестр граблей (из аудита 2026-08-06)

| # | Грабля | Где |
|---|---|---|
| 1 | `.env.example` содержит `NODE_ENV=development` — копирование в `.env.production` отключает всю прод-защиту | env |
| 2 | `.env.local` молча перебивает `.env.production`; CLI-скрипты читают только `.env.local`/`.env` | env |
| 3 | `undici` не в зависимостях → AI-прокси падает | proxy.ts |
| 4 | SOCKS5 не поддержан — только HTTP-прокси | proxy.ts |
| 5 | Полный `drizzle/init` в initdb роняет первый старт контейнера | docker-compose |
| 6 | `db:push` сносит HNSW/FTS/trgm-индексы; push и migrate несовместимы | drizzle |
| 7 | Secure-cookie: по HTTP вход невозможен в prod | session.ts |
| 8 | `NEXT_PUBLIC_*` (капча) вшивается на `pnpm build`, не в рантайме | next build |
| 9 | Vision-провайдеры игнорируют прокси | ai/vision |
| 10 | Один процесс обязателен (in-memory лимиты/кэши/token-bucket) | рантайм |
| 11 | node_modules/.next с macOS не переносимы; 64-bit ОС обязательна | ARM64 |
| 12 | `xlsx` ставится с cdn.sheetjs.com — нужен доступ | install |
| 13 | Ротация секрет-ключей ломает расшифровку кредов — `admin:reencrypt-secrets` | crypto |
| 14 | Seed-дефолт admin12345 + открытая регистрация | seed |
| 15 | 16K-страницы ядра Pi 5 могут ронять sharp — `kernel=kernel8.img` | ОС |
