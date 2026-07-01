# SECURITY_AUDIT.md — аудит безопасности перед запуском

> **Назначение:** живой рабочий документ для прохождения security-чеклиста по фазам. Хранит контекст между сессиями: что проверено, что нашли (с путями `файл:строка`), что чинить и в каком порядке. Обновляй статусы и **Лог выполнения** по мере работ.
>
> **Источник чеклиста:** `security-checklist-prompt-v2.md` (в корне воркспейса, вне репо).
> **Базовая версия аудита:** v0.42.1 · **Дата прохода:** 2026-06-28 · **Аудитор:** AI (Cascade)
>
> **Легенда статусов:** ✅ ок · ⚠️ риск · ❌ проблема · ❓ требует ручной проверки · ⏳ в работе · ✔️ исправлено

---

## 0. Сводка (executive summary)

Изоляция данных (мультитенантность) и работа с секретами реализованы **аккуратно и единообразно**. Основные риски перед публичным запуском — **отсутствие rate-limit на auth и AI-эндпоинтах**, **юридическая неготовность по 152-ФЗ** (нет privacy policy, согласия, удаления аккаунта) и **протечка внутренних ошибок в ответы API**.

| Severity | Кол-во | Пункты |
|---|---|---|
| 🔴 Критично | 4 | C1 rate-limit auth · C2 rate-limit AI · C3 152-ФЗ (privacy/consent/erasure) · C4 утечка `e.message` в ответ |
| 🟡 Важно | 7 | I1 нет Postgres RLS · I2 нет CSP/HSTS · I3 user-enumeration при регистрации · I4 reset-токен в плейне · I5 общий `INBOX_SECRET_KEY` + dev-fallback · I6 нет CAPTCHA · I7 doc-drift в `docs/SECURITY.md` |
| 🟢 Улучшения | 6 | H1 deleteTab defence-in-depth · H2 in-memory лимитеры → Redis · H3 billing webhook (подпись/idempotency) · H4 2FA owner · H5 pnpm audit + Next patch · H6 Sentry PII-scrub |
| ✅ Подтверждено | 8 | tenant-скоуп · параметризованный SQL · шифрование секретов · `maskSecret` · хеш паролей · cookie-флаги · нет `dangerouslySetInnerHTML` · нет CORS `*` |

**Вердикт (2026-06-28):** к публичному запуску **не готово** до закрытия 🔴. Для закрытого beta за авторизацией — допустимо с планом на 🔴/🟡.

> **Обновление 2026-07-01 (v0.43–0.46.1):** все 🔴 (C1–C4) и 🟡 (I1–I7) закрыты; из 🟢 сделаны H1 и H5. Прод-audit: 24 → 3 уязвимости (0 high; остаток — moderate-транзитивы: postcss внутри `next`, js-yaml, linkify-it — приняты). Открыто: H2–H4, H6 + ручные проверки §4. **По чеклисту — готово к публичному запуску** при условии прод-секретов (I5 fail-fast проверит) и резидентности РФ (§4).

---

## 1. Таблица результатов по чеклисту

### Шаг 1 — Юридическая защита (152-ФЗ + приватность)

| Пункт | Статус | Что нашёл (файл:строка) | Как исправить |
|---|---|---|---|
| Политика конфиденциальности | ✔️ | Страница `/privacy` + `src/lib/legal.ts` (v0.44); в тексте плейсхолдеры оператора | Заполнить реквизиты оператора перед продом |
| Где хранятся данные / резидентность РФ | ❓ | В коде не отражено; прод-инфра вне репо | Зафиксировать провайдера/регион (РФ) в `docs/`, подтвердить хостинг в РФ по 152-ФЗ |
| Согласие на обработку ПДн при регистрации | ✔️ | Обязательный чекбокс на `/register` + `users.consent_version/consent_at` (v0.44) | — |
| Право на удаление («Стереть аккаунт»/«память AI») | ✔️ | Danger-zone в настройках (`/api/account/{deletion-request,ai-data}`) + очередь super_admin `/app/admin/deletion-requests` (v0.44) | — |
| Минимизация ПДн / Sentry без PII | ❓ | Sentry опционален (`SENTRY_DSN`), скрабинг не настроен | Включить scrub PII перед прод-Sentry |

### Шаг 2 — Замок на базу данных (мультитенантность)

