---
name: of-deploy-pi
version: 1.0.0
description: |
  Canonical production deploy routine for Open Finance on the Raspberry Pi 5 mini-server: rsync → install → build → migrate → restart → health check. Covers backup-before-migration, the migration/restart ordering rule, and post-deploy verification.
  TRIGGER when: user says «задеплой на Pi», «выкати на прод», «обнови сервер», «релиз на минисервер», or asks to apply a finished change on the production server.
  DO NOT TRIGGER when: first-time provisioning of a fresh Pi (that is `docs/DEPLOY_RPI5.md` phases A-H), local dev work, or migration mechanics only (use `of-db-migrate`).
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# Прод-деплой Open Finance на Raspberry Pi

> **Справочник по железу и фазам первого деплоя** — `docs/DEPLOY_RPI5.md` (фазы A-H, реестр граблей §11). Этот скил — **рутина обновления уже живого сервера**.
> **Правила безопасности** при работе с секретами/сетью — `.cursor/rules/security.mdc` + `docs/SECURITY.md`. VLESS/Xray — `deploy/xray/README.md` и `security.mdc` §VLESS/Xray.
> **Версии нигде не хардкодим:** источник — первый `## [X.Y.Z]` в `CHANGELOG.md`, в рантайме `NEXT_PUBLIC_APP_VERSION`.

## Координаты прод-сервера

| Что | Значение |
|---|---|
| SSH | `ssh -i ~/.ssh/openfinance_pi firay@192.168.31.222` — **провод (eth0), основной путь**; passwordless sudo |
| Резервные адреса | `192.168.31.225` (wlan0, Wi-Fi) и `openfinance.local` (mDNS). Оба живы: провод — метрика 100, Wi-Fi — 600, при обрыве кабеля сервер сам уходит на радио |
| Доступность | **только LAN.** Вне домашней сети сервер недоступен полностью (в т.ч. для агента) — см. отложенный Tailscale в `docs/ROADMAP_V2.md` |
| Путь приложения | `/home/firay/open-finance` (**не** `/var/www/...` — план в `DEPLOY_RPI5.md` §6 описывает другой путь, реальный деплой сделан в домашнюю директорию) |
| Владелец процесса | `firay` |
| systemd-юнит | `open-finance` (`EnvironmentFile=/home/firay/open-finance/.env.production`) |
| БД | Postgres в Docker, контейнер `openfinance-postgres`, `127.0.0.1:5434`, база `openfinance`, пользователь `openfinance_user` |
| VPN для AI | Xray VLESS+REALITY на `127.0.0.1:10809`; юниты `of-xray-apply.{path,service}`, spool — см. `deploy/xray/README.md` |
| Логи деплоя на Pi | `/home/firay/{install,build,start}.log` |

**Код на Pi доставляется `rsync` с Mac, а НЕ `git clone`** — в рабочем дереве регулярно живут ещё не закоммиченные фиксы, и прод исторически опережает `HEAD`. Из этого следует: после успешного деплоя обязательно выдать пользователю команду коммита, иначе история разъедется с продом.

## 0. Пред-полётные проверки (на Mac, до единой команды по SSH)

1. **Верификация зелёная** — скил `of-verify` (typecheck → build → доменные smoke). Деплой красного дерева запрещён.
2. **Что именно едет:** `git status --short` + `git diff --stat`. Если есть незакоммиченное — это нормально (см. выше), но зафиксировать в отчёте.
3. **Есть ли новые миграции:** сверить `ls drizzle/*.sql` с `drizzle/meta/_journal.json` и с тем, что применено на проде — процедура в `.claude/skills/of-db-migrate/SKILL.md`. Если миграции есть — деплой становится «с миграцией» (раздел 3), а не простым.
4. **Не идёт ли синк Ozon** (graceful shutdown нет — рестарт посреди синка рвёт job):

```bash
ssh -i ~/.ssh/openfinance_pi firay@192.168.31.222 \
  "docker exec openfinance-postgres psql -U openfinance_user -d openfinance -tAc \
   \"SELECT id, status FROM ozon_sync_jobs WHERE status IN ('pending','running')\""
```

