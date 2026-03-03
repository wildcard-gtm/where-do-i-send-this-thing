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

// Gemini models for postcard image generation (Nano Banana)
export const GEMINI_IMAGE_MODELS: ModelConfig[] = [
  { provider: 'gemini', modelId: 'gemini-3.1-flash-image-preview', label: 'Nano Banana 2 (Latest — fast + high quality)' },
  { provider: 'gemini', modelId: 'gemini-3-pro-image-preview', label: 'Nano Banana Pro (Highest quality — slower)' },
  { provider: 'gemini', modelId: 'gemini-2.5-flash-image', label: 'Nano Banana (Original)' },
];

// Gemini models for postcard image analysis
export const GEMINI_ANALYSIS_MODELS: ModelConfig[] = [
  { provider: 'gemini', modelId: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Current default)' },
  { provider: 'gemini', modelId: 'gemini-3.1-flash', label: 'Gemini 3.1 Flash (Latest)' },
  { provider: 'gemini', modelId: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (Latest)' },
  { provider: 'gemini', modelId: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
];

export type { AIClient, AIProvider, ModelConfig } from './types';