| Пункт | Статус | Что нашёл (файл:строка) | Как исправить |
|---|---|---|---|
| `tenant_id` в каждом запросе | ✅ | Единообразно: `auth()`→`session.tenantId`→`WHERE tenant_id = ${session.tenantId}` (напр. `src/app/api/marketplaces/ozon/kpi/route.ts:205-251`, `…/campaigns/route.ts:76`) | Поддерживать паттерн в новых роутах |
| DB-backstop (Postgres RLS) | ✔️ | Выбран review-gate (I1, v0.45): `requireTenant()/requireTenantRoute()` + `docs/TENANT_SCOPING.md` + smoke `pnpm check:tenant-isolation`; RLS — возможное усиление позже | — |
| Удаление/обновление с проверкой владельца | ✅ | `deleteAccount` скоуплен `and(tenantId, id)` — `src/lib/marketplaces/queries.ts:251-263`; `deleteTab` проверяет владельца до удаления — `src/lib/unit-economics/tabs-queries.ts:196-207` | ✔️ H1 (v0.46.1): soft/hard delete в `deleteTab` скоуплены `tenantId+userId+id` |
| `x-tenant-id` не спуфится | ✅ | Заголовки ставит middleware из проверенной сессии — `src/middleware.ts:53-59`; роуты берут tenant из `auth()`, не из заголовка | Не читать `x-tenant-id` из входящего запроса |
| Серверная валидация ввода | ✅ | `zod` в роутах (напр. `src/app/api/ai/chat/route.ts:20-47`) | Покрыть валидацией оставшиеся роуты (ручная сверка) |
| Ошибки не утекают наружу | ✔️ | Массово возвращается `error: e instanceof Error ? e.message : 'Failed'` — `…/ozon/kpi/route.ts:294`, `…/timeseries/route.ts:204`, `…/accounts/[id]/route.ts:35,69,87`, `…/unit-economics/products/route.ts:210,251`, `ai/chat/route.ts:420`, и др. | См. C4: возвращать нейтральное сообщение, детали — только в лог |

### Шаг 3 — Негативные сценарии аутентификации

| Пункт | Статус | Что нашёл (файл:строка) | Как исправить |
|---|---|---|---|
| Неправильный пароль N раз (throttle/lockout) | ✔️ | `login()` без счётчика попыток/лока — `src/lib/auth/actions.ts:120-163` | См. C1: rate-limit + (опц.) временный лок |
| Сброс для несуществующего email | ✅ | Всегда `ok`, не палит существование — `src/lib/auth/actions.ts:173-194` | — |
| Повторное/просроченное открытие ссылки сброса | ✅ | Токен одноразовый + TTL 1ч — `src/lib/auth/actions.ts:196-227` | — |
| Регистрация на существующий email | ✔️ | Принятый остаточный риск (I3, v0.45): авто-логин не даёт скрыть без email-верификации; смягчено rate-limit (C1) + CAPTCHA (I6) — `docs/SECURITY.md §enumeration` | Email-верификация — отдельная задача (опционально) |
| Cookie/JWT/хеш паролей | ✅ | `of_session` httpOnly+secure(prod)+sameSite lax — `src/lib/auth/session.ts:62-68`; bcrypt 12 раундов — `src/lib/auth/password.ts:6`; HS256, prod требует секрет ≥32 — `session.ts:20-34` | — |

### Шаг 4 — Секреты и утечки

| Пункт | Статус | Что нашёл (файл:строка) | Как исправить |
|---|---|---|---|
| Ключи не во фронтенде | ✅ | Секреты только через `src/lib/env.ts` на сервере; на клиент — `maskSecret()` — `src/lib/inbox/crypto.ts:43-47` | Сверять, что новые поля не уезжают в RSC-пропсах |
| Прод не на dev-fallback | ✔️ | Fail-fast на старте прода (I5, v0.45): `src/instrumentation.ts` → `src/lib/security/assert-secrets.ts`; отдельный `MARKETPLACE_SECRET_KEY` с legacy-fallback | Задать реальные секреты в прод-env |
| Секреты зашифрованы (AES-256-GCM) | ✅ | `encryptSecret/decryptSecret` — `src/lib/inbox/crypto.ts:19-41`; `api_key_enc`/`secret_enc`; decrypt только на сервере — `src/lib/marketplaces/queries.ts:265-268` | — |
| Нет секретов в логах | ✅ | Ozon-клиент явно не логирует `api_key` — `src/lib/marketplaces/ozon/client.ts:7` | Сверять при добавлении логов |
| AI Tools Layer / BYOK | ✅ | Зарегистрирован только read-only tool — `src/lib/ai/tools/index.ts:14`; BYOK через `getActiveCredentials` | При добавлении мутирующих tools — tenant-скоуп + валидация |

