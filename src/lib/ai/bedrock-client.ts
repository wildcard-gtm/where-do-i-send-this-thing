import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Message, ClaudeResponse, ToolDefinition } from '@/agent/types';
import type { ChatMessage } from '@/lib/bedrock';
import type { AIClient } from './types';

export function createBedrockAIClient(modelId: string): AIClient {
  const client = createBedrockRuntimeClient();

  return {
    async callModel(messages: Message[], tools: ToolDefinition[], options?) {
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: options?.maxTokens ?? 8192,
          temperature: options?.temperature ?? 0.3,
          messages,
          tools,
        }),
      });
      const response = await client.send(command);
      return JSON.parse(new TextDecoder().decode(response.body)) as ClaudeResponse;
    },

    async chat(systemPrompt: string, messages: ChatMessage[], options?) {
      const claudeMessages = messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: typeof m.content === 'string'
          ? [{ type: 'text' as const, text: m.content }]
          : m.content,
      }));

      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: options?.maxTokens ?? 4096,
          system: systemPrompt,
          messages: claudeMessages,
        }),
      });

      const response = await client.send(command);
      const result = JSON.parse(new TextDecoder().decode(response.body));
      const textBlock = result.content?.find((b: { type: string }) => b.type === 'text');
      return textBlock?.text || "I couldn't generate a response.";
    },
  };
}

function createBedrockRuntimeClient(): BedrockRuntimeClient {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing AWS credentials. Set AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY in .env');
  }

  return new BedrockRuntimeClient({ region, credentials: { accessKeyId, secretAccessKey } });
}
