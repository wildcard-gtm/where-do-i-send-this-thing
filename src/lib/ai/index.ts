import type { AIClient, AIProvider, ModelConfig } from './types';
import { createBedrockAIClient } from './bedrock-client';
import { createOpenAIClient } from './openai-client';

export const AVAILABLE_MODELS: ModelConfig[] = [
  // Bedrock Claude
  { provider: 'bedrock', modelId: 'global.anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Claude Sonnet 4.5' },
  { provider: 'bedrock', modelId: 'anthropic.claude-sonnet-4-20250514-v1:0', label: 'Claude Sonnet 4' },
  { provider: 'bedrock', modelId: 'anthropic.claude-opus-4-20250514-v1:0', label: 'Claude Opus 4' },
  { provider: 'bedrock', modelId: 'us.anthropic.claude-opus-4-20250514-v1:0', label: 'Claude Opus 4 (US)' },
  { provider: 'bedrock', modelId: 'global.anthropic.claude-opus-4-6-v1:0', label: 'Claude Opus 4.6' },
  // OpenAI
  { provider: 'openai', modelId: 'gpt-5.2', label: 'GPT-5.2' },
  { provider: 'openai', modelId: 'gpt-5.2-chat-latest', label: 'GPT-5.2 Chat' },
  { provider: 'openai', modelId: 'gpt-5.2-pro', label: 'GPT-5.2 Pro' },
  { provider: 'openai', modelId: 'gpt-5', label: 'GPT-5' },
  { provider: 'openai', modelId: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { provider: 'openai', modelId: 'gpt-4o', label: 'GPT-4o' },
  { provider: 'openai', modelId: 'gpt-4o-mini', label: 'GPT-4o Mini' },
  { provider: 'openai', modelId: 'o3', label: 'o3' },
  { provider: 'openai', modelId: 'o4-mini', label: 'o4 Mini' },
];

export function createAIClient(provider: AIProvider, modelId: string): AIClient {
  switch (provider) {
    case 'bedrock':
      return createBedrockAIClient(modelId);
    case 'openai':
      return createOpenAIClient(modelId);
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

export function parseModelConfig(configValue: string): { provider: AIProvider; modelId: string } {
  const parts = configValue.split('::');
  if (parts.length === 2 && (parts[0] === 'bedrock' || parts[0] === 'openai')) {
    return { provider: parts[0], modelId: parts[1] };
  }
  return { provider: 'bedrock', modelId: configValue };
}

export function serializeModelConfig(provider: AIProvider, modelId: string): string {
  return `${provider}::${modelId}`;
}

export type { AIClient, AIProvider, ModelConfig } from './types';