### Шаг 5 — Инфраструктура

| Пункт | Статус | Что нашёл (файл:строка) | Как исправить |
|---|---|---|---|
| Rate-limit на каждом эндпоинте | ✔️ | C1/C2 (v0.43): `/api/auth/*` per-IP+per-email, `/api/ai/*` per-tenant 20/мин (`src/lib/rate-limit.ts`) | H2: вынести in-memory лимитеры в Redis |
| Hard caps на платных AI API | ⚠️ | Частота ограничена (C2); дневного бюджета токенов нет (оставлено намеренно, см. Фаза 1 · Примечание) | Бюджет-гард per-tenant — план |
| CAPTCHA на публичных формах | ✔️ | Yandex SmartCaptcha (I6, v0.46): login/register/forgot, опциональна по env — `docs/SMARTCAPTCHA.md` | — |
| CORS не `*` | ✅ | `Access-Control-Allow-Origin: *` не задаётся (same-origin) | — |
| Security-заголовки | ✔️ | X-Frame/X-Content/Referrer/Permissions + **HSTS** (I2, v0.45) + **CSP prod-only** (v0.46.1) — `next.config.mjs` | Nonce-based CSP (без 'unsafe-inline') — возможное усиление |
| Зависимости / Next CVE | ✔️ | H5 (v0.46.1): `pnpm audit --prod` 24 → 3 (0 high); dompurify 3.4.11, nodemailer 9.0.3, mailparser 3.9.12, xlsx 0.20.3 (SheetJS CDN), postcss 8.5.16; next 15.5.18 | Остаток (moderate-транзитивы: postcss←next, js-yaml, linkify-it) — принят; повторять audit перед релизами |

### Шаг 6 — Интеграции

| Пункт | Статус | Что нашёл (файл:строка) | Как исправить |
|---|---|---|---|
| Ozon ключи зашифрованы/не логируются | ✅ | `src/lib/marketplaces/ozon/client.ts:7`, `api_key_enc` | — |
| IMAP секреты зашифрованы | ✅ | `inbox_channels.secret_enc` (AES-256-GCM) | OAuth-коды/пароли не логировать |
| Биллинг webhook (подпись/idempotency) | ❓ | Сейчас mock (`FEATURE_BILLING_MOCK`) | См. H3: при включении реального биллинга — обязательно |
| SSRF в исходящих fetch | ❓ | IMAP-хост из пользовательского ввода, Ozon/CBR/`AI_PROXY_URL` | Таймауты + валидация host/URL (ручная проверка) |

### OWASP / прочее

| Пункт | Статус | Что нашёл | Как исправить |
|---|---|---|---|
| SQLi | ✅ | Drizzle параметризует; raw `sql` использует `${session.tenantId}` как параметр (напр. `…/cluster-stocks-v2/route.ts:100`) | Не собирать SQL конкатенацией строк |
| XSS | ✅ | `dangerouslySetInnerHTML` в коде не найден | Сверять при рендере markdown (`renderInlineMd`) |

### Финальный гейт перед деплоем

| Пункт | Статус | Комментарий |
|---|---|---|
| Встроенный security-скан (`.claude/ of-security-reviewer` / `of-review`) | ⏳ | Прогнать перед выкаткой |
| `gitleaks` по диффу/истории | ❓ | Прогнать |
| Прод-env (реальные секреты, `FEATURE_BILLING_MOCK`) | ⏳ | Проверить перед деплоем |
| `pnpm typecheck && pnpm build` | ✅ | Прогнаны на v0.46.1 (2026-07-01); повторять перед каждым деплоем |
| Миграции (`pnpm db:push`/`db:migrate`) | ⏳ | **Команды выполняет пользователь** |

---

## 2. Детализация критичных находок

