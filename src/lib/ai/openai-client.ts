import OpenAI from 'openai';
import type {
  Message,
  ClaudeResponse,
  ToolDefinition,
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
} from '@/agent/types';
import type { ChatMessage } from '@/lib/bedrock';
import type { AIClient } from './types';

export function createOpenAIClient(modelId: string): AIClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing OPENAI_API_KEY environment variable');
  }
  const client = new OpenAI({ apiKey });

  return {
    async callModel(messages: Message[], tools: ToolDefinition[], options?) {
      const openaiMessages = translateMessagesToOpenAI(messages);
      const openaiTools: OpenAI.ChatCompletionTool[] = tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema as unknown as Record<string, unknown>,
        },
      }));

      const response = await client.chat.completions.create({
        model: modelId,
        messages: openaiMessages,
        tools: openaiTools,
        max_tokens: options?.maxTokens ?? 65536,
        temperature: options?.temperature ?? 0.3,
      });

      return translateResponseToClaude(response);
    },

    async chat(systemPrompt: string, messages: ChatMessage[], options?) {
      const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: typeof m.content === 'string'
            ? m.content
            : (m.content as Array<{ type: string; text?: string }>)
                .filter((b) => b.type === 'text')
                .map((b) => b.text || '')
                .join('\n'),
        })),
      ];

      const response = await client.chat.completions.create({
        model: modelId,
        messages: openaiMessages,
        max_tokens: options?.maxTokens ?? 4096,
      });

      return response.choices[0]?.message?.content || "I couldn't generate a response.";
    },
  };
}

function translateMessagesToOpenAI(messages: Message[]): OpenAI.ChatCompletionMessageParam[] {
  const result: OpenAI.ChatCompletionMessageParam[] = [];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    const toolResults = msg.content.filter(
      (b): b is ToolResultBlock => b.type === 'tool_result',
    );
    if (toolResults.length > 0 && msg.role === 'user') {
      for (const tr of toolResults) {
        result.push({
          role: 'tool' as const,
          tool_call_id: tr.tool_use_id,
          content: tr.content,
        });
      }
      continue;
    }

    const toolUses = msg.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    );
    const textBlocks = msg.content.filter(
      (b): b is TextBlock => b.type === 'text',
    );

    if (msg.role === 'assistant' && toolUses.length > 0) {
      result.push({
        role: 'assistant',
        content: textBlocks.map((b) => b.text).join('\n') || null,
        tool_calls: toolUses.map((tu) => ({
          id: tu.id,
          type: 'function' as const,
          function: {
            name: tu.name,
            arguments: JSON.stringify(tu.input),
          },
        })),
      });
      continue;
    }

    const text = textBlocks.map((b) => b.text).join('\n');
    result.push({ role: msg.role, content: text });
  }

  return result;
}

function translateResponseToClaude(response: OpenAI.ChatCompletion): ClaudeResponse {
  const choice = response.choices[0];
  const message = choice.message;
  const content: ContentBlock[] = [];

  if (message.content) {
    content.push({ type: 'text', text: message.content });
  }

  if (message.tool_calls?.length) {
    for (const tc of message.tool_calls) {
      if (tc.type !== 'function') continue;
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      });
    }
  }

  let stop_reason: ClaudeResponse['stop_reason'];
  if (choice.finish_reason === 'tool_calls') {
    stop_reason = 'tool_use';
  } else if (choice.finish_reason === 'length') {
    stop_reason = 'max_tokens';
  } else {
    stop_reason = 'end_turn';
  }

  return {
    content,
    stop_reason,
    usage: response.usage
      ? {
          input_tokens: response.usage.prompt_tokens ?? 0,
          output_tokens: response.usage.completion_tokens ?? 0,
        }
      : undefined,
  };
}
