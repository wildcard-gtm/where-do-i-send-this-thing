import { PrismaClient } from '@prisma/client';
import { parseModelConfig, createAIClient } from './index';
import type { AIClient, AIProvider } from './types';

const DEFAULT_MODEL = 'openai::gpt-5.2';

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
    const prisma = new PrismaClient();
    const row = await prisma.systemPrompt.findUnique({ where: { key } });
    await prisma.$disconnect();

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
