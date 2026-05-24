# MemPalace Runbook — Open Finance

> Пошаговая инструкция для пользователя. AI-агенты НЕ выполняют команды этого runbook сами — они только дают советы, что запустить.

## Назначение MemPalace в проекте

MemPalace используется как **археологический индекс** проекта:

- **Когда полезен:** «Когда мы перешли с Prisma на Drizzle?», «Почему отказались от Python sidecar?», «Где обсуждали Tauri-only архитектуру?» — точечный поиск по истории.
- **Когда вреден:** для bootstrap'а новой сессии. `wake-up --wing open-finance` тащит и устаревшие версии (Tauri-only, Prisma, Python), что отравляет контекст.
- **Источник правды для текущего состояния:** `MEMORY.md` + `CHANGELOG.md` + `git log`.

## Текущая проблема (2026-05-23)

```
$ mempalace status
[hangs forever]

$ mempalace migrate --dry-run
WARNING: Palace is NOT readable by chromadb 1.5.6.
Wings: 6
  - open-finance: 2548 drawers
  - sessions: 14512 drawers
  - braint: 4632 drawers
  - ozguard: 1424 drawers
  - <tenant-uuid-1> (UUID-wing): ...
  - <tenant-uuid-2> (UUID-wing): ...
Total: 24600 drawers, ~150MB chroma.sqlite3
```

**Корневая причина:** палац создан старой версией ChromaDB; новая 1.5.6 не может его открыть. Все команды `status/search/wake-up/repair` зависают на `Client(persist_directory=...)` init.

**Дополнительные мусорные wings:**
- `sessions` (14512) — старые agent transcripts, не относятся к проекту.
- `braint`, `ozguard` — другие проекты, оставлены случайно.
- 2 UUID-wings — артефакты ранних миграций.

## Процедура починки (выполнять В ВАШЕМ ТЕРМИНАЛЕ, не через AI-агента)

### 1. Убить зависшие процессы

```bash
# Проверить кто держит локи на палац
ps -ef | grep mempalace | grep -v grep

# Убить ВСЕ старые mempalace hook processes (даты могут быть от Wed/Fri)
pkill -9 -f "mempalace"
```

### 2. Резервная копия (ВАЖНО: ~150MB)

```bash
# Проверить место
df -h ~

# Создать backup за пределами sandbox
cp -R ~/.mempalace ~/.mempalace.backup-$(date +%Y%m%d)
du -sh ~/.mempalace.backup-*
```

### 3. Очистить локи (898 файлов с прошлой попытки)

```bash
ls ~/.mempalace/locks/ | wc -l  # должно быть 898
rm -rf ~/.mempalace/locks
mkdir ~/.mempalace/locks
```

### 4. Миграция к chromadb 1.5.6

```bash
mempalace migrate --yes
# Если зависает >10 мин — Ctrl+C и переходи к шагу 5 (re-init).
# Лог в ~/.mempalace/migrate.log если есть.
```

### 5. Альтернатива — пересоздать палац с нуля (если миграция упала)

Это потеряет историю, но восстановит работоспособность:

```bash
# Сохранить identity и sources
mv ~/.mempalace/identity.txt /tmp/mempal-identity-backup.txt
mv ~/.mempalace/sources /tmp/mempal-sources-backup
mv ~/.mempalace/config.json /tmp/mempal-config-backup.json

# Полностью очистить
rm -rf ~/.mempalace
mempalace init  # создаст свежую структуру

# Восстановить identity/sources/config
mv /tmp/mempal-identity-backup.txt ~/.mempalace/identity.txt
mv /tmp/mempal-sources-backup ~/.mempalace/sources
mv /tmp/mempal-config-backup.json ~/.mempalace/config.json

# Re-ingest проекта из transcripts
mempalace mine ~/.cursor/projects/Users-firay-open-finance-open-finance/agent-transcripts \
  --wing open-finance --mode convos
```

### 6. Очистить мусорные wings

```bash
# Проверить список
mempalace wings

# Удалить мусор
mempalace prune --wing sessions --yes
mempalace prune --wing braint --yes
mempalace prune --wing ozguard --yes
mempalace prune --wing "<tenant-uuid-1>" --yes
mempalace prune --wing "<tenant-uuid-2>" --yes

# Compress оставшийся open-finance
mempalace compress --wing open-finance --yes
```

### 7. Проверка работоспособности

```bash
mempalace status
# Ожидаемый output:
# Palace OK
# Wings: 1
#   - open-finance: ~2548 drawers
# Total: ~2548 drawers, ~30-50MB

mempalace search "когда перешли на Drizzle" --wing open-finance --limit 3
# Должен вернуть релевантные drawers без зависания.
```

### 8. Установить хуки (если ещё не установлены)

```bash
ls ~/.mempalace/hooks/
# Должны быть: mempal_save_hook.sh, mempal_precompact_hook.sh, mempal_userprompt_hook.sh

# Проверить что они исполняемые
chmod +x ~/.mempalace/hooks/*.sh

# Проверить конфигурацию Cursor (~/.cursor-server/hooks.json или ~/.claude/settings.json)
cat ~/.claude/settings.json | grep -A 3 hooks
```

### 9. Синхронизировать sources с актуальной версией проекта

```bash
cd /Users/firay/open-finance/open-finance
./scripts/sync-mempalace.sh
```

## После починки

- `mempalace search` использовать **точечно** для исторических вопросов.
- НЕ использовать `wake-up` для bootstrap'а — там есть и устаревшие версии.
- Запись новых данных — автоматическая через hooks при работе AI-агентов.
- Sync sources — автоматически через pre-push git hook (см. `scripts/sync-mempalace.sh`).

## Troubleshooting

### `Operation not permitted` при `mempalace migrate`

Sandbox блокирует запись в `~/.mempalace/palace.pre-migrate.*`. Запускать только В ВАШЕМ TERMINAL (не через AI-агента в sandbox-режиме).

### `mempalace status` зависает после миграции

Проверить chromadb версию:
```bash
python3 -c "import chromadb; print(chromadb.__version__)"
# Ожидаем: 1.5.6 или новее

# Если устарел
pip3 install --upgrade chromadb
```

### Hooks не срабатывают

```bash
# Проверить env
echo $MEMPAL_DISABLE_HOOKS  # должно быть пусто

# Тест-запуск
~/.mempalace/hooks/mempal_save_hook.sh < /dev/null

# Логи hooks
ls ~/.mempalace/hook_state/
```

### Восстановление identity

Файл `~/.mempalace/identity.txt` — это общие правила AI (пишутся пользователем). При re-init обязательно сохранить и восстановить. Дубликат — в `docs/MEMPALACE_IDENTITY_BACKUP.md` (опц.).

## Source synchronization

Файл `~/.mempalace/sources/open-finance/current-context-v*.md` — мирор `MEMORY.md` для внешних AI без доступа к репо. Обновлять при значимых изменениях через `./scripts/sync-mempalace.sh`.

Текущий актуальный snapshot: `current-context-v0.22.2.md` (после починки палаца).

## Когда вообще НЕ использовать MemPalace

- **Bootstrap новой сессии** — только `START.md` + `MEMORY.md` + `git log`.
- **Текущее состояние** — `MEMORY.md` + `CHANGELOG.md`.
- **Активные правила** — `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/*.mdc`.
- **Стратегия** — `PLAN.md`.

MemPalace **исключительно для исторических вопросов**, и только когда `git log --all -S "термин"` не достаточно.
