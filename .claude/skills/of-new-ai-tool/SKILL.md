---
name: of-new-ai-tool
version: 1.0.0
description: |
  Checklist for adding a tool to the Open Finance AI Tools Layer (the ONLY way AI mutates data — no direct SQL/Drizzle from AI).
  TRIGGER when: user asks for a new AI tool, AI action, or capability the micro-agent/orchestrator should call.
  DO NOT TRIGGER when: creating an AI API route (use of-new-ai-route).
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - Bash
---

# Новый AI tool (Tools Layer)

> Правила домена — `.cursor/rules/ai-tools.mdc`, реестр — `docs/AI_TOOLS.md`. **Прочитать первым шагом.** Пример: `src/lib/ai/tools/query-inbox-messages.ts`.

## Чеклист

1. **Файл:** `src/lib/ai/tools/<verb-noun>.ts` (kebab-case, `// PURPOSE: ...`).
2. **Контракт:**

```typescript
export const myTool = {
  name: 'do_something',
  description: 'Кратко что делает (по-русски, для LLM)',
  parameters: zodToJsonSchema(z.object({ /* ... */ })),
  handler: async (args, ctx) => {
    // ctx: tenantId, userId, requestId — tenant isolation через ctx.tenantId ВСЕГДА
  },
};
```

3. **Регистрация:** `src/lib/ai/tools/index.ts` — без неё Orchestrator tool не видит.
4. **Мутации:** только внутри handler через Drizzle с `ctx.tenantId`; для отменяемых действий продумать inverseAction/audit (схема `ai_audit_log` готова в `src/lib/db/schema/ai.ts`).
5. **Тест:** smoke-скрипт с позитивным кейсом и кейсом «чужой tenant не виден» (pure-часть — без db client).
6. **Документация:** строка в реестре `docs/AI_TOOLS.md`.

## Верификация

`/of-verify`. В CHANGELOG — `### Added` с именем tool.