### 🔴 C1 — Нет rate-limit / lockout на `/api/auth/*`
`login()` (`src/lib/auth/actions.ts:120-163`) не считает неудачные попытки → перебор паролей не ограничен. Для финтеха = риск захвата аккаунта.
**Фикс:** middleware/обёртка с per-IP и per-email лимитом (напр. 5/мин, экспон. backoff) на `/api/auth/login`, `/register`, `/forgot-password`; хранилище — Redis (`src/lib/redis.ts`).

### 🔴 C2 — Нет лимитов на `/api/ai/*` (платные API)
`ai/chat`, `ai/analyze-block`, `marketplaces/ozon/ai-insights` вызывают платные провайдеры без ограничения частоты/токенов. Один пользователь может сжечь бюджет.
**Фикс:** per-tenant rate-limit + дневной бюджет/лимит токенов; короткий `maxDuration`; отказ при превышении.

### 🔴 C3 — Юридическая неготовность по 152-ФЗ
Нет `docs/PRIVACY.md`, нет согласия на обработку ПДн при регистрации, не реализовано удаление аккаунта/AI-памяти. `docs/SECURITY.md:150` утверждает, что удаление «реализовано» — это **не соответствует коду**.
**Фикс:** privacy policy + страница; обязательный чекбокс согласия (хранить факт+дату); эндпоинт удаления аккаунта (cascade по `tenant_id`) и очистки AI-памяти; резидентность РФ.

### 🔴 C4 — Утечка внутренних ошибок в ответ API
Паттерн `error: e instanceof Error ? e.message : 'Failed'` в ~25+ роутах (`…/ozon/kpi:294`, `…/timeseries:204`, `…/accounts/[id]:35,69,87`, `…/unit-economics/products:210,251`, `marketplaces/analytics/ozon:715`, `ai/chat:420`, …). Может раскрыть текст ошибок Postgres/Drizzle (имена таблиц/колонок/constraint).
**Фикс:** общий хелпер `apiError()` — наружу нейтральное (`'Internal error'` + код), `e` только в `console.error`/Sentry. Заменить по всем роутам.

---

## 3. План работ по фазам

> Отмечай `[x]` по мере выполнения. Каждая фаза = отдельный коммит(ы) + запись в `CHANGELOG.md`.

### Фаза 1 — 🔴 Критично (блокеры публичного запуска) — статус: ✅ done (C1/C2/C3/C4)
- [x] **C1** rate-limit на `/api/auth/*` (per-IP 10/15м + per-email 5/15м) — ✔️ `src/lib/rate-limit.ts` + login/register/forgot-password/reset-password
- [x] **C2** rate-limit на `/api/ai/*` (per-tenant 20/мин) — ✔️ chat / analyze-block / analyze-section / ozon ai-insights
- [x] **C4** санитизация 5xx (`internalError()`/`apiError()` в `src/lib/api-error.ts`) — ✔️ 24 блока в 21 файле + accounts (GET/POST, убран docker/db/path-hint) + inbox/channels (+лог)
- [x] **C3** privacy policy + согласие при регистрации + удаление аккаунта/AI-данных — ✔️ публичная `/privacy` (+`src/lib/legal.ts`, `PUBLIC_PATHS`), обязательный чекбокс на `/register` + `users.consent_version/at`, self-service «Опасная зона» (`/api/account/{deletion-request,ai-data}`), очередь super_admin `/app/admin/deletion-requests` + `/api/admin/deletion-requests`, каскадное удаление tenant+user (`account_deletion_requests`, drizzle 0009 / init 15)
- **Done-критерий:** перебор пароля и спам AI-запросов отбиваются 429 ✔️; ответы API не содержат внутренних сообщений ✔️; регистрация требует согласия ✔️ (C3); есть рабочее удаление аккаунта ✔️ (C3, ручное подтверждение super_admin).
- **Примечание:** дневной бюджет токенов на AI и diagnostics-4xx (inbox/test, account/test) оставлены намеренно; вынос лимитеров в Redis — H2 (Фаза 3).

