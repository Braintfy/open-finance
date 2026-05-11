// PURPOSE: Re-export модуля micro-agent
export { buildMicroAgentSystemPrompt } from './prompt';
export { QUICK_ACTIONS } from './types';
export type {
  BlockContext,
  QuickAction,
  MicroAgentMessage,
  MicroAgentRequest,
  MicroAgentResponse,
  SuggestedAction,
} from './types';
