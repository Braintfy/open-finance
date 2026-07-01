# SECURITY.md — Безопасность и защита от утечек данных

> **Этот файл = обязательное чтение для любого AI-агента и человека, работающего над проектом.**
> При нарушении правил отсюда легко слить пароли, токены и финансовые данные пользователей в публичный гит.

## Главное правило (TL;DR)

**Никогда** не коммить:
- Файлы с расширениями `.env`, `*.pem`, `*.key`, `*.tokens`
- API-ключи, пароли, токены прямо в коде
- Базы данных (`*.db`, `*.sqlite`)
- Папки `inbox/`, `data/`, `uploads/`, `backups/`
- Реальные email-адреса, ИНН, паспортные данные пользователей
- Скриншоты с открытыми кабинетами банков/ЛК

## Чек-лист перед каждым коммитом

```bash
# 1. Проверь что в стейдже нет секретов
git diff --cached | grep -iE '(api[_-]?key|secret|password|token|bearer)'

# 2. Проверь что .env не в стейдже
git diff --cached --name-only | grep -E '^\.env'

# 3. Проверь размер файлов (большие файлы = подозрительно)
git diff --cached --stat | sort -k3 -n -r | head -5
```

Если хоть одна команда что-то нашла — **остановись и проверь**.

## Что в гит можно

- `*.env.example` / `*.env.template` — шаблоны без значений
- Тестовые ключи помеченные как `pk_test_xxx` (только публичные!)
- Документация с примерами вида `YOUR_API_KEY_HERE`
- Mock-данные с явно вымышленными ИНН (`0000000000`)

## Что в гит **нельзя**

| Тип | Пример | Куда вместо гита |
|-----|--------|------------------|
| Production .env | `DATABASE_URL=postgresql://...` | Vault / Doppler / Docker secrets |
| API ключи | `OPENAI_API_KEY=sk-proj-...` | .env (gitignored) |
| JWT приватные ключи | `LICENSE_PRIVATE_KEY=...` | Внешний secret manager |
| OAuth client secrets | `GOOGLE_CLIENT_SECRET=...` | .env |
| Webhook signing keys | `TKASSA_TERMINAL_PASSWORD=...` | .env |
| SQLite базы пользователей | `data.db` | Локально на устройстве (gitignored) |
| Файлы из inbox/ | сканы чеков | gitignored, S3 в проде |

## Структура `.env` файлов

Хранить только в gitignored файлах:

```bash
# .env.local (для разработки — не в гит!)
DATABASE_URL=postgresql://localhost:5432/openfinance_dev
REDIS_URL=redis://localhost:6379

# AI providers
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-proj-...

# Billing
TKASSA_TERMINAL_KEY=...
TKASSA_TERMINAL_PASSWORD=...
CLOUDPAYMENTS_PUBLIC_ID=...
CLOUDPAYMENTS_API_PASSWORD=...

# License Server (для cloud-side)
LICENSE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----...
JWT_PUBLIC_KEY=-----BEGIN PUBLIC KEY-----...

# OAuth (если используется)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Telegram Bot
TELEGRAM_BOT_TOKEN=...

# Sentry
SENTRY_DSN=https://...@sentry.io/...
```

И `.env.example` (в гите) — тот же файл, но БЕЗ значений:

```bash
DATABASE_URL=
REDIS_URL=
ANTHROPIC_API_KEY=
# ...
```

## Проверка истории на утечки

Если кажется что секрет всё-таки утёк:

```bash
# Поиск по всей истории git
git log --all --full-history -p | grep -E '(sk-|api_key|secret)' | head

# Если нашёл — нужно переписать историю (BFG или git-filter-repo)
brew install git-filter-repo
git filter-repo --replace-text passwords.txt

# И обязательно отозвать утёкший ключ у провайдера!
```

## Pre-commit хуки (рекомендуется)

Установить `gitleaks` для автопроверки:

```bash
brew install gitleaks

# В .git/hooks/pre-commit:
#!/bin/sh
gitleaks protect --staged --verbose --redact
```

Или через `husky + lint-staged`:

```json
// package.json
{
  "lint-staged": {
    "*": ["gitleaks protect --staged --no-banner"]
  }
}
```

## Реализованные защиты приложения (актуальное состояние)

Соответствует коду на момент правки (Фаза 1-2 аудита). Обновлять при изменениях.

