---
name: of-db-migrate
version: 1.0.0
description: |
  Safely applying Drizzle migrations in Open Finance (dev and prod) and repairing a desynced `drizzle.__drizzle_migrations` journal: diagnostics, baseline insert, index-name check, and the never-mix-push-and-migrate rule.
  TRIGGER when: user says «накати миграции», «db:migrate падает», «already exists при миграции», «журнал миграций разъехался», or a finished schema change needs to reach a database.
  DO NOT TRIGGER when: designing the schema itself (use `of-db-change`) or doing a full production deploy (use `of-deploy-pi`, which calls this one for the migration step).
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# Применение миграций Open Finance

> Правила домена (multi-tenant, `workspace_id`-скоуп, postgres.js-грабли, JSONB merge) — `.cursor/rules/drizzle.mdc`. **Прочитать первым шагом.**
> Проектирование схемы и генерация миграции — `.claude/skills/of-db-change/SKILL.md`. Прод-контур — `.claude/skills/of-deploy-pi/SKILL.md`.
> Первоисточник свежей грабли про журнал — `LEARNING_LOG.md`, запись **2026-08-12 «`db:push` в дев-БД ломает журнал Drizzle»**. Здесь — процедура, текст граблей не дублируем.

## Главное правило

**Одна база — один режим.** `db:push` синхронизирует схему «как есть» и НЕ пишет в журнал; `db:migrate` проигрывает историю по журналу. Общего состояния у них нет.

- В базе, где хоть раз выполнялся `db:migrate`, **`db:push` запрещён навсегда** (в т.ч. на дев-БД).
- На проде — **только `db:migrate`**: `push` сносит HNSW/FTS/trgm-индексы, которых нет в Drizzle-схеме.
- Оба режима — **жёсткое правило проекта: агент их не запускает**, только выдаёт команды пользователю (локально `pnpm db:migrate` и так стоит в `deny` в `.claude/settings.json`).

## 1. Пред-проверки перед выдачей команд

### 1.1 Миграция попала в журнал

`drizzle-kit generate` иногда оставляет `.sql`-файл без записи в `_journal.json` (ручное переименование, слияние веток, оборванный запуск). Мигратор такой файл **не увидит**, а `drizzle/init/*.sql` его не подстрахует.

```bash
ls drizzle/*.sql | wc -l
python3 -c "import json;print(len(json.load(open('drizzle/meta/_journal.json'))['entries']))"
python3 -c "
import json,glob,os
j={e['tag'] for e in json.load(open('drizzle/meta/_journal.json'))['entries']}
f={os.path.basename(p)[:-4] for p in glob.glob('drizzle/*.sql')}
print('нет в журнале:', sorted(f-j) or '—')
print('нет файла:', sorted(j-f) or '—')"
```

Файл вне журнала — это либо забытая миграция (добавить запись), либо **дубль-сирота** (тот же DDL уже есть в другой, журнальной миграции) → удалить, чтобы не сбивать диагностику. Различить можно `grep`'ом по DDL в остальных `drizzle/*.sql`.

### 1.2 Парные миграции

Если пара миграций осмысленна только вместе (двухфазный бэкфилл: nullable → `UPDATE` → `NOT NULL` → swap uniq), это отмечается в `CHANGELOG.md`/`MEMORY.md` и они **накатываются одним заходом**. Промежуточное состояние ломает приложение.

### 1.3 Что реально применено в целевой базе

```bash
docker exec openfinance-postgres psql -U openfinance_user -d openfinance_dev -tAc \
  "SELECT count(*) FROM drizzle.__drizzle_migrations"
docker exec openfinance-postgres psql -U openfinance_user -d openfinance_dev -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"
```

Симптом рассинхрона: **записей в журнале сильно меньше, чем файлов миграций, при том что таблицы уже есть** → схему наливал `db:push`. Прямой запуск `db:migrate` в таком состоянии упадёт на первом `CREATE TABLE ... already exists`.

