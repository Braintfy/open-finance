---
name: of-launch-check
version: 1.0.0
description: |
  Technical go-live gate for Open Finance before letting real users in: cross-tenant isolation, security audit status, 152-ФЗ operator details, feature flags, backups, single-instance limits. Produces a go / no-go verdict with a blocker list.
  TRIGGER when: user says «готовы ли к публичному запуску», «гейт запуска», «открываем регистрацию», «пускаем чужих пользователей», or before flipping FEATURE_OPEN_REGISTRATION on.
  DO NOT TRIGGER when: routine release to the Pi (use `of-deploy-pi`) or a code diff review (use `of-review` / `of-security-reviewer`).
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
---

# Гейт публичного запуска (технический)

> **Область скила — только техническая готовность.** Продуктовая часть публичного запуска (роли/мультиюзер, квоты, биллинг, гостевой/демо-режим, онбординг, пользовательская документация) планируется в `docs/ROADMAP_V2.md` — здесь её НЕ дублируем, только сверяемся, что заявленное там сделано.
> Правила безопасности — `.cursor/rules/security.mdc` + `docs/SECURITY.md`. Статусы находок — `docs/SECURITY_AUDIT.md`.
> Каждый пункт даёт **blocker / warning / ok**; вердикт — «можно открывать» только при нуле blocker'ов.

## 1. Cross-tenant изоляция (автоматический гейт)

```bash
pnpm check:tenant-isolation
```

Единственная автоматическая проверка на утечку между тенантами (`scripts/check-tenant-isolation.ts`). Постоянного места в CI у неё нет, поэтому здесь она обязательна. Любой фейл = **blocker**. Контекст правила — `docs/TENANT_SCOPING.md`: `tenantId` берётся ТОЛЬКО из сессии через `requireTenant()`/`requireTenantRoute()`, Postgres RLS в проекте нет.

## 2. Security-ревью текущего состояния

Делегировать сабагенту `of-security-reviewer` (read-only) ревью диффа с последнего релиза + точечно: auth, middleware, billing, crypto, admin-роуты, VLESS/Xray. Находки severity ≥ high = **blocker**.

Отдельно свериться с `docs/SECURITY_AUDIT.md`:

- 🔴 C1-C4 и 🟡 I1-I7 должны быть закрыты (по состоянию аудита — закрыты; перепроверить, что не отъехало).
- 🟢 остатки (H2 in-memory лимитеры → Redis, H3 подпись/idempotency вебхука биллинга, H4 2FA owner, H6 PII-scrub) — **warning**, но H3 становится **blocker'ом**, как только включается реальный приём платежей (сейчас `src/lib/billing/mock.ts`).
- §4 «Требует ручной проверки» — пройти списком, отметить статус.

## 3. 152-ФЗ и юридические реквизиты

```bash
grep -n "LEGAL_OPERATOR" -A 8 src/lib/legal.ts
```

- **Blocker:** в `LEGAL_OPERATOR` стоят плейсхолдеры (`ИП/ООО «___»`, ИНН `0000000000`, `privacy@example.com`). До заполнения реальными реквизитами публичный запуск невозможен — политика без оператора юридически пустая.
- `PRIVACY_POLICY_VERSION` в `src/lib/legal.ts` совпадает с текстом на `/privacy`; при правке текста версию поднять, чтобы у пользователей запросилось новое согласие (`users.consent_version`/`consent_at`).
- Работают: обязательный чекбокс согласия на `/register` (валидация в `/api/auth/register`), публичная `/privacy` в `PUBLIC_PATHS` middleware, самообслуживаемый запрос на удаление аккаунта (`/app/settings` → danger-zone → `account_deletion_requests`, очередь `/app/admin/deletion-requests`), очистка AI-данных `clearUserAiData()`.
- Резидентность данных РФ — подтвердить у пользователя (сервер физически в РФ, сторонние AI-провайдеры вызываются с данными пользователя → раскрыть в политике).

## 4. Фичефлаги прод-окружения

Проверить в `.env.production` на сервере (**читает пользователь — агент `.env*` не открывает**), значения сверить со схемой `src/lib/env.ts`:

| Флаг | Ожидание на публичном запуске |
|---|---|
| `NODE_ENV` | `production` (в `.env.example` стоит `development` — самая опасная ловушка) |
| `FEATURE_OPEN_REGISTRATION` | осознанное значение: `true` = открытая регистрация всем, `false` = закрытый контур |
| `FEATURE_BILLING_MOCK` | `true` пока платежи не подключены; `false` только вместе с закрытым H3 |
| `FEATURE_DEFAULT_PLAN` | план по умолчанию для новых пользователей соответствует квотам |
| SmartCaptcha `NEXT_PUBLIC_*` | ключ вшивается **на build** — после изменения обязателен пересбор, не рестарт |
| Секреты (`NEXTAUTH_SECRET`, `INBOX_SECRET_KEY`, `MARKETPLACE_SECRET_KEY`) | прод-значения, не дев; fail-fast проверит не все — `MARKETPLACE_SECRET_KEY` проверить глазами |

Дефолтный seed-админ (`admin@openfinance.local`) должен быть с изменённым паролем или удалён — **blocker**.

## 5. Ёмкость и лимиты (риск публичного запуска)

- **Ровно один процесс приложения.** Rate-limit (`src/lib/rate-limit.ts`), token-bucket Ozon (40 RPS per-clientId), лимит курсов (1/мин на тенант), кэш аналитики — всё **in-memory per-process**. Следствия, которые надо принять сознательно: (а) горизонтально не масштабируется, (б) лимиты обнуляются рестартом, (в) второй инстанс их ломает. `ioredis`/`bullmq` не установлены; вынос в Redis — H2.
- CSP включена только в prod — проверить, что она реально отдаётся (`curl -skI https://<хост>/ | grep -i content-security-policy`).
- Автосинка Ozon и автозабора почты нет (воркера не существует) — если публичным пользователям это обещано, это **blocker** продуктовой части.

## 6. Бэкапы и восстановление

- Регулярный `pg_dump -Fc` настроен и **выгружается за пределы Pi**; дамп содержит финданные, ПДн и зашифрованные секреты.
- `.env.production` бэкапится **отдельно** от дампов — без `INBOX_SECRET_KEY`/`MARKETPLACE_SECRET_KEY` восстановленный дамп не расшифрует креды Ozon/IMAP.
- Восстановление хоть раз проверено на практике (не «по инструкции»). Не проверено = **warning**, для публичного запуска с чужими данными — **blocker**.
- Порядок отката релиза — `.claude/skills/of-deploy-pi/SKILL.md` §6.

## 7. Вердикт

Выдать таблицу «пункт → ok/warning/blocker → что делать», затем одну строку вердикта: **можно открывать** (0 blocker'ов) или **нельзя, N блокеров**. Ни один пункт не пропускать молча: «не проверял» = warning, а не ok.
