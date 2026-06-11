---
name: of-new-ai-route
version: 1.0.0
description: |
  Checklist for new AI API routes in Open Finance (the pattern repeated 4+ times: chat, analyze-section, analyze-block, ozon ai-insights): prompt stack, credentials, NDJSON streaming, DB-backed reports, server-side context resolution, token parity.
  TRIGGER when: user asks for a new AI endpoint, AI analysis feature, AI report, or streaming AI route.
  DO NOT TRIGGER when: adding an AI tool to the Tools Layer (use of-new-ai-tool) or non-AI API routes.
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Bash
---

# Новый AI-маршрут

> Правила домена — `.cursor/rules/ai-tools.mdc`, схема слоёв — `docs/AI_PROMPT_LAYERS.md`. **Прочитать первым шагом.** Эталоны: `src/app/api/ai/{chat,analyze-section,analyze-block}/route.ts`.

## Чеклист

1. **Промпт:** только `resolvePromptStack()` (`src/lib/ai/prompt-resolver.ts`) с нужным `scope`. Прямой `buildMicroAgentSystemPrompt()` запрещён.
2. **Credentials:** `getActiveCredentials()` (`src/lib/ai/user-keys.ts`) — приоритет user > tenant > Ollama.
3. **Стриминг:** NDJSON, события `start/token/done/error/aborted`. Top-level try/catch.
4. **Структурный ответ ИИ:** zod-схема на сервере + терпимый `extractJson` на клиенте (fenced/unfenced).
5. **История отчётов — в БД, не в config блока:** таблица `<scope>_ai_reports` (через `/of-db-change`), лимит 10 на скоуп, при превышении `409 {needsOverwrite, oldest}` → UI подтверждает перезапись. Queries-модуль + CRUD `/api/ai/<scope>-reports[/[reportId]]`.
6. **Trust boundary кросс-контекста:** текущая страница — можно live-снапшот клиента (`page-snapshot.ts`); ДРУГИЕ разделы/блоки — клиент шлёт только refs `{pageKey, blockId, mode}`, тело резолвит сервер из БД (scoped tenant+user).
7. **Паритет токенов:** одна pure-функция сборки контекста для клиент-счётчика и сервер-промпта (стиль `assembleSectionContext` в `src/lib/ai/section-insights.ts`). `js-tiktoken` — lazy client-only import (`js-tiktoken/lite` + ranks динамически).
8. **Разделение server/client:** shared типы и pure-логика — в файле без `'use client'`; типы из route-файлов — только `import type`.
9. **UI-модалка:** панели в shell — `key={blockId/pageKey}`, иначе прилипает state прошлого скоупа. Data-driven диалоги (`sources/loading/error` пропсами), один fetch в родителе.

## Верификация

`/of-verify` + `pnpm tsx scripts/test-prompt-resolver.ts`. Новый tool/маршрут задокументировать: `docs/AI_TOOLS.md` / `docs/AI_PROMPT_LAYERS.md`.