## 2. Штатное применение

```bash
# dev (Docker, база openfinance_dev)
pnpm db:migrate

# прод (CLI читает только .env.local/.env → DATABASE_URL передавать ЯВНО)
DATABASE_URL='postgresql://openfinance_user:<пароль>@127.0.0.1:5434/openfinance' pnpm db:migrate

# после схемных операций — повторить векторные индексы
docker exec -i openfinance-postgres psql -U openfinance_user -d <база> -v ON_ERROR_STOP=1 \
  < drizzle/init/02-vector-indexes.sql
```

Перед прод-миграцией — **`pg_dump -Fc` без исключений** (см. `of-deploy-pi` §3).

## 3. Рассинхрон журнала → baseline (а не `push` поверх)

Цель: объявить уже применённые миграции применёнными, чтобы `db:migrate` накатил ровно недостающие.

1. **Бэкап:** `pg_dump -Fc` целевой базы. Без него дальше не идти.
2. **Определить границу:** какие теги фактически применены (сверить состав таблиц/колонок с содержимым `drizzle/NNNN_*.sql`). Ошибка в границе = либо повторное применение, либо пропуск.
3. **Проверить имена индексов, которые ближайшие миграции ДРОПАЮТ.** `db:push` мог создать их под другими именами; `DROP INDEX` без `IF EXISTS` тогда упадёт:

```bash
grep -n "DROP INDEX" drizzle/*.sql
docker exec openfinance-postgres psql -U openfinance_user -d <база> -tAc \
  "SELECT indexname FROM pg_indexes WHERE schemaname='public' ORDER BY 1"
```

Расхождение — переименовать индекс в базе под ожидаемое имя (`ALTER INDEX ... RENAME TO ...`), а не править файл миграции.

4. **Вставить baseline-записи.** Для каждого применённого тега: `hash` = **sha256 содержимого файла `drizzle/<tag>.sql`**, `created_at` = поле `when` соответствующей записи из `drizzle/meta/_journal.json` (миллисекунды).

```bash
# посчитать хеши (сверить с тем, что ждёт мигратор)
for f in drizzle/0000_*.sql drizzle/0001_*.sql; do echo "$(shasum -a 256 "$f")"; done

# сам INSERT — командой пользователю, по одной строке на тег:
# INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('<sha256>', <when_ms>);
```

5. **Проверка:** `SELECT count(*) FROM drizzle.__drizzle_migrations` = число применённых тегов; затем `pnpm db:migrate` — должен накатить только недостающие и завершиться без ошибок.

Мигратор берёт `max(created_at)` последней записи и применяет всё, у чего `folderMillis` больше — поэтому важны именно `created_at` из `_journal.json`, а не «сейчас».

## 4. Конвенции миграций проекта (проверять при генерации)

- **Numbered-миграция + идемпотентный миррор** `drizzle/init/NN-<имя>.sql` для схемных нововведений — миррор используется при ручной наливке и на свежих дев-базах, поэтому пишется через `IF NOT EXISTS`.
- **Разовые data-фиксы** (не DDL) — `drizzle/data/YYYY-MM-DD_<имя>.sql`, вне журнала, применяются осознанно.
- **Новая таблица с пользовательскими раскладками/вкладками** заводится сразу с `workspace_id NOT NULL` + uniq `(workspace_id, page_key)` — детали в `drizzle.mdc` §«Workspace-скоуп».
- `ON CONFLICT` в upsert обязан совпадать с реальным уникальным индексом (иначе рантайм-ошибка, а не ошибка типов).
- RLS в базе нет — изоляция только через `requireTenant()`/`requireTenantRoute()`; после схемных правок прогонять `pnpm check:tenant-isolation`.

## 5. Отчёт

Сообщить: какие теги применены, какие пропущены и почему, путь к бэкапу, потребовался ли baseline (и на каких тегах), результат повторного `db:migrate`.