Не пусто → дождаться завершения или согласовать с пользователем.

5. **Доступность сервера:** `ssh ... "systemctl is-active open-finance; uptime"`.

## 1. Синхронизация кода (rsync)

```bash
rsync -az --delete \
  --exclude=node_modules --exclude=.next --exclude=.git \
  --exclude='.env*' --exclude='.claude/worktrees' \
  -e "ssh -i ~/.ssh/openfinance_pi" \
  /Users/firay/open-finance/open-finance/ firay@192.168.31.222:/home/firay/open-finance/
```

- `--exclude='.env*'` **обязателен**: `.env.production` на сервере собран вручную и не должен затираться дев-значениями. `.env.local` на сервере создавать НЕЛЬЗЯ — он молча перебивает `.env.production`.
- `--exclude=node_modules` / `.next` **обязательны**: бинари с macOS (swc, sharp) на ARM64 не работают.
- `--exclude='.claude/worktrees'` — иначе на прод уезжают гигабайты чужих деревьев.
- Сначала прогнать с `--dry-run`, если правок много или менялась структура каталогов (`--delete` удаляет на сервере то, чего нет локально).

## 2. Установка зависимостей и сборка (на Pi)

```bash
cd /home/firay/open-finance
pnpm install --frozen-lockfile
set -a && . ./.env.production && set +a
NODE_OPTIONS=--max-old-space-size=6144 pnpm build
```

- `set -a && . ./.env.production && set +a` **обязателен перед build**: `NEXT_PUBLIC_*` (в т.ч. ключ SmartCaptcha) вшиваются в бандл на этапе сборки, а не читаются в рантайме.
- Сборка ~3 минуты. Ollama на Pi (если запущен) на время сборки лучше остановить.
- Сборка **не влияет на работающий процесс** — старая версия продолжает обслуживать запросы до рестарта.

## 3. Миграции — строго между сборкой и рестартом

**Правило порядка:** схема БД должна стать новой **раньше**, чем стартует новый код, а окно «новая схема ↔ старый код» — секунды. Поэтому: сборка → бэкап → миграция → **сразу** рестарт. Никогда не мигрировать до сборки (сборка может упасть и оставить прод со схемой из будущего на часы).

**Жёсткое правило проекта: агент миграции сам не запускает.** Команды ниже — пользователю; выполнять их можно только после явного подтверждения в этой сессии.

```bash
# 3.1 БЭКАП ПЕРЕД МИГРАЦИЕЙ — обязателен, без исключений
ssh -i ~/.ssh/openfinance_pi firay@192.168.31.222 \
  "docker exec openfinance-postgres pg_dump -U openfinance_user -d openfinance -Fc \
   > /home/firay/backup-before-<теги-миграций>.dump && ls -lh /home/firay/backup-before-*.dump"

# 3.2 Миграция (CLI читает только .env.local/.env — DATABASE_URL передавать ЯВНО)
cd /home/firay/open-finance
DATABASE_URL='postgresql://openfinance_user:<пароль>@127.0.0.1:5434/openfinance' pnpm db:migrate

# 3.3 Только если миграция делала схемные операции — повторить векторные индексы
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance -v ON_ERROR_STOP=1 \
  < drizzle/init/02-vector-indexes.sql
```

- **`pnpm db:push` на проде запрещён навсегда** — он сносит HNSW/FTS/trgm-индексы, которых нет в Drizzle-схеме, и делает базу несовместимой с `db:migrate`. Диагностика и baseline журнала при рассинхроне — `.claude/skills/of-db-migrate/SKILL.md`.
- Парные миграции (например, «эта только вместе с предыдущей») накатывать одним заходом — проверять по `CHANGELOG.md`/`MEMORY.md` перед запуском.

## 4. Рестарт

```bash
ssh -i ~/.ssh/openfinance_pi firay@192.168.31.222 "sudo systemctl restart open-finance"
```

