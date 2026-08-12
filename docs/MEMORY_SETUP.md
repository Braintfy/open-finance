# MEMORY_SETUP.md — AI-память для Open Finance

> Стек: **agentmemory** (MCP) + **`.cursor/rules/*.mdc`** + **`MEMORY.md`** + **`LEARNING_LOG.md`**.
>
> Старый стек: `mempalace` (deprecated с v0.22.4, см. `docs/MEMPALACE_RUNBOOK.md` для миграции).
>
> Документация на основе официального README [rohitg00/agentmemory](https://github.com/rohitg00/agentmemory) на v0.9.21 (май 2026).

## TL;DR

```bash
# Один раз, всё установить:
cd /Users/firay/open-finance/open-finance
./scripts/install-agentmemory.sh

# После установки — перезапустить Cursor (Cmd+Q и снова открыть).
# Проверить: в Settings → MCP Servers должна быть запись 'agentmemory' зелёная.
```

## Зачем

Каждый AI-агент (Cursor, Claude Code, Cline) забывает контекст после сессии. Решения:

1. **Flat-файлы** (`MEMORY.md`, `.cursor/rules/*.mdc`) — загружаются при старте, capped ~5K строк, ручное обслуживание. Хороши для **инвариантов и правил**.
2. **Векторная память** (agentmemory MCP) — фоновый сервер, авто-захват сессий, semantic retrieval. Хороша для **истории решений** («когда мы перешли с Prisma на Drizzle», «почему отказались от Tauri-only»).

Мы используем **оба**: статические правила в файлах, динамическая история в agentmemory.

## Стек

```
┌─────────────────────────────────────────────────────────────────┐
│  STATIC (всегда в контексте, читаются при старте)               │
├─────────────────────────────────────────────────────────────────┤
│  START.md (140) → bootstrap routing                             │
│  MEMORY.md (321) → текущее состояние + активные грабли          │
│  .cursor/rules/*.mdc → path-scoped правила (Cursor 2026)        │
│  CLAUDE.md / AGENTS.md → правила для агентов                    │
│  LEARNING_LOG.md → append-only AI learnings (новые грабли)      │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ дополняется по запросу
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  DYNAMIC (запрашивается через MCP при необходимости)            │
├─────────────────────────────────────────────────────────────────┤
│  agentmemory MCP server (localhost:3111)                        │
│    • 51 MCP tools (memory_smart_search, memory_save, ...)       │
│    • BM25 + Vector + Knowledge Graph (RRF fusion)               │
│    • Авто-захват через hooks (Claude Code) или manual через MCP │
│    • Local SQLite, ~50MB на 1000 сессий                         │
│    • Viewer: http://localhost:3113                              │
│    • REST API: http://localhost:3111/agentmemory/*              │
└─────────────────────────────────────────────────────────────────┘
                          │
                          │ опирается на
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  RUNTIME (нативный движок)                                      │
├─────────────────────────────────────────────────────────────────┤
│  iii-engine v0.11.2 (~/.local/bin/iii)                          │
│    • Native Rust binary, обязателен для REST/viewer/cron        │
│    • Без него agentmemory работает только в MCP-only mode       │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  ARCHIVES (read-only, по запросу)                               │
├─────────────────────────────────────────────────────────────────┤
│  docs/memory-archive/v{X.Y}-v{X.Z}.md → исторические нарративы  │
│  CHANGELOG.md → детали релизов                                  │
│  ~/.cursor/projects/.../agent-transcripts/ → raw transcripts    │
└─────────────────────────────────────────────────────────────────┘
```

## Что устанавливается

| Компонент | Где | Зачем |
|---|---|---|
| **iii-engine** v0.11.2 | `~/.local/bin/iii` (5MB) | Нативный Rust runtime для REST/viewer/cron. БЕЗ него agentmemory работает в degraded MCP-only mode. |
| **@agentmemory/agentmemory** | npm global или npx cache | Memory server (порт 3111 + viewer 3113). |
| **@xenova/transformers** (опц.) | npm global (300MB модель) | Local embeddings `all-MiniLM-L6-v2` — free vector search, +8pp recall vs BM25-only. |
| **launchd plist** | `~/Library/LaunchAgents/com.agentmemory.server.plist` | Auto-start на каждом login + автоматический restart при крэше. |
| **Cursor MCP entry** | `~/.cursor/mcp.json` → `mcpServers.agentmemory` | Cursor подключается к серверу через MCP shim `@agentmemory/mcp`. |
| **SQLite storage** | `~/.agentmemory/` (или `~/Library/Application Support/agentmemory/`) | Хранилище. ~50MB на 1000 сессий. |
| **Логи** | `~/Library/Logs/agentmemory.{out,err}.log` | stdout/stderr launchd-агента. |

## Быстрая установка (один раз)

### 1. Запустить установщик

```bash
cd /Users/firay/open-finance/open-finance
./scripts/install-agentmemory.sh
```

Скрипт **интерактивный** — спросит:
- Установить ли `@xenova/transformers` для local embeddings (Y, рекомендую).
- Установить ли `@agentmemory/agentmemory` глобально (Y, избегает npx version-cache проблем).

Что делает:
1. Проверяет Node.js ≥20.
2. Скачивает `iii-engine v0.11.2` в `~/.local/bin/iii` (5MB, prebuilt для macOS arm64/x64).
3. (Опц.) Ставит `@xenova/transformers` глобально.
4. (Опц.) Ставит `@agentmemory/agentmemory` глобально.
5. Загружает launchd-агент, ждёт первого запуска (до 60 секунд — на первом старте npx может скачивать пакеты).
6. Проверяет health endpoint и запускает `agentmemory doctor`.

### 2. Перезапустить Cursor

`Cmd+Q` и открыть снова. Cursor подцепит обновлённый `~/.cursor/mcp.json` (там уже добавлен `agentmemory`).

### 3. Проверить интеграцию

В Cursor: `Settings → MCP Servers` → должна быть запись **agentmemory** зелёным.

В терминале:
```bash
curl http://localhost:3111/agentmemory/health
# {"status":"ok",...}

# Все 51 MCP tools (если подключился к серверу):
# В Cursor: открой chat, спроси «какие memory_* тулы доступны»

# Открыть viewer
open http://localhost:3113
```

### 4. (Опц.) Импорт старых Claude Code транскриптов

Если использовал Claude Code CLI ранее (не Cursor) — можно импортировать историю:

```bash
./scripts/import-claude-transcripts.sh
```

> **Cursor JSONL формат отличается** от Claude Code — прямой импорт не сработает. Альтернатива: попросить агента прочитать важные транскрипты из `~/.cursor/projects/.../agent-transcripts/` и сохранить ключевые решения через MCP `memory_save`.

### 5. (Опц.) Claude Code plugin

Если используешь Claude Code CLI отдельно:

```bash
/plugin marketplace add rohitg00/agentmemory
/plugin install agentmemory
```

Это добавит 12 авто-capture hooks и 4 skills (`/recall`, `/remember`, `/session-history`, `/forget`). Cursor MCP уже даёт 51 инструмент, плагин Claude дополняет lifecycle.

## Использование в Cursor

### MCP shim vs full server (КРИТИЧНО)

`@agentmemory/mcp` package — **тонкий shim**:
- **Если он видит работающий сервер** через `AGENTMEMORY_URL` (наш случай: `http://localhost:3111`) → даёт **полные 51 tools** (proxy mode).
- **Если сервер недоступен** → fallback на **7 tools локально** (`memory_save`, `memory_recall`, `memory_smart_search`, `memory_sessions`, `memory_export`, `memory_audit`, `memory_governance_delete`).

Если в Cursor видишь только 7 tools — значит launchd-агент не работает. Проверь:
```bash
launchctl list | grep agentmemory
curl http://localhost:3111/agentmemory/health
tail -50 ~/Library/Logs/agentmemory.err.log
```

### Авто-капчер

Cursor пишет через MCP при значимых событиях. Минимум — вручную в чате:

> «Запиши в память: мы используем `OZON_TARIFF_VERSION = ozon_2026_04_07` для всех новых калькуляций. При смене тарифной сетки — создавать новый pack, не редактировать inplace.»

Агент вызовет `memory_save` через MCP. Это сохранится в `~/.agentmemory/` и будет доступно в следующих сессиях.

### Поиск в памяти

В чате:
> «Найди в памяти, почему мы отказались от Vercel AI SDK.»

Агент вызовет `memory_smart_search` → получит топ-5 релевантных drawers (BM25 + vector + graph RRF) и интегрирует в ответ.

### Авто-инжекция при старте сессии

В Cursor: при `SessionStart` MCP-клиент может вызвать `recall_context` prompt — agentmemory вернёт ~1900 токенов наиболее релевантного контекста для текущего проекта. Это **дополнение к** `MEMORY.md`, не замена.

Включается через **server-side env** в `~/.agentmemory/.env`:
```ini
AGENTMEMORY_INJECT_CONTEXT=true   # OFF by default (#143)
```

## LLM провайдеры (опционально)

**По умолчанию — NO-OP** (без LLM). LLM-backed compress/summarize ОТКЛЮЧЕНЫ. Синтетический BM25 compression + recall всё равно работают.

Что добавляет LLM:
- Автоматическое сжатие длинных observations в structured facts/concepts.
- Извлечение entities в knowledge graph.
- Слот-рефлексия (`memory_slot_*`).

Чтобы включить — создай `~/.agentmemory/.env`:

```bash
mkdir -p ~/.agentmemory
cat >> ~/.agentmemory/.env <<EOF
# Anthropic (рекомендую если есть подписка Claude Pro/Max)
# ANTHROPIC_API_KEY=sk-ant-...

# OpenAI (или совместимое: vLLM, LM Studio, Azure)
# OPENAI_API_KEY=sk-...
# OPENAI_MODEL=gpt-4o-mini

# Включить auto-compression на каждом PostToolUse hook
# AGENTMEMORY_AUTO_COMPRESS=true   # ВНИМАНИЕ: ожидай заметный token spend

# Knowledge graph extraction
# GRAPH_EXTRACTION_ENABLED=true

# Inject context в SessionStart
# AGENTMEMORY_INJECT_CONTEXT=true
EOF

# Restart server
launchctl unload ~/Library/LaunchAgents/com.agentmemory.server.plist
launchctl load -w ~/Library/LaunchAgents/com.agentmemory.server.plist
```

> **Heads-up**: `AGENTMEMORY_AUTO_COMPRESS=true` дорого по токенам — каждый PostToolUse hook вызывает LLM. Изначально оставляй OFF, включай прицельно если нужен compression.

### Claude subscription fallback (если нет API key)

Если есть только Claude Pro/Max подписка (без API key):

```bash
echo "AGENTMEMORY_ALLOW_AGENT_SDK=true" >> ~/.agentmemory/.env
echo "AGENTMEMORY_AUTO_COMPRESS=true" >> ~/.agentmemory/.env
```

> Это spawn'ит `@anthropic-ai/claude-agent-sdk` sessions. Известная проблема #149 — unbounded Stop-hook recursion. Опт-in only, не default.

## Bootstrap новой сессии (обновлено)

С agentmemory bootstrap не меняется — приоритет всё ещё static-файлы:

1. **`START.md`** — карта проекта (~5K токенов).
2. **`MEMORY.md`** — текущее состояние (**~30K токенов**).
3. **`git log --oneline -20`** (~0.5K). Итого ≈ 36K.
4. (Авто через MCP, если `AGENTMEMORY_INJECT_CONTEXT=true`) — agentmemory вернёт ~1900 токенов наиболее релевантного контекста.

Если agentmemory недоступен — bootstrap всё равно работает на static-файлах. **MCP добавляет ценность, но не блокирует работу.**

## Управление сервером

```bash
# Старт (load + autostart on login)
launchctl load -w ~/Library/LaunchAgents/com.agentmemory.server.plist

# Стоп
launchctl unload ~/Library/LaunchAgents/com.agentmemory.server.plist

# Перезапуск
launchctl unload ~/Library/LaunchAgents/com.agentmemory.server.plist && \
  launchctl load -w ~/Library/LaunchAgents/com.agentmemory.server.plist

# Статус
launchctl list | grep agentmemory

# Логи
tail -f ~/Library/Logs/agentmemory.out.log
tail -f ~/Library/Logs/agentmemory.err.log

# Health
curl http://localhost:3111/agentmemory/health

# Doctor (интерактивная диагностика)
agentmemory doctor                          # если global install
npx -y @agentmemory/agentmemory@latest doctor   # если только npx

# Размер хранилища
du -sh ~/.agentmemory/ 2>/dev/null || du -sh ~/Library/Application\ Support/agentmemory/ 2>/dev/null
```

## Альтернативные команды установки (из README)

### Если хочешь установить руками без скрипта

```bash
# 1. iii-engine (обязателен, иначе degraded mode)
mkdir -p ~/.local/bin
curl -fsSL https://github.com/iii-hq/iii/releases/download/iii/v0.11.2/iii-aarch64-apple-darwin.tar.gz \
  | tar -xz -C ~/.local/bin
chmod +x ~/.local/bin/iii
export PATH="$HOME/.local/bin:$PATH"   # добавь в ~/.zshrc

# 2. agentmemory глобально (рекомендую)
npm install -g @agentmemory/agentmemory
# Или через npx без install:
# npx -y @agentmemory/agentmemory@latest

# 3. Local embeddings (опц., но рекомендую)
npm install -g @xenova/transformers

# 4. Запустить сервер вручную (foreground)
agentmemory
# Или через npx:
# npx -y @agentmemory/agentmemory@latest

# 5. Wire Cursor MCP (альтернатива нашему manual edit ~/.cursor/mcp.json)
agentmemory connect cursor    # автоматически мерджит в ~/.cursor/mcp.json

# 6. Demo (увидеть как работает)
agentmemory demo              # засеет 3 примера и продемонстрирует recall
```

### Альтернатива через Docker (если не хочется ставить iii нативно)

```bash
git clone https://github.com/rohitg00/agentmemory.git
cd agentmemory
docker compose up -d
# Docker подтянет iiidev/iii:0.11.2 как контейнер
```

## Backup и restore

agentmemory хранит данные в SQLite. Полный backup = копия директории:

```bash
# Backup
DATE=$(date +%Y%m%d)
cp -R ~/.agentmemory ~/.agentmemory.backup-$DATE 2>/dev/null || \
  cp -R ~/Library/Application\ Support/agentmemory ~/Library/Application\ Support/agentmemory.backup-$DATE

# Через CLI (формат JSON для миграции на другую машину)
agentmemory                                  # сначала запустить сервер
curl http://localhost:3111/agentmemory/export > agentmemory-backup-$(date +%Y%m%d).json

# Restore из JSON
curl -X POST http://localhost:3111/agentmemory/import \
  -H "Content-Type: application/json" \
  -d @agentmemory-backup-20260524.json
```

## Безопасность

- **agentmemory работает только на localhost**. REST API и viewer биндятся к `127.0.0.1` по умолчанию.
- **Без auth** для localhost (нормально). НЕ выставлять наружу без `AGENTMEMORY_SECRET` (bearer token).
- **Локальные embeddings** (`@xenova/transformers all-MiniLM-L6-v2`) — нет утечки кода в облако.
- **Privacy filter** — agentmemory автоматически чистит API keys/secrets из observations до сохранения (`SHA-256 dedup + Privacy filter` в pipeline).
- **Секреты в логах** — если случайно `cat .env` в сессии попал — чистить через `memory_governance_delete` (audit-logged).
- **`<private>` теги** в комментариях кода — strips at storage time.

## Troubleshooting

### `Cursor не видит agentmemory в MCP Servers`

1. Полностью закрыть Cursor (`Cmd+Q`), не reload window.
2. Проверить `~/.cursor/mcp.json` — должна быть запись `agentmemory`.
3. Открыть Cursor → Settings → MCP → проверить статус.
4. Если красный — View → Output → выбрать MCP в dropdown — посмотреть ошибку.

### `Видно только 7 tools вместо 51`

MCP shim не достучался до сервера. См. секцию "MCP shim vs full server" выше:
```bash
launchctl list | grep agentmemory   # должен показать PID и exit code 0
curl http://localhost:3111/agentmemory/health
tail -50 ~/Library/Logs/agentmemory.err.log
```

### `curl http://localhost:3111/agentmemory/health` возвращает Connection refused

```bash
# Загружен ли launchd-агент?
launchctl list | grep agentmemory

# Логи запуска
tail -100 ~/Library/Logs/agentmemory.err.log

# Чаще всего: iii-engine не найден
ls -la ~/.local/bin/iii
# Если нет — запусти установщик заново или поставь iii вручную (см. выше)

# Если iii есть, но сервер падает — попробуй вручную с verbose
launchctl unload ~/Library/LaunchAgents/com.agentmemory.server.plist
npx -y @agentmemory/agentmemory@latest --verbose
# Смотри stderr на конкретную ошибку
```

### `iii-engine process started then did not become ready within 15s`

iii-engine упал. Возможные причины:
- Port conflict на 3111/3112/3113/49134. Проверь: `lsof -iTCP -sTCP:LISTEN | grep -E '3111|3112|3113|49134'`.
- Битый бинарник. Переустанови: `rm ~/.local/bin/iii && ./scripts/install-agentmemory.sh`.
- macOS Gatekeeper заблокировал. Попробуй `xattr -d com.apple.quarantine ~/.local/bin/iii`.

### `npx @agentmemory/mcp` падает с ENOENT

Cursor MCP shim не находит `npx`. Проверь путь в `~/.cursor/mcp.json`:
```bash
which npx
# Если /Users/firay/.volta/bin/npx — обновить mcp.json:
# "command": "/Users/firay/.volta/bin/npx"
```

### Кэш npx подаёт старую версию

```bash
rm -rf ~/.npm/_npx
# Или принудительно последняя
npx -y @agentmemory/agentmemory@latest
```

### `Сервер ест >500MB RAM`

`AGENTMEMORY_AUTO_COMPRESS=true` с большим количеством tool uses → каждый hook вызывает LLM. Отключи:
```bash
sed -i.bak '/AGENTMEMORY_AUTO_COMPRESS/d' ~/.agentmemory/.env
launchctl unload ~/Library/LaunchAgents/com.agentmemory.server.plist
launchctl load -w ~/Library/LaunchAgents/com.agentmemory.server.plist
```

### Хочу выключить временно

```bash
launchctl unload ~/Library/LaunchAgents/com.agentmemory.server.plist
```

MCP-shim в Cursor продолжит работать в **fallback mode (7 tools)**. Никакой потери функциональности — просто без semantic recall истории.

### Хочу удалить полностью

```bash
launchctl unload ~/Library/LaunchAgents/com.agentmemory.server.plist
rm ~/Library/LaunchAgents/com.agentmemory.server.plist
rm -rf ~/.agentmemory ~/Library/Application\ Support/agentmemory 2>/dev/null
npm uninstall -g @agentmemory/agentmemory @xenova/transformers
rm -f ~/.local/bin/iii

# Убрать из ~/.cursor/mcp.json запись 'agentmemory' вручную
# Или вернуть из backup ~/.cursor/mcp.json.backup-YYYYMMDD-HHMMSS

# Если ставили через CLI
agentmemory remove   # должно почистить всё что создавалось
```

## Когда НЕ использовать agentmemory

- **Bootstrap новой сессии** — всё равно `START.md` + `MEMORY.md` + `git log -20`. MCP-память дополняет, не заменяет.
- **Поиск кода** — `Grep`/`Glob` точнее и быстрее.
- **Текущее состояние проекта** — `MEMORY.md`.
- **История релизов** — `git log` + `CHANGELOG.md`.

agentmemory ценен для **«семантической археологии»** — когда не помнишь название переменной/файла, но помнишь смысл.

## Сравнение с альтернативами (май 2026)

| Тул | R@5 | Stars | Auto-capture | Storage | Цена | Зрелость |
|---|---|---|---|---|---|---|
| **agentmemory** (наш выбор) | 95.2% | 17K | 12 hooks | SQLite + iii-engine | Free (local) | v0.9.21, стабильно |
| mem0 | 68.5% | 53K | Manual | Qdrant/pgvector | Cloud-first | Зрелый |
| Letta/MemGPT | 83.2% | 22K | Self-edits | Postgres | Free OSS | Зрелый, heavy |
| mempalace (прежний) | N/A | small | hooks | ChromaDB | Free | Issue #832 broken |
| CLAUDE.md (flat) | N/A | — | Manual | File | Free | Built-in |

## Полезные ссылки

- **agentmemory repo**: <https://github.com/rohitg00/agentmemory>
- **agentmemory site**: <https://www.agent-memory.dev>
- **iii-engine releases**: <https://github.com/iii-hq/iii/releases>
- **iii docs**: <https://iii.dev/docs>
- **MCP spec**: <https://modelcontextprotocol.io>
- **MemPalace migration guide** (deprecated стек): `docs/MEMPALACE_RUNBOOK.md`

## Версии (зафиксированы)

| Компонент | Версия | Проверено |
|---|---|---|
| iii-engine | v0.11.2 (pinned — v0.11.6 требует agentmemory refactor) | 2026-05-24 |
| @agentmemory/agentmemory | latest (v0.9.21 на момент написания) | 2026-05-24 |
| Node.js | ≥20 | 22.18.0 локально |
| @xenova/transformers | latest | optional |
