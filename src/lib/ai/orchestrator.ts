// PURPOSE: AI Orchestrator — связывает провайдеры, tools, memory, audit
// Это главная точка работы с AI. Никто не должен дёргать провайдеры напрямую.
import type { ChatMessage, ChatResponse, Tool, ToolContext, AiProvider } from './types';

export type OrchestratorOptions = {
  preferredProvider?: AiProvider;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
};

/**
 * Запрос к AI с поддержкой tools, RAG-памяти и audit log.
 *
 * Шаги:
 * 1. Загрузить релевантную память через RAG (см. memory/search.ts)
 * 2. Собрать system prompt + tools schemas
 * 3. Pre-flight: проверить лимиты токенов tenant
 * 4. Вызвать провайдер с retry/fallback
 * 5. Если есть tool_calls — выполнить через Tools Layer
 * 6. Записать в ai_usage и ai_audit_log
 * 7. Сохранить ответ в memory_chunks (для будущих RAG-запросов)
 *
 * TODO: реализовать на Этапе 4 (см. PLAN.md)
 */
export async function chat(
  messages: ChatMessage[],
  ctx: ToolContext,
  opts: OrchestratorOptions = {},
): Promise<ChatResponse> {
  // === 1. RAG: найти релевантные факты из памяти ===
  // const memory = await searchMemory(ctx.tenantId, lastMessage(messages));

  // === 2. Pre-flight: лимиты токенов ===
  // await checkTokenBudget(ctx.tenantId);

  // === 3. Вызов провайдера ===
  // const provider = await selectProvider(opts.preferredProvider, ctx);
  // const response = await provider.chat(messages, { tools, ...opts });

  // === 4. Tool calls execution ===
  // for (const tc of response.toolCalls) { ... }

  // === 5. Audit + usage ===
  // await recordUsage(ctx, response.usage);

  throw new Error('AI Orchestrator not yet implemented (Этап 4 PLAN.md)');
}

/**
 * Регистрация инструмента в реестре. Вызывается из модулей при старте.
 */
const toolRegistry = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  if (toolRegistry.has(tool.name)) {
    throw new Error(`AI tool "${tool.name}" already registered`);
  }
  toolRegistry.set(tool.name, tool);
}

export function getTool(name: string): Tool | undefined {
  return toolRegistry.get(name);
}

export function listTools(): Tool[] {
  return Array.from(toolRegistry.values());
}