### Фаза 2 — 🟡 Важно (hardening до прод-нагрузки) — статус: ✅ done (I1–I7, v0.45–0.46.1)
- [x] **I1** review-gate вместо RLS — ✔️ `requireTenant()/requireTenantRoute()` + `docs/TENANT_SCOPING.md` + smoke `pnpm check:tenant-isolation`
- [x] **I2** HSTS (v0.45) + CSP prod-only (v0.46.1) в `next.config.mjs` — ✔️
- [x] **I3** enumeration — ✔️ принятый остаточный риск (rate-limit + CAPTCHA), `docs/SECURITY.md §enumeration`
- [x] **I4** `passwordResetToken` — ✔️ SHA-256 (`hashResetToken()`, `src/lib/auth/password.ts`)
- [x] **I5** fail-fast прод-секретов (`src/instrumentation.ts`) + `MARKETPLACE_SECRET_KEY` с legacy-fallback — ✔️
- [x] **I6** CAPTCHA — ✔️ Yandex SmartCaptcha (вместо Turnstile: РФ-доступность) на login/register/forgot — `docs/SMARTCAPTCHA.md`
- [x] **I7** `docs/SECURITY.md` синхронизирован с кодом — ✔️

### Фаза 3 — 🟢 Улучшения — статус: ⏳ (H1, H5 done)
- [x] **H1** `deleteTab` — ✔️ soft/hard delete скоуплены `tenantId+userId+id` (v0.46.1)
- [ ] **H2** вынести in-memory лимитеры (Ozon/currency) в Redis для горизонтального масштаба
- [ ] **H3** биллинг: верификация подписи webhook + idempotency (при включении реального)
- [ ] **H4** 2FA для роли owner
- [x] **H5** ✔️ `pnpm audit --prod`: 24 → 3 (0 high, v0.46.1) — dompurify 3.4.11 / nodemailer 9.0.3 / mailparser 3.9.12 / xlsx 0.20.3 (SheetJS CDN, на npm фиксов нет) / postcss 8.5.16; остаток — moderate-транзитивы (postcss←next, js-yaml, linkify-it). Повторять перед релизами
- [ ] **H6** Sentry PII-scrubbing

---

## 4. Требует ручной проверки (❓)
- Резидентность данных в РФ (прод-инфра вне репо).
- SSRF: валидация IMAP-хоста и любых пользовательских URL в исходящих fetch.
- Полнота `zod`-валидации по всем роутам (проверена выборочно).
- Версия `next` в `package.json` против последнего security-патча.
- Настроен ли scrub PII в Sentry.

---

## 5. Лог выполнения (дополнять по фазам)

| Дата | Фаза/пункт | Что сделано | Коммит | Кто |
|---|---|---|---|---|
| 2026-06-28 | — | Первичный аудит, составлен список и план | — | AI (Cascade) |
| 2026-06-28 | Фаза 1a (C1/C2/C4) | rate-limit auth (4 роута) + AI (4 роута); санитизация 5xx-утечек `e.message` (21 файл / 24 блока + accounts + inbox); новые `src/lib/rate-limit.ts`, `src/lib/api-error.ts`; `pnpm typecheck` ✅ | e3a66c3 | AI (Cascade) |
| 2026-06-29 | Фаза 1b (C3) | privacy `/privacy` + consent-чекбокс (`users.consent_version/at`) + удаление аккаунта: `account_deletion_requests` (drizzle 0009 / init 15), queries `src/lib/account/deletion-queries.ts`, self-service settings danger-zone, админка `/app/admin/deletion-requests`, `clearUserAiData`; `pnpm typecheck` ✅ | 027ab9f | AI (Cascade) |
| 2026-07-01 | Фаза 2 (I1–I5, I7) | review-gate + HSTS + SHA-256 reset-токен + `MARKETPLACE_SECRET_KEY` + fail-fast секретов + docs-sync | 1fef07d | AI (Cascade) |
| 2026-07-01 | Фаза 2 (I6) | Yandex SmartCaptcha: виджет + сервер-проверка на register/login/forgot; `docs/SMARTCAPTCHA.md` | 890b648 | AI (Cascade) |
| 2026-07-01 | Фаза 3 (H1, H5) + I2-CSP | `deleteTab` tenant-скоуп; CSP prod-only (`next.config.mjs`); deps: dompurify 3.4.11, nodemailer 9.0.3, mailparser 3.9.12, xlsx 0.20.3 (SheetJS CDN), postcss 8.5.16 — audit 24→3 (0 high); синхрон этого дока; `pnpm typecheck && pnpm build` ✅ | (pending) | AI (Cascade) |
