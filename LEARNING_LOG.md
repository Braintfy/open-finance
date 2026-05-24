# LEARNING_LOG.md — append-only AI learnings

> Append-only журнал для новых граблей/инсайтов. AI-агенты пишут сюда **в момент обнаружения** проблемы.
> Раз в неделю (или при значимой версии) релевантные записи переезжают в `MEMORY.md` (раздел «Активные грабли»).
> Цель — не терять знания между сессиями, не раздувая основную память.

## Формат записи

```markdown
### YYYY-MM-DD — короткое название

**Контекст:** что делал, какой файл/модуль.
**Грабля:** что произошло.
**Причина:** почему.
**Фикс:** что сделал.
**Урок:** что запомнить на будущее (в одну строку).
```

## Записи

### 2026-05-23 — mempalace migrate не работает в sandbox

**Контекст:** Попытка починить mempalace через AI-агента (Cursor).
**Грабля:** `mempalace migrate --yes` падает с `PermissionError: [Errno 1] Operation not permitted: '/Users/firay/.mempalace/palace.pre-migrate.20260523_*'`.
**Причина:** Cursor sandbox блокирует запись в home directory (`~/.mempalace/` — read-only из workspace).
**Фикс:** Оформить как runbook (`docs/MEMPALACE_RUNBOOK.md`) для ручного выполнения пользователем; AI-агент только подсказывает команды.
**Урок:** Все операции над `~/.mempalace/*` (migrate, repair, prune) — только manual через user terminal, не через AI sandbox.

### 2026-05-23 — `MEMORY.md` достиг 908 строк (×9 от заявленного)

**Контекст:** Audit проекта по запросу пользователя «обнови файлы проекта и память».
**Грабля:** `MEMORY.md` объявлен как «~5K токенов» в `CLAUDE.md`, фактически 908 строк (~45K токенов). При каждом старте сессии съедает 25%+ контекста Claude Sonnet 200K.
**Причина:** Накопительный bias — каждая версия (v0.10 → v0.22) дописывала свой раздел без удаления предыдущих. Грабли v0.10 v0.20 v0.21 все одновременно «активные».
**Фикс:** Разделить на `MEMORY.md` (текущее состояние, активные инварианты — 321 строка) + `docs/memory-archive/v{X.Y}-v{X.Z}.md` (исторические нарративы по версиям, читаются по запросу).
**Урок:** При обновлении `MEMORY.md` — критически смотреть, что устаревает. Грабли v0.10 удалять/архивировать, если они уже не повторяются с v0.20+. Использовать `git log MEMORY.md` для аудита размера раз в N версий.

### 2026-05-23 — устаревшие версии в MemPalace индексе

**Контекст:** Изучение `~/.mempalace/` для bootstrap'а.
**Грабля:** `mempalace wake-up --wing open-finance` тащит и упоминания Tauri-only архитектуры, Prisma, Python sidecar (концепции отброшенные на этапе v0.4-v0.6).
**Причина:** MemPalace не различает «исторический контекст» и «текущая правда». Любая drawer весит одинаково в поиске.
**Фикс:** В `START.md` / `CLAUDE.md` запрет на использование `wake-up` для bootstrap'а. Только точечный `search` для конкретных вопросов «когда мы X». Источник правды для current state — `MEMORY.md`.
**Урок:** AI-память (mempalace, vector store) ≠ source of truth. Source of truth = код + `MEMORY.md`. Memory = археология.

### 2026-05-23 — Cursor 2026 ввёл `.cursor/rules/*.mdc` вместо `.cursorrules`

**Контекст:** Research best practices для AI-памяти.
**Грабля:** В проекте только `CLAUDE.md` + `AGENTS.md`, нет path-scoped правил. Все правила глобальные → loaded в каждом запросе, даже если работаем с одним блоком.
**Причина:** Старый `.cursorrules` (deprecated в Cursor 2025) — единый файл. Новый формат `.cursor/rules/*.mdc` с `globs:` позволяет auto-attach только релевантных rules.
**Фикс:** Создать `.cursor/rules/{project-context,blocks,marketplaces,ai-tools,drizzle,security,unit-economics}.mdc`. Один always-on (`project-context`), остальные path-scoped.
**Урок:** Экономия токенов = ×3-5 в зависимости от задачи. При работе с marketplaces подгружаются только marketplaces.mdc + project-context.mdc (~5K вместо ~25K общих rules).

### 2026-05-23 — `.cursor/` папка blocked sandbox-ом по умолчанию

