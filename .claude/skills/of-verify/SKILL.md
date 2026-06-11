---
name: of-verify
version: 1.0.0
description: |
  Verify Open Finance changes: typecheck → build (with stale .next handling) → domain smoke tests.
  TRIGGER when: user says «проверь», «верификация», «прогони проверку», after any non-trivial code change in this repo, or as the verify step of a feature workflow.
  DO NOT TRIGGER when: only docs/markdown changed, or verification already ran on the current working tree state.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
---

# Верификация изменений Open Finance

## Шаги

### 1. Определить домен изменений

```bash
git -C /Users/firay/open-finance/open-finance status --short
git -C /Users/firay/open-finance/open-finance diff --stat
```

### 2. Typecheck (быстрый сигнал)

```bash
pnpm typecheck
```

### 3. Build (обязателен для значимых правок — ESLint ловит rules-of-hooks)

Если менялись **экспорты** в `src/lib/blocks/catalog/**` (добавление/удаление/переименование, особенно в общих types-файлах) — СНАЧАЛА:

```bash
rm -rf .next
```

Затем:

```bash
pnpm build
```

**Известные ложные падения (не искать ошибку в коде):**

- `Element type is invalid: ... got: undefined` на prerender (`/_not-found` и др.) при зелёном typecheck → stale `.next`: `rm -rf .next && pnpm build`.
- `PageNotFoundError: Cannot find module for page` на «Collecting page data» сразу после `rm -rf .next` → flaky worker: просто повторить `pnpm build` (тёплый кэш).

### 4. Smoke-тесты по домену

Выбрать релевантные из `scripts/test-*.ts` (карта доменов — `.claude/skills/of-run-tests/SKILL.md`):

```bash
pnpm tsx scripts/test-<name>.ts
```

Все тест-скрипты возвращают exit code 1 при провале. **Грабля:** `pnpm tsx` в песочнице падает с `EPERM listen` — запускать без sandbox.

### 5. Вердикт

Сообщить: typecheck ок/нет, build ок/нет (с упоминанием перезапусков из-за кэша), результаты тестов `N passed, M failed` по каждому. Провалы цитировать, не пересказывать.
