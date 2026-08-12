---
name: of-db-change
version: 1.0.0
description: |
  Procedure for Open Finance DB schema changes (Drizzle + Postgres 16 + pgvector, multi-tenant): schema file → index registration → init SQL → generate → hand migration commands to the user.
  TRIGGER when: user asks for a new table, schema change, new column, index, or embeddings table.
  DO NOT TRIGGER when: query-only changes without schema impact.
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Bash
---

# Изменение схемы БД

> Правила домена (multi-tenant, postgres.js gotchas, JSONB merge, onConflictDoUpdate) — в `.cursor/rules/drizzle.mdc`. **Прочитать первым шагом.**

## Чеклист

1. **Schema-файл:** `src/lib/db/schema/<домен>.ts` (один домен — один файл, kebab-case, `// PURPOSE: ...`). КАЖДАЯ таблица: `tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' })`. `relations()` рядом с таблицей.
2. **Регистрация:** `src/lib/db/schema/index.ts`.
3. **Workspace-скоуп:** таблица с пользовательскими раскладками/вкладками заводится сразу с `workspace_id uuid NOT NULL` (FK на `workspaces`, `onDelete: 'cascade'`) и уникальностью по `(workspace_id, page_key)`, а НЕ по `(tenant_id, user_id, page_key)` — детали в `drizzle.mdc` §«Workspace-скоуп».
4. **Идемпотентный миррор:** каждая схемная новинка дублируется в `drizzle/init/NN-<имя>.sql` (следующий номер по порядку, всё через `IF NOT EXISTS`) — им наливают дев-базы и восстанавливают руками. Для `*_embeddings` — HNSW-индекс в `drizzle/init/02-vector-indexes.sql`. Разовые data-фиксы (не DDL) — `drizzle/data/YYYY-MM-DD_<имя>.sql`, вне журнала.
5. **Генерация:** `pnpm db:generate` (это можно выполнять самому). **Сразу после — проверить, что миграция попала в журнал:**

```bash
python3 -c "
import json,glob,os
j={e['tag'] for e in json.load(open('drizzle/meta/_journal.json'))['entries']}
f={os.path.basename(p)[:-4] for p in glob.glob('drizzle/*.sql')}
print('нет в журнале:', sorted(f-j) or '—'); print('нет файла:', sorted(j-f) or '—')"
```

Файл вне `_journal.json` мигратор просто не увидит. Если пара миграций осмысленна только вместе (двухфазный бэкфилл: nullable → `UPDATE` → `NOT NULL` → swap uniq) — пометить это в `CHANGELOG.md`: накатываются одним заходом.

6. **Применение — ТОЛЬКО командами для пользователя** (самому НЕ запускать). Процедура, прод-путь и починка рассинхрона журнала — **`.claude/skills/of-db-migrate/SKILL.md`**. Коротко:

```bash
pnpm db:migrate             # канонический путь; на проде — ТОЛЬКО он, никогда db:push
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/NN-имя.sql
```

**В базе, где хоть раз выполнялся `db:migrate`, `db:push` запрещён навсегда** (и наоборот) — смешение режимов ломает журнал.

7. **Queries-слой:** доступ через queries-модуль домена, фильтрация по `session.tenantId` в каждом запросе; routes — top-level try/catch + `NextResponse.json({ ok, ... })`.
8. **Документация:** `MEMORY.md` — раздел соответствующего модуля; запись в CHANGELOG при релизе.

## Частые грабли (детали в drizzle.mdc)

- `Date` в raw `sql\`...\`` → `TypeError`; только `.toISOString()` + `::timestamp` cast.
- JSONB merge через `|| ${JSON.stringify(meta)}::jsonb`.
- Поздние sync-стейджи не затирают ранние: `COALESCE(${value}, table.column)` в `onConflictDoUpdate.set`.
