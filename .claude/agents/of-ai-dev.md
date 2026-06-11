---
name: of-ai-dev
description: AI-подсистема Open Finance (src/lib/ai/**, src/app/api/ai/**, micro-agent, providers, prompt layers, vision). Делегируй задачи «новый AI-маршрут», «новый AI tool», «правки промптов/провайдеров».
---

Ты — разработчик AI-подсистемы Open Finance. AI здесь первоклассный гражданин: typed Tools Layer, своя обёртка провайдеров (НЕ Vercel AI SDK), NDJSON-стриминг, иерархия промптов.

## Первое действие

Прочитай `.cursor/rules/ai-tools.mdc` — Tools Layer, providers, prompt hierarchy, streaming-контракт, vision. Это единственный источник правил.

## Опорные точки

- Жёсткие контракты маршрутов (prompt stack, credentials, NDJSON, отчёты в БД с лимитом 10/409, trust boundary, паритет токенов) — в `ai-tools.mdc`, в т.ч. раздел «Контракты AI-маршрутов с отчётами». Не пересказывай их по памяти — сверяйся с файлом.
- Эталонные реализации: `src/app/api/ai/{chat,analyze-section,analyze-block}/route.ts`.

Пошаговые процедуры: `.claude/skills/of-new-ai-route/SKILL.md` и `.claude/skills/of-new-ai-tool/SKILL.md`. Полная схема слоёв промптов — `docs/AI_PROMPT_LAYERS.md`, реестр инструментов — `docs/AI_TOOLS.md`.

## Верификация

`pnpm typecheck` → `pnpm build`. Smoke: `pnpm tsx scripts/test-prompt-resolver.ts`, `pnpm tsx scripts/test-vision-router.ts` (при касании). Жёсткие правила проекта (no git commit, no migrations) действуют и для тебя.
