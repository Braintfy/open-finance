---
name: of-end-session
version: 1.0.0
description: |
  Canonical end-of-session ritual for Open Finance: verify → CHANGELOG → MEMORY → LEARNING_LOG → invariant files → agentmemory → commit + push by the agent itself. This skill is the single source of truth for the ritual (CLAUDE.md/AGENTS.md/START.md reference it).
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
- **Критически смотреть, что устарело**: нарративы «как мы это делали» по старым версиям → архив `docs/memory-archive/` (правила отбора и шаблон — `docs/memory-archive/README.md`). В `MEMORY.md` вместо вынесенного остаётся строка-указатель + живые правила из этого пласта.
- **Проверять размер по СИМВОЛАМ, не по строкам и не по байтам.** Кириллица в UTF-8 = 2 байта, поэтому `wc -c` (и `wc -m` в C-локали) завышает примерно в 1.3 раза и даёт ложную тревогу «вышли за бюджет». Верно: `LC_ALL=en_US.UTF-8 wc -m MEMORY.md` или `python3 -c "print(len(open('MEMORY.md',encoding='utf-8').read()))"`. Бюджет **≤ 50 000 символов**; плюс **ни одной строки > 1100 символов** — длинная строка означает, что запись пора разбить или вынести в архив. Строки — вторичный ориентир (≤ 400): один буллет уже весил 5 400 символов при «одной строке бюджета». Если вышли за бюджет — в этой же сессии вынести нарратив в `docs/memory-archive/`. Оценку размера в шапке `MEMORY.md`/`START.md`/`CLAUDE.md`/`AGENTS.md`/`project-context.mdc` мерить (`js-tiktoken`, o200k_base), а не угадывать, и править вместе с файлом — занижённая оценка уже была причиной дрейфа.

## 3. LEARNING_LOG.md — новые грабли (append-only)

Формат записи — в шапке самого файла (`### YYYY-MM-DD — название`, Контекст/Грабля/Причина/Фикс/Урок). Не дублировать то, что уже в MEMORY.md. Чужие записи не редактировать.

## 4. Инвариант-файлы — только если менялись правила/bootstrap

- `START.md` (карта, маршрутизация), `.cursor/rules/*.mdc` (доменные правила), `CLAUDE.md`/`AGENTS.md`.
- **Анти-дрейф чек:** не появилось ли копий правил в `.claude/` — скилы/агенты должны ССЫЛАТЬСЯ на `.cursor/rules/*.mdc`, а не повторять их. Версии нигде не хардкодить (источник — CHANGELOG.md head).

## 5. agentmemory — ключевые решения сессии (опционально)

Если в сессии принято важное архитектурное решение/инвариант — сохранить через MCP `memory_save` (agentmemory, localhost:3111). Это замена устаревшего `./scripts/sync-mempalace.sh` (mempalace deprecated с v0.22.4). Если сервер не отвечает (`curl http://localhost:3111/agentmemory/health`) — пропустить, не чинить в рамках ритуала.

## 6. Коммит + пуш — делает агент сам (решение владельца 2026-11-19)

Репозиторий открытый: каждый коммит — публикация. Порядок:

1. `git status` и `git diff --stat` — посмотреть, что попадёт в коммит.
2. Добавлять файлы **явным списком путей**, не `git add -A`. Никогда не добавлять `.env*`, `*.local.md`, `.local/`, дампы баз, ключи.
3. Пройти `git diff --cached` глазами на секреты (пароли, токены, ключи API, Client-Id/ключи маркетплейсов).
4. Закоммитить и запушить:

```bash
git commit -m "feat(scope): краткое описание (vX.Y.Z)" && git push origin main
```

Тип — `feat`/`fix`/`refactor`/`docs` по содержанию; версия в скобках = новая версия CHANGELOG. Без `--force` и переписывания истории. Сабагенты git не трогают — только главная сессия.
