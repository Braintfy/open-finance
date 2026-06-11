---
name: of-memory
version: 1.0.0
description: |
  Memory routing for Open Finance: where to WRITE new knowledge (LEARNING_LOG/MEMORY/CHANGELOG/agentmemory) and where to SEARCH for answers (MEMORY vs git log vs CHANGELOG vs agentmemory vs memory-archive).
  TRIGGER when: user says «запиши граблю», «сохрани в память», «когда/почему мы перешли с X на Y», «найди в памяти», or you discovered a new gotcha worth persisting.
  DO NOT TRIGGER when: bootstrap (use open-finance-bootstrap) or end-of-session ritual (use of-end-session, it includes memory steps).
allowed-tools:
  - Read
  - Edit
  - Grep
  - Bash
---

# Память проекта: куда писать, где искать

## Куда ПИСАТЬ

| Что | Куда | Формат |
|---|---|---|
| Новая грабля/инсайт (в момент обнаружения) | `LEARNING_LOG.md` (append-only, чужое не редактировать) | `### YYYY-MM-DD — название` + Контекст/Грабля/Причина/Фикс/Урок (шаблон в шапке файла) |
| Инвариант/ключевые файлы/активная грабля | `MEMORY.md` «Активные грабли» | при этом архивировать устаревшее в `docs/memory-archive/` (бюджет ~400-450 строк) |
| Релиз | `CHANGELOG.md` | см. `/of-end-session` |
| Доменное правило (как устроено / что нельзя) | `.cursor/rules/<домен>.mdc` | единственный источник правил; НЕ копировать в `.claude/` |
| Архитектурное решение для долгой истории | agentmemory MCP `memory_save` | заменил mempalace (deprecated v0.22.4) |

## Где ИСКАТЬ

| Вопрос | Источник |
|---|---|
| Текущее состояние, инварианты, грабли | `MEMORY.md` |
| Что менялось недавно | `git log --oneline -20` |
| Детали конкретного релиза | `CHANGELOG.md` (конкретный раздел, НЕ весь файл — ~4K строк) |
| «Когда/почему мы перешли с X на Y», отброшенные альтернативы | agentmemory: MCP `memory_smart_search` (сервер localhost:3111; health: `curl http://localhost:3111/agentmemory/health`) |
| Детальные нарративы старых версий (v0.10–v0.22) | `docs/memory-archive/<версия>.md` |
| Код | `Grep`/`Glob` — НЕ семантическая память |

## Запреты

- agentmemory — НЕ для bootstrap'а и НЕ источник правды о текущем состоянии (только археология).
- `mempalace` / `./scripts/sync-mempalace.sh` — deprecated (Issue #832, chromadb); не предлагать. Починка/история — `docs/MEMPALACE_RUNBOOK.md`, новая память — `docs/MEMORY_SETUP.md`.
- Если agentmemory не отвечает — НЕ чинить его попутно (отдельная задача, runbook в `docs/MEMORY_SETUP.md`); MCP shim в standalone даёт 7 fallback-tools.
