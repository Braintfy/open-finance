# PERSONAL_USE.md — личный self-hosted инстанс

> Как развернуть Open Finance «для себя» (локально или на своём VPS): какие секреты задать,
> какие фича-флаги переключить, что опционально. Базовая установка — README «Быстрый старт»
> (локально) или README «Деплой на Ubuntu-сервер» (VPS).

## Что публично в репозитории (и почему это безопасно)

Секрет-аудит: в git отслеживается только `.env.example` (шаблон без реальных значений),
`.gitignore` исключает `.env` / `.env.*`; реальных ключей в коде и истории нет.
Что есть и что с этим делать:

| Публично | Риск | Действие для личного инстанса |
|---|---|---|
| Dev-пароли Postgres/MinIO в `.env.example` / `docker-compose.yml` | Только localhost-дефолты | На VPS задать свои `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD` (порты БД наружу не открывать — только через docker network/localhost) |
| Seed-админ `admin@openfinance.local / admin12345` | Известный логин | Сменить `SEED_ADMIN_*` до `pnpm db:seed` или сменить пароль после первого входа |
| Плейсхолдеры оператора ПДн на `/privacy` (`src/lib/legal.ts`) | — | Для личного инстанса можно игнорировать; для публичного — заполнить реквизиты |
| URL репозитория на лендинге (`src/app/page.tsx`, `GITHUB_URL`) | — | Для форка заменить на свой |

## Обязательные секреты (прод-режим)

При `NODE_ENV=production` приложение **не стартует** без них (fail-fast, `src/instrumentation.ts`):

```bash
# Сгенерировать каждый: openssl rand -base64 48
NEXTAUTH_SECRET=...        # подпись JWT-сессий
INBOX_SECRET_KEY=...       # AES-256-GCM для секретов inbox-каналов
MARKETPLACE_SECRET_KEY=... # AES-256-GCM для API-ключей маркетплейсов
```

В dev (`pnpm dev`) можно оставить пустыми — работают dev-fallback.

## Рекомендуемые фича-флаги для личного инстанса

```bash
FEATURE_DEFAULT_PLAN=pro        # снять plan-гейт (иначе лимит: 1 аккаунт маркетплейса)
FEATURE_OPEN_REGISTRATION=false # закрыть регистрацию после создания своего аккаунта
FEATURE_BILLING_MOCK=true       # (default) биллинг фиктивный, платёжные ключи не нужны
```

Порядок: зарегистрировать свой аккаунт → выключить открытую регистрацию
(env или админка `/app/admin/settings`).

## Опциональные интеграции (пусто = выключено)

| Переменная | Зачем | Без неё |
|---|---|---|
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `YANDEX_API_KEY` | Облачный AI (BYOK — можно ввести и в настройках UI) | AI через Ollama (`docs/LOCAL_AI.md`) или mock |
| `OLLAMA_BASE_URL` + `AI_DEFAULT_PROVIDER=ollama` | Полностью локальный AI, данные не уходят наружу | — |
| `SMTP_*` | Письма (сброс пароля) | Письма печатаются в консоль сервера — сброс пароля через логи |
| `NEXT_PUBLIC_YANDEX_SMARTCAPTCHA_CLIENT_KEY` + `YANDEX_SMARTCAPTCHA_SERVER_KEY` | Капча на формах входа | Капча выключена (для личного инстанса за фаерволом не нужна) |
| `SENTRY_DSN` | Мониторинг ошибок | Выключен |
| `TELEGRAM_BOT_TOKEN` | Уведомления | Выключены |
| `AI_PROXY_URL` | Прокси для Anthropic/OpenAI из РФ | Прямые запросы |

## Куда инстанс ходит по сети (наружу)

Только по подключённым вами интеграциям и вашим ключам:

- **Ozon Seller/Performance API** — sync данных магазина (ключи шифруются в БД).
- **ЦБ РФ** (`cbr.ru`) — курсы валют.
- **AI-провайдер** (Anthropic/OpenAI/Yandex) — только если задан ключ; с Ollama — всё локально.
- **Yandex SmartCaptcha / Sentry / SMTP / Telegram** — только если включены.

Телеметрии проекта нет.

## Чек-лист безопасности личного VPS

1. Секреты из раздела «Обязательные» заданы, `.env.production` не в git.
2. `FEATURE_OPEN_REGISTRATION=false` после создания аккаунта.
3. Пароль seed-админа сменён (или юзер удалён).
4. Postgres/Redis/MinIO не торчат наружу (ufw: только 22/80/443).
5. HTTPS через certbot (README §5) — HSTS/CSP уже включены в проде.
6. Бэкапы БД (README §7).
