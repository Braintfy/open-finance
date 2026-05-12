// PURPOSE: Реестр AI-инструментов — единая точка регистрации
// При запуске приложения каждый модуль импортирует свои tools и регистрирует их здесь
import { registerTool } from '../orchestrator';
import { queryInboxMessagesTool } from './query-inbox-messages';

// Tools будут добавляться по мере реализации модулей.
// Пока пустой каркас — Этап 4 PLAN.md.

export function bootstrapTools(): void {
  // Пример (будет реализовано в Этапе 4):
  // registerTool(createTransactionTool);
  // registerTool(createReminderTool);
  // registerTool(searchMemoryTool);
  registerTool(queryInboxMessagesTool);
}

export { registerTool };
