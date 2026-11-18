# .claude/ — агентная обвязка Open Finance (Claude Code)

> Принцип: **правила НЕ копируются** — доменные правила живут в `.cursor/rules/*.mdc` (единый источник для Cursor и Claude Code), здесь — процедуры, роли и оркестрация, которые на них ССЫЛАЮТСЯ. Версии нигде не хардкодятся (источник — первый `## [X.Y.Z]` в `CHANGELOG.md`).
>
> Дерево ниже — карта назначений, а не реестр: **актуальный состав всегда `ls .claude/{skills,agents,workflows}`**. Счётчики («N скилов») здесь и в других файлах не писать.

## Состав

```
.claude/
├── ORCHESTRATION.md         КАНОН ролей моделей: старшие управляют и ревьюят, младшие исполняют агентами
├── settings.json            permissions + hooks — АКТИВЕН (активирован пользователем).
│                            Агент его не правит: изменения предлагать пользователю текстом.
├── agents/                  сабагенты (роль + «первым шагом прочитай свой .mdc»);
│                            у `of-*-dev` во frontmatter `model: sonnet`, ревьюеры наследуют модель сессии
│   ├── of-code-reviewer.md        read-only ревью диффа по инвариантам проекта
│   ├── of-security-reviewer.md    read-only security-ревью (security.mdc + docs/SECURITY.md)
│   ├── of-blocks-dev.md           блоки BlockGrid (blocks.mdc)
│   ├── of-ai-dev.md               AI-подсистема (ai-tools.mdc)
│   ├── of-ozon-dev.md             маркетплейсы/Ozon (marketplaces.mdc)
│   ├── of-db-dev.md               Drizzle/Postgres (drizzle.mdc)
│   └── of-unit-economics-dev.md   юнит-экономика (unit-economics.mdc)
├── skills/                  процедуры (слэш-команды /of-*)
│   ├── of-verify/           верификация: typecheck → build (+stale .next) → тесты → tenant-гейт
│   ├── of-end-session/      КАНОН ритуала конца сессии (CHANGELOG/MEMORY/LEARNING_LOG/git-команды)
│   ├── of-run-tests/        smoke-тесты: карта доменов → scripts/test-*.ts
│   ├── of-new-block/        чеклист нового блока BlockGrid
│   ├── of-db-change/        проектирование схемы БД (+ миррор init-SQL, чек журнала)
│   ├── of-db-migrate/       применение миграций (dev/прод) и починка журнала Drizzle
│   ├── of-deploy-pi/        КАНОН прод-деплоя на Raspberry Pi (rsync→build→migrate→restart→health)
│   ├── of-launch-check/     технический гейт публичного запуска (go / no-go)
│   ├── of-new-ai-route/     новый AI-маршрут (prompt stack, NDJSON, отчёты в БД, trust boundary)
│   ├── of-new-ai-tool/      новый tool в Tools Layer
│   ├── of-ozon-column/      колонка Ozon-аналитики — 4 файла синхронно
│   └── of-memory/           маршрутизация памяти: куда писать, где искать
└── workflows/               мультиагентная оркестрация (Workflow tool, по имени)
    ├── of-test-sweep.js     параллельный прогон всех smoke-тестов со сводкой
    ├── of-review.js         ревью диффа по 5 измерениям + адверсариальная верификация находок
    └── of-rules-audit.js    аудит дрейфа правил между файлами обвязки (на минорный релиз)
```

`scripts/claude-rules-hint.sh` — PreToolUse-хук (подключается через settings): аналог path-scoped правил Cursor — при правке файла подсказывает, какой `.mdc` прочитать (1 раз за сессию на домен). Домены: `vless` (VPN/Xray → `security.mdc` §VLESS/Xray, **не** `ai-tools.mdc`), `security`, `workspaces`, `drizzle`, `marketplaces`, `ai-tools`, `unit-economics`, `blocks` — порядок важен, специфичное раньше общего.

**Хук и globs `.mdc` держать синхронными.** Заводя новый каталог верхнего уровня (`src/lib/<домен>/`, `deploy/…`), сразу решить, под какое правило он попадает, и дописать его И в `globs` нужного `.mdc`, И в `RULES` хука. Проверка одного пути:

```bash
printf '{"session_id":"t1","tool_input":{"file_path":"src/lib/workspaces/scope.ts"}}' | bash scripts/claude-rules-hint.sh
```

## Где лежат доменные правила (исправлено 2026-11-17)

`.cursor/rules/*.mdc` до этой даты **не были под git** (`.cursor/` целиком стоял в `.gitignore`), поэтому на любой машине, кроме исходной, вся обвязка ссылалась в пустоту. Теперь `.gitignore` пропускает `.cursor/rules/`. Если каталога в рабочем дереве нет — его надо один раз скопировать с машины, где он есть, и закоммитить; до тех пор агенты работают по фолбэку из `ORCHESTRATION.md` (раздел «Если нет доменного правила»).

Абсолютные пути машины (`/Users/...`, `C:\...`) в обвязке запрещены: команды пишутся относительно корня репозитория, в воркфлоу `ROOT = '.'`.

## Как добавить

- **Скил:** папка `skills/<имя>/SKILL.md`, frontmatter `name/version/description` (в description — TRIGGER / DO NOT TRIGGER) + `allowed-tools`. Тело — процедура по-русски, правила — ссылками на `.mdc`.
- **Сабагент:** `agents/<имя>.md`, frontmatter `name/description` (+`tools` для read-only ролей, +`model: sonnet` для исполнителей — см. `ORCHESTRATION.md`). Первое действие в теле — чтение своего `.mdc`.
- **Воркфлоу:** `workflows/<имя>.js` с `export const meta = {...}` (pure literal). Запуск: `Workflow({ name: '<имя>' })`.

## Анти-дрейф (обязательно)

1. Не копировать текст правил из `.mdc` — только ссылаться.
2. Не хардкодить версии/числа строк/счётчики файлов.
3. При изменении инвариантов — сначала `.mdc`, потом проверка ссылок здесь.
4. Регулярный контроль — `Workflow({ name: 'of-rules-audit' })`.
5. **`.claude/worktrees/` исключать из любого поиска по обвязке** (`grep -r --exclude-dir=worktrees`, `rg -g '!.claude/worktrees'`): там лежат git-worktree'ы агентов с ПОЛНОЙ копией `.claude/` на другом коммите. Иначе аудит видит две расходящиеся версии правил, а правка может уйти «не в то» дерево. Отработанные worktree'ы удалять: `git worktree list` → `git worktree remove <path>` (команду выполняет пользователь).
6. Состав обвязки не перечислять числами («9 скилов») ни здесь, ни в `CLAUDE.md`/`MEMORY.md`/`START.md` — только назначения и `ls`.
7. **Пути в globs `.mdc` проверять на существование** — внутренние страницы живут в `src/app/app/**`; route-группы `(app)` нет с v0.42.0, такой glob молча отключает правило.
