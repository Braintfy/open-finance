// PURPOSE: Общие типы для AI слоя — провайдеры, tools, memory
import type { z } from 'zod';

export type AiProvider = 'claude' | 'openai' | 'yandex' | 'gigachat' | 'ollama';

export type AiModel = {
  provider: AiProvider;
  id: string; // 'claude-sonnet-4', 'gpt-4o', 'yandexgpt', etc.
  contextWindow: number; // токенов
  pricePer1kPromptCents: number; // в центах для точности
  pricePer1kCompletionCents: number;
  supportsTools: boolean;
  supportsVision: boolean;
};

export type ToolContext = {
  tenantId: string;
  userId: string;
  requestId: string;
  agentId?: string;
  // Опционально: уведомлять о действии в UI?
  notify?: boolean;
};

export type Tool<TParams extends z.ZodTypeAny = z.ZodTypeAny, TResult = unknown> = {
  name: string;
  description: string;
  parameters: TParams;
  handler: (args: z.infer<TParams>, ctx: ToolContext) => Promise<TResult>;
  permissions?: {
    minPlan?: 'free' | 'trial_pro' | 'pro' | 'business' | 'enterprise';
    roles?: ('owner' | 'admin' | 'manager' | 'accountant' | 'viewer')[];
  };
  inverseAction?: (result: TResult, ctx: ToolContext) => Promise<void>;
};

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string; // для tool-роли
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type AiUsageRecord = {
  promptTokens: number;
  completionTokens: number;
  totalCostCents: number;
};

export type ChatResponse = {
  message: ChatMessage;
  usage: AiUsageRecord;
  toolCalls?: ToolCall[];
};
