import type {
  Message,
  ClaudeResponse,
  ToolDefinition,
} from '@/agent/types';
import type { ChatMessage } from '@/lib/bedrock';

export type AIProvider = 'bedrock' | 'openai' | 'gemini';

export interface ModelConfig {
  provider: AIProvider;
  modelId: string;
  label: string;
}

export interface AIClient {
  callModel(
    messages: Message[],
    tools: ToolDefinition[],
    options?: { maxTokens?: number; temperature?: number; system?: string }
  ): Promise<ClaudeResponse>;

  chat(
    systemPrompt: string,
    messages: ChatMessage[],
    options?: { maxTokens?: number }
  ): Promise<string>;
}
