import { prisma } from '@/lib/db';
import { parseModelConfig, createAIClient } from './index';
import type { AIClient, AIProvider } from './types';

const DEFAULT_MODEL = 'openai::gpt-5.2';

const DEFAULT_IMAGE_GEN_MODEL = 'gemini-3-pro-image-preview';
const DEFAULT_IMAGE_ANALYSIS_MODEL = 'gemini-3.1-pro-preview';

export type ModelRole = 'agent' | 'chat' | 'fallback';

export async function getAIClientForRole(role: ModelRole): Promise<AIClient> {
  const config = await getModelConfigForRole(role);
  return createAIClient(config.provider, config.modelId);
}

export async function getModelConfigForRole(
  role: ModelRole
): Promise<{ provider: AIProvider; modelId: string }> {
  const key =
    role === 'agent' ? 'config_agent_model' :
    role === 'fallback' ? 'config_fallback_model' :
    'config_chat_model';

  try {
    const row = await prisma.systemPrompt.findUnique({ where: { key } });
    if (row?.content) {
      return parseModelConfig(row.content);
    }
  } catch {
    // DB unavailable, use fallback
  }

  // Fallback role should never chain back to Bedrock env var — return OpenAI default
  if (role === 'fallback') {
    return parseModelConfig(DEFAULT_MODEL);
  }

  const envModelId = process.env.BEDROCK_MODEL_ID;
  if (envModelId) {
    return { provider: 'bedrock', modelId: envModelId };
  }

  return parseModelConfig(DEFAULT_MODEL);
}

export type GeminiModelRole = 'image_gen' | 'image_analysis';

/** Get the Gemini model ID for postcard image generation or analysis */
export async function getGeminiModel(role: GeminiModelRole): Promise<string> {
  const key = role === 'image_gen' ? 'config_image_gen_model' : 'config_image_analysis_model';
  const fallback = role === 'image_gen' ? DEFAULT_IMAGE_GEN_MODEL : DEFAULT_IMAGE_ANALYSIS_MODEL;

  try {
    const row = await prisma.systemPrompt.findUnique({ where: { key } });
    if (row?.content) return row.content;
  } catch {
    // DB unavailable
  }

  return fallback;
}