**Контекст:** `mkdir .cursor/rules`.
**Грабля:** `mkdir: /Users/firay/open-finance/open-finance/.cursor: Operation not permitted` даже в workspace.
**Причина:** `.cursor/` — конфигурация IDE, по умолчанию sandbox не пускает агентов писать в неё.
**Фикс:** `mkdir -p .cursor/rules` с `required_permissions: ["all"]`. Дальше `Write` в `.cursor/rules/*.mdc` работает нормально.
**Урок:** Для создания `.cursor/*` всегда использовать full permissions. Для последующих правок отдельных файлов — обычно OK без эскалации.

### 2026-05-24 — mempalace окончательно сломан (Issue #832), переход на agentmemory

**Контекст:** Пользователь повторно попытался `mempalace migrate --yes` в своём терминале. Команда зависла на стадии «Migrating» после 30+ минут на 148.6MB chroma.sqlite3.
**Грабля:** `mempalace` использует `chromadb.PersistentClient` (embedded SQLite + HNSW). Hooks + sync routines + agent MCP конкурируют за один SQLite — destructive segment locks повреждают HNSW индекс. Это [Issue #832](https://github.com/MemPalace/mempalace/issues/832), уже подтверждено мейнтейнерами.
**Причина:** Архитектурная — chromadb embedded mode не thread/process-safe для concurrent writers. Fix требует standalone Chroma HTTP server (PR в #832, не merged).
**Фикс:** Перешли на [agentmemory](https://github.com/rohitg00/agentmemory) (17K stars, v0.9.21, май 2026). MCP server на localhost:3111, 51 tools, BM25 + Vector (local @xenova/transformers) + Knowledge Graph через RRF. 95.2% R@5 на LongMemEval-S. Storage — local SQLite через `iii-engine v0.11.2` (native Rust runtime, обходит chromadb concurrency проблему).
**Урок:** Embedded vector DB (chromadb, qdrant-embedded, lancedb) — плохой выбор для multi-process AI agent integrations. Использовать либо standalone HTTP server, либо native runtime с правильной concurrency (iii-engine, rocksdb).

### 2026-05-24 — agentmemory README критично отличается от dev.to статьи

**Контекст:** Сначала спланировал установку по dev.to обзору (npx-only, минимум 1900 токенов/сессия).
**Грабля:** В официальном README обнаружил детали, которые dev.to пропустил:
1. **iii-engine v0.11.2** — обязательный native binary (без него agentmemory работает в degraded MCP-only mode без REST/viewer/cron).
2. **MCP shim даёт только 7 tools** в standalone mode (без server), полные 51 tools — только когда видит работающий server через `AGENTMEMORY_URL`.
3. **`@xenova/transformers`** — отдельная зависимость для local embeddings (~300MB модель), без неё BM25-only.
4. **NO-OP LLM provider по умолчанию** — без `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` LLM compression отключён, только синтетический BM25.
5. **`AGENTMEMORY_AUTO_COMPRESS=false`** OFF by default после Issue #138 (vagrant token spend).
6. **`agentmemory connect cursor`** — однокомандный wire в `~/.cursor/mcp.json` (альтернатива нашему ручному merge).
7. **`agentmemory import-jsonl`** — миграция из Claude Code транскриптов.
8. **npx version cache** — `npx @agentmemory/agentmemory` может подавать stale 0.9.14 если запускался ранее. Решение: `npx -y @agentmemory/agentmemory@latest` или global install.
**Фикс:** Обновил `install-agentmemory.sh` (ставит iii-engine + @xenova/transformers + опц. global agentmemory), launchd plist (добавил `~/.local/bin` в PATH), `docs/MEMORY_SETUP.md` (полная картина с runtime + LLM провайдерами).
**Урок:** **ВСЕГДА читать официальный README**, не только третьесторонние обзоры. Dev.to статьи дают концептуальное понимание, но опускают critical install details. Перед deployment чужого open-source — `git clone` или хотя бы Read raw README.md с GitHub.

---

## Как использовать

**Когда писать:**
- Натолкнулся на проблему/грабли, которой не было в `MEMORY.md` → запись в LEARNING_LOG.
- Обнаружил полезный pattern → запись.
- Сделал нетривиальный фикс → запись.

**Когда чистить:**
- При релизе минорной версии — пройтись по LEARNING_LOG, релевантные сжать и перенести в `MEMORY.md` («Активные грабли»).
- Устаревшие (фиксили в коде, больше не воспроизводится) — удалить из LOG, оставить запись в `docs/memory-archive/`.

**Никогда не делать:**
- Не редактировать чужие записи (append-only).
- Не удалять записи без понимания контекста.
- Не дублировать с `MEMORY.md` — если уже там, не нужно в LOG.
