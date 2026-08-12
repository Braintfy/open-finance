# .claude/ — агентная обвязка Open Finance (Claude Code)

> Создана в v0.41.0. Принцип: **правила НЕ копируются** — доменные правила живут в `.cursor/rules/*.mdc` (единый источник для Cursor и Claude Code), здесь — процедуры, роли и оркестрация, которые на них ССЫЛАЮТСЯ. Версии нигде не хардкодятся (источник — первый `## [X.Y.Z]` в `CHANGELOG.md`).

## Состав

```
.claude/
├── settings.json            permissions + hooks — АКТИВЕН (активирован пользователем).
│                            Агент его не правит: изменения предлагать пользователю текстом.
├── agents/                  сабагенты (роль + «первым шагом прочитай свой .mdc»)
│   ├── of-code-reviewer.md        read-only ревью диффа по инвариантам проекта
│   ├── of-security-reviewer.md    read-only security-ревью (security.mdc + docs/SECURITY.md)
│   ├── of-blocks-dev.md           блоки BlockGrid (blocks.mdc)
│   ├── of-ai-dev.md               AI-подсистема (ai-tools.mdc)
│   ├── of-ozon-dev.md             маркетплейсы/Ozon (marketplaces.mdc)
│   ├── of-db-dev.md               Drizzle/Postgres (drizzle.mdc)
│   └── of-unit-economics-dev.md   юнит-экономика (unit-economics.mdc)
├── skills/                  процедуры (слэш-команды /of-*)
│   ├── of-verify/           верификация: typecheck → build (+stale .next) → тесты домена
│   ├── of-end-session/      КАНОН ритуала конца сессии (CHANGELOG/MEMORY/LEARNING_LOG/git-команды)
│   ├── of-run-tests/        smoke-тесты: карта доменов → scripts/test-*.ts
│   ├── of-new-block/        чеклист нового блока BlockGrid
│   ├── of-db-change/        изменение схемы БД (миграции — командами пользователю)
│   ├── of-new-ai-route/     новый AI-маршрут (prompt stack, NDJSON, отчёты в БД, trust boundary)
│   ├── of-new-ai-tool/      новый tool в Tools Layer
│   ├── of-ozon-column/      колонка Ozon-аналитики — 4 файла синхронно
│   └── of-memory/           маршрутизация памяти: куда писать, где искать
└── workflows/               мультиагентная оркестрация (Workflow tool, по имени)
    ├── of-test-sweep.js     параллельный прогон всех smoke-тестов со сводкой
    ├── of-review.js         ревью диффа по 5 измерениям + адверсариальная верификация находок
    └── of-rules-audit.js    аудит дрейфа правил между файлами обвязки (на минорный релиз)
```

`scripts/claude-rules-hint.sh` — PreToolUse-хук (подключается через settings): аналог path-scoped правил Cursor — при правке файла подсказывает, какой `.mdc` прочитать (1 раз за сессию на домен).

## Как добавить

- **Скил:** папка `skills/<имя>/SKILL.md`, frontmatter `name/version/description` (в description — TRIGGER / DO NOT TRIGGER) + `allowed-tools`. Тело — процедура по-русски, правила — ссылками на `.mdc`.
- **Сабагент:** `agents/<имя>.md`, frontmatter `name/description` (+`tools` для read-only ролей). Первое действие в теле — чтение своего `.mdc`.
- **Воркфлоу:** `workflows/<имя>.js` с `export const meta = {...}` (pure literal). Запуск: `Workflow({ name: '<имя>' })`.

## Анти-дрейф (обязательно)

1. Не копировать текст правил из `.mdc` — только ссылаться.
2. Не хардкодить версии/числа строк/счётчики файлов.
3. При изменении инвариантов — сначала `.mdc`, потом проверка ссылок здесь.
4. Регулярный контроль — `Workflow({ name: 'of-rules-audit' })`.
5. **`.claude/worktrees/` исключать из любого поиска по обвязке** (`grep -r --exclude-dir=worktrees`, `rg -g '!.claude/worktrees'`): там лежат git-worktree'ы агентов с ПОЛНОЙ копией `.claude/` на другом коммите. Иначе аудит видит две расходящиеся версии правил, а правка может уйти «не в то» дерево. Отработанные worktree'ы удалять: `git worktree list` → `git worktree remove <path>` (команду выполняет пользователь).
6. **Пути в globs `.mdc` проверять на существование** — внутренние страницы живут в `src/app/app/**`; route-группы `(app)` нет с v0.42.0, такой glob молча отключает правило.
