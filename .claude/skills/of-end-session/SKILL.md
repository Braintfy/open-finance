---
name: of-end-session
version: 1.0.0
description: |
  Canonical end-of-session ritual for Open Finance: verify → CHANGELOG → MEMORY → LEARNING_LOG → invariant files → agentmemory → git commands for the user. This skill is the single source of truth for the ritual (CLAUDE.md/AGENTS.md/START.md reference it).
  TRIGGER when: user says «заверши сессию», «оформи релиз», «handoff», «обнови память/чейнджлог», or significant work is done and needs documenting.
  DO NOT TRIGGER when: no code/doc changes happened this session, or mid-task.
allowed-tools:
  - Bash
  - Read
  - Edit
  - Write
  - Grep
---

# Конец значимой сессии Open Finance (канонический ритуал)

## 0. Верификация зелёная

`/of-verify` (typecheck → build → доменные тесты) должен быть пройден ДО оформления.

## 1. CHANGELOG.md — запись релиза

Текущая версия = **первый** заголовок `## [X.Y.Z]` в `CHANGELOG.md` (НЕ `package.json` — он устарел навсегда). Формат:

```markdown
## [X.Y.Z] - YYYY-MM-DD

### Added / Changed / Fixed / Removed
- **Компонент/Фича** — детальное описание с путями файлов в бэктиках.
```

- Бамп: **MINOR** — фича/модуль/интеграция (может быть несколько MINOR в день), **PATCH** — фиксы и мелочь. MAJOR в MVP не трогаем.
- Для `Fixed` — обязательно «Причина: … Фикс: …» (корневая причина, не симптом).
- Формат заголовка `## [X.Y.Z]` **load-bearing**: `next.config.mjs` парсит его в `NEXT_PUBLIC_APP_VERSION`, UI показывает версию.

## 2. MEMORY.md — если изменились ключевые файлы/инварианты/грабли

- Новая запись в «Активные грабли» (формат: версия, файлы, паттерн, грабли).
- **Критически смотреть, что устарело**: грабли старых версий, которые больше не воспроизводятся → архив `docs/memory-archive/`. Файл уже распухал до 908 строк (×9 бюджета) — держать ~400-450 строк.

## 3. LEARNING_LOG.md — новые грабли (append-only)

Формат записи — в шапке самого файла (`### YYYY-MM-DD — название`, Контекст/Грабля/Причина/Фикс/Урок). Не дублировать то, что уже в MEMORY.md. Чужие записи не редактировать.

## 4. Инвариант-файлы — только если менялись правила/bootstrap

- `START.md` (карта, маршрутизация), `.cursor/rules/*.mdc` (доменные правила), `CLAUDE.md`/`AGENTS.md`.
- **Анти-дрейф чек:** не появилось ли копий правил в `.claude/` — скилы/агенты должны ССЫЛАТЬСЯ на `.cursor/rules/*.mdc`, а не повторять их. Версии нигде не хардкодить (источник — CHANGELOG.md head).

## 5. agentmemory — ключевые решения сессии (опционально)

Если в сессии принято важное архитектурное решение/инвариант — сохранить через MCP `memory_save` (agentmemory, localhost:3111). Это замена устаревшего `./scripts/sync-mempalace.sh` (mempalace deprecated с v0.22.4). Если сервер не отвечает (`curl http://localhost:3111/agentmemory/health`) — пропустить, не чинить в рамках ритуала.

## 6. Git-команды пользователю (САМОМУ НЕ ВЫПОЛНЯТЬ)

```bash
git add -A && git commit -m "feat(scope): краткое описание (vX.Y.Z)" && git push origin main
```

Тип — `feat`/`fix`/`refactor`/`docs` по содержанию; версия в скобках = новая версия CHANGELOG. Перед выдачей команд — глазами пройти `git diff` на секреты.