**Ровно один инстанс.** Никакого PM2 cluster и второго воркера: rate-limit, token-bucket Ozon (40 RPS), кэши аналитики — всё in-memory per-process; второй процесс ломает лимиты и даёт рассинхрон кэшей.

## 5. Health-чек (обязателен, деплой без него не считается завершённым)

```bash
ssh -i ~/.ssh/openfinance_pi firay@192.168.31.222 '
  systemctl is-active open-finance
  curl -sk -o /dev/null -w "%{http_code}\n" https://localhost/
  journalctl -u open-finance --since "5 min ago" -p err --no-pager | tail -30
  grep -o "NEXT_PUBLIC_APP_VERSION[^,]*" /home/firay/open-finance/.next/required-server-files.json
'
```

Критерии «зелено»:

1. `systemctl is-active` → `active`.
2. `curl` отдаёт 200 (или 307 на `/login`) — `-k` нужен, пока TLS self-signed.
3. В `journalctl` за окно рестарта нет `error`/фатальных стектрейсов. Фейл секретов даёт restart-loop (`StartLimitBurst`) — видно сразу.
4. Версия в `.next/required-server-files.json` совпадает с первым `## [X.Y.Z]` в `CHANGELOG.md`. **Не сверять по глазам в UI** — там может быть закэшированная страница.
5. Если деплой трогал VLESS/Xray — `deploy/xray/README.md`: юниты `active`+`enabled`, spool `firay:firay 0700`, конфиг `root:nogroup 0640`, `status.json` → `ok/applied`.
6. Если деплой трогал маршруты/queries — попросить пользователя прогнать `pnpm check:tenant-isolation` локально (на проде смысла нет, это статическая проверка кода).

## 6. Откат

Down-миграций в проекте нет. Порядок отката, от дешёвого к дорогому:

1. **Код без миграций:** повторить rsync с предыдущего состояния рабочего дерева (или `git stash`/checkout нужного коммита на Mac) → install → build → restart. Быстро, данные не трогаются.
2. **Код с миграцией:** откатывать нужно вместе с базой — восстановление дампа из шага 3.1:
   `docker exec -i openfinance-postgres pg_restore -U openfinance_user -d openfinance --clean --if-exists < backup-before-<теги>.dump`.
   Всё, что записано после бэкапа, теряется → сначала согласовать с пользователем, вторым дампом снять текущее состояние.
3. Если сервис не поднимается вообще — `journalctl -u open-finance -n 200 --no-pager`; типовые причины: отсутствующий секрет в `.env.production` (fail-fast), появившийся `.env.local`, занятый порт.

## 7. Отчёт пользователю

Обязательно сообщить: что уехало (диапазон изменений), применялись ли миграции и какие, путь к бэкапу, результат health-чека по пунктам 1-5, и **git-команды для коммита** того, что задеплоено (прод не должен опережать историю дольше одной сессии).

## Реестр граблей (короткий; полный — `docs/DEPLOY_RPI5.md` §11)

- `.env.example` содержит `NODE_ENV=development` — копирование в `.env.production` отключает прод-защиту.
- `.env.local` на сервере молча перебивает `.env.production`; CLI-скрипты (`db:*`, `admin:*`, `drizzle.config`) читают только `.env.local`/`.env` → `DATABASE_URL` передавать явно.
- `NEXT_PUBLIC_*` вшиваются на `pnpm build`, не в рантайме.
- Secure-cookie: по HTTP вход в prod невозможен — только HTTPS.
- Ротация `INBOX_SECRET_KEY`/`MARKETPLACE_SECRET_KEY` ломает расшифровку сохранённых кредов → `LEGACY_SECRET_KEYS=... pnpm admin:reencrypt-secrets` (команда пользователю).
- Vision-провайдеры прокси игнорируют — бьют напрямую в api.anthropic.com/api.openai.com.
- `node_modules`/`.next` с macOS на ARM64 не переносимы; `xlsx` тянется с cdn.sheetjs.com (нужен доступ в сеть).
- Бэкапы: `.env.production` бэкапить **отдельно** от дампов — без ключей восстановленный дамп не расшифрует креды Ozon/IMAP.