- **Аутентификация** — bcrypt (12 раундов), JWT-сессии в httpOnly-cookie (`jose`, HS256, 30д); `NEXTAUTH_SECRET` ≥32 симв. (fail в проде если короче).
- **Rate-limiting (C1)** — на `/api/auth/*` (логин/сброс/регистрация): лимиты per-email + per-IP, окно 15 мин.
- **Security-заголовки (I2)** — `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, **HSTS** `max-age=31536000; includeSubDomains` (`next.config.mjs`).
- **Сброс пароля (I4)** — токен в БД хранится как SHA-256 (plaintext только на почту, TTL 1ч); утечка дампа не даёт рабочих токенов.
- **Шифрование секретов интеграций (I5)** — AES-256-GCM; `INBOX_SECRET_KEY` (inbox) и `MARKETPLACE_SECRET_KEY` (маркетплейсы, с legacy-fallback на inbox-ключ). Fail-fast проверка обязательных прод-секретов при старте (`src/instrumentation.ts` → `src/lib/security/assert-secrets.ts`).
- **Tenant-изоляция (I1)** — review-gate: `requireTenant()/requireTenantRoute()` (`src/lib/auth/guards.ts`), правила + чек-лист (`docs/TENANT_SCOPING.md`), smoke `pnpm check:tenant-isolation`.

### Enumeration (I3) — принятый остаточный риск

Регистрация авто-логинит пользователя при успехе, поэтому скрыть факт
существования email (ответ «email занят») без email-верификации невозможно.
Решение: **принять** и снизить массовость через rate-limit (C1: per-email +
per-IP) на `/api/auth/register`; планируется CAPTCHA (I6). Полное закрытие —
опциональный флоу email-верификации (ломает текущий авто-логин/онбординг),
выносится отдельной задачей.

## Финансовые и личные данные пользователей

### Принципы
- **Шифрование at-rest** — на диске SaaS-сервера данные зашифрованы (LUKS/AWS EBS)
- **Шифрование in-transit** — TLS 1.3 минимум, HTTP→HTTPS редирект
- **Tenant-изоляция** — `tenant_id` разделяет данные пользователей; защита на уровне приложения через обязательный **review-gate** (`requireTenant()` + правила, см. `docs/TENANT_SCOPING.md`), не Postgres RLS
- **Аудит-лог** — все мутации с user_id + timestamp
- **Минимизация** — не запрашиваем ИНН/паспорт/etc если не обязательно по 152-ФЗ

### Что AI-секретарь хранит из коммуникаций
- **Embeddings** — векторные представления (нельзя восстановить оригинальный текст с гарантией)
- **Извлечённые сущности** — суммы, даты, контрагенты (структурированные)
- **НЕ храним** raw тексты переписок (только embeddings + sanitized excerpts при необходимости)
- **Кнопка «Стереть всё»** в settings → удаляет ВСЁ что AI узнал

### 152-ФЗ (персональные данные РФ)
- Хранение данных российских граждан — на серверах в РФ
- Согласие на обработку — при регистрации (явное)
- Уведомление Роскомнадзора — при обработке ПДн в коммерческих целях
- Право на удаление — реализовано через «Стереть аккаунт»

## Privacy Policy

Файл `docs/PRIVACY.md` (создать при выходе на публичный лонч):
- Какие данные собираются
- Зачем
- Кому передаются (никому, кроме платёжных провайдеров)
- Сколько хранятся
- Как удалить

## Если утечка случилась

1. **Не паниковать**, не удалять следы — нужны для расследования
2. **Отозвать** все возможно скомпрометированные ключи у провайдеров
3. **Сменить** все пароли затронутых сервисов
4. **Переписать историю гита** через git-filter-repo
5. **Уведомить** пользователей если затронуты их данные (152-ФЗ требует — в течение 24 часов)
6. **Зафиксировать инцидент** в `docs/INCIDENTS.md` (создать при первом инциденте)

## Чек-лист безопасности (по этапам разработки)

### MVP (Этап 1-3)
- [ ] `.gitignore` настроен (см. файл в корне)
- [ ] `.env.example` без значений в гите
- [ ] `gitleaks` или эквивалент в pre-commit
- [ ] HTTPS с самого начала (даже в dev — через mkcert)
- [x] Tenant-изоляция: review-gate + `requireTenant()` + smoke (`pnpm check:tenant-isolation`), см. `docs/TENANT_SCOPING.md` (Postgres RLS — возможное усиление позже)

### Production (Этап 13)
- [ ] Шифрование БД at-rest
- [ ] Backup encryption
- [ ] DDoS protection (Cloudflare)
- [ ] Rate limiting per-tenant
- [ ] 2FA для owner-роли
- [ ] Audit log на все мутации
- [ ] Sentry без PII (отфильтрованные данные)
- [ ] Privacy Policy + Terms of Service опубликованы

### AI-секретарь (Этап 8)
- [ ] OAuth-коды не логируются
- [ ] Email пароли не в логах
- [ ] Telegram session-файлы зашифрованы
- [ ] Кнопка «Стереть всю память AI» работает
- [ ] Audit log того что AI узнал

## Контакты безопасности

- Bug bounty: `security@openfinance.ru` (создать при публичном лонче)
- Не публиковать уязвимости публично до фикса
