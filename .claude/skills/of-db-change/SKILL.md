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
3. **Manual SQL (если нужен):** `drizzle/init/NN-<имя>.sql` — следующий номер по порядку. Для `*_embeddings` — HNSW-индекс в `drizzle/init/02-vector-indexes.sql`.
4. **Генерация:** `pnpm db:generate` (это можно выполнять самому).
5. **Применение — ТОЛЬКО командами для пользователя** (самому НЕ запускать):

```bash
pnpm db:push                # dev
# или prod-style: pnpm db:migrate
docker exec -i openfinance-postgres psql -U openfinance_user -d openfinance_dev < drizzle/init/NN-имя.sql
```

6. **Queries-слой:** доступ через queries-модуль домена, фильтрация по `session.tenantId` в каждом запросе; routes — top-level try/catch + `NextResponse.json({ ok, ... })`.
7. **Документация:** `MEMORY.md` — раздел соответствующего модуля; запись в CHANGELOG при релизе.

## Частые грабли (детали в drizzle.mdc)

- `Date` в raw `sql\`...\`` → `TypeError`; только `.toISOString()` + `::timestamp` cast.
- JSONB merge через `|| ${JSON.stringify(meta)}::jsonb`.
- Поздние sync-стейджи не затирают ранние: `COALESCE(${value}, table.column)` в `onConflictDoUpdate.set`.
