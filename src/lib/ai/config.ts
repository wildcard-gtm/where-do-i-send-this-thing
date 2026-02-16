import { PrismaClient } from '@prisma/client';
import { parseModelConfig, createAIClient } from './index';
import type { AIClient, AIProvider } from './types';

const DEFAULT_MODEL = 'bedrock::global.anthropic.claude-sonnet-4-5-20250929-v1:0';

export type ModelRole = 'agent' | 'chat';

export async function getAIClientForRole(role: ModelRole): Promise<AIClient> {
  const config = await getModelConfigForRole(role);
  return createAIClient(config.provider, config.modelId);
}

export async function getModelConfigForRole(
  role: ModelRole
): Promise<{ provider: AIProvider; modelId: string }> {
  const key = role === 'agent' ? 'config_agent_model' : 'config_chat_model';

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

  const envModelId = process.env.BEDROCK_MODEL_ID;
  if (envModelId) {
    return { provider: 'bedrock', modelId: envModelId };
  }

  return parseModelConfig(DEFAULT_MODEL);
}
