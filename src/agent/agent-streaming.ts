/**
 * Streaming variant of the agent runner.
 * Same logic as agent.ts, but emits structured events via callback
 * instead of console.log.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type {
  Message,
  ClaudeResponse,
  ToolUseBlock,
  ToolResultBlock,
  TextBlock,
  AgentDecision,
  AgentResult,
} from './types';
import { TOOL_DEFINITIONS, executeTool } from './tools';

// ─── Streaming Event Types ─────────────────────────────

export type AgentEventType =
  | 'agent_start'
  | 'iteration_start'
  | 'thinking'
  | 'tool_call_start'
  | 'tool_call_result'
  | 'decision_rejected'
  | 'decision_accepted'
  | 'error'
  | 'complete';

export interface AgentStreamEvent {
  type: AgentEventType;
  timestamp: string;
  iteration?: number;
  data: Record<string, unknown>;
}

// ─── Configuration ──────────────────────────────────────

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'global.anthropic.claude-sonnet-4-5-20250929-v1:0';
const MAX_ITERATIONS = 15;
const MIN_CONFIDENCE = 75;

// ─── Bedrock Client ─────────────────────────────────────

function createBedrockClient(): BedrockRuntimeClient {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'Missing AWS credentials. Set AWS_REGION, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY in .env',
    );
  }

  return new BedrockRuntimeClient({
    region,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function callClaude(client: BedrockRuntimeClient, messages: Message[]): Promise<ClaudeResponse> {
  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 8192,
      temperature: 0.3,
      messages,
      tools: TOOL_DEFINITIONS,
    }),
  });

  const response = await client.send(command);
  return JSON.parse(new TextDecoder().decode(response.body)) as ClaudeResponse;
}

// ─── Initial Prompt ─────────────────────────────────────

function buildInitialMessage(input: string): Message {
  return {
    role: 'user',
    content: `You are an address verification agent. Your job is to determine the best physical delivery address (HOME, OFFICE, or BOTH) for sending a package to a specific person.

AVAILABLE TOOLS:
1. enrich_linkedin_profile - Get LinkedIn profile data (name, company, title, location, experience). Use FIRST if a LinkedIn URL is provided.
2. search_person_address - Find residential address history by name via Endato. Best for US addresses.
3. search_web - Neural web search via Exa AI. Research company offices, remote work policies, person info.
4. verify_property - Verify property ownership via PropMix. Confirm if a US address belongs to a person.
5. calculate_distance - Calculate driving distance between two addresses. >50 miles suggests remote worker.
6. submit_decision - Submit your final recommendation when confidence >75%.

STRATEGY:
1. If LinkedIn URL provided: enrich_linkedin_profile first to get name, company, location.
2. search_web for company office address and any public info about the person.
3. search_person_address for home address (needs first + last name; city/state helps narrow results).
4. verify_property if you find a candidate address and want to confirm ownership.
5. calculate_distance if you have both home and office addresses.
6. Cross-reference sources and iterate until confident. Submit when >75%.

DECISION GUIDELINES:
- HOME: Verified home address exists, person is likely remote or works from home, reasonable distance.
- OFFICE: No reliable home address found, company HQ is verified, person works on-site.
- BOTH: Multiple verified addresses available, uncertainty about best option.

IDENTITY VERIFICATION:
- When searching by name, verify you found the RIGHT person by matching city, company, and age.
- If Endato returns multiple results, use location and employer to disambiguate.
- Flag common-name situations or if identity match is uncertain.

Target: ${input}

Begin investigating now. Call tools to gather evidence.`,
  };
}

// ─── Streaming Agent Runner ─────────────────────────────

export async function runAgentStreaming(
  input: string,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<AgentResult> {
  const emit = (type: AgentEventType, data: Record<string, unknown>, iteration?: number) => {
    onEvent({
      type,
      timestamp: new Date().toISOString(),
      iteration,
      data,
    });
  };

  const client = createBedrockClient();
  const messages: Message[] = [buildInitialMessage(input)];

  let iteration = 0;
  let decision: AgentDecision | null = null;

  emit('agent_start', {
    input,
    model: MODEL_ID,
    maxIterations: MAX_ITERATIONS,
    minConfidence: MIN_CONFIDENCE,
  });

  while (iteration < MAX_ITERATIONS && !decision) {
    iteration++;
    emit('iteration_start', { maxIterations: MAX_ITERATIONS }, iteration);

    try {
      const response = await callClaude(client, messages);

      // Extract any text blocks as "thinking"
      const textBlocks = response.content.filter(
        (block): block is TextBlock => block.type === 'text',
      );
      if (textBlocks.length > 0) {
        const thinkingText = textBlocks.map((b) => b.text).join('\n');
        emit('thinking', { text: thinkingText }, iteration);
      }

      // Claude finished without calling tools
      if (response.stop_reason === 'end_turn') {
        messages.push({ role: 'assistant', content: response.content });
        messages.push({
          role: 'user',
          content: 'You must call tools to gather evidence. Start by searching for the person and company.',
        });
        continue;
      }

      // Claude wants to call tools
      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter(
          (block): block is ToolUseBlock => block.type === 'tool_use',
        );

        const toolResults: ToolResultBlock[] = [];

        for (const toolUse of toolUses) {
          emit('tool_call_start', {
            toolName: toolUse.name,
            toolInput: toolUse.input,
          }, iteration);

          const { toolResult, decision: submitted } = await executeTool(toolUse);

          // Handle decision submission
          if (toolUse.name === 'submit_decision' && submitted) {
            if (submitted.confidence < MIN_CONFIDENCE) {
              emit('decision_rejected', {
                confidence: submitted.confidence,
                threshold: MIN_CONFIDENCE,
                reason: `Confidence ${submitted.confidence}% is below the ${MIN_CONFIDENCE}% threshold.`,
              }, iteration);

              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify({
                  rejected: true,
                  reason: `Confidence ${submitted.confidence}% is below the ${MIN_CONFIDENCE}% threshold. Gather more evidence and try again.`,
                }),
              });

              emit('tool_call_result', {
                toolName: toolUse.name,
                success: false,
                summary: `Decision rejected: ${submitted.confidence}% < ${MIN_CONFIDENCE}%`,
              }, iteration);
              continue;
            }
            decision = submitted;

            emit('decision_accepted', {
              decision: submitted,
            }, iteration);
          }

          emit('tool_call_result', {
            toolName: toolUse.name,
            success: toolResult.success,
            summary: toolResult.summary,
            data: toolResult.data,
          }, iteration);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(toolResult),
          });
        }

        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: toolResults as unknown as Message['content'] });
      }

      // Context window exhausted
      if (response.stop_reason === 'max_tokens') {
        emit('error', { message: 'Hit max_tokens limit.' }, iteration);
        break;
      }
    } catch (err) {
      emit('error', { message: (err as Error).message }, iteration);
      break;
    }
  }

  const result: AgentResult = {
    input,
    iterations: iteration,
    decision,
    timestamp: new Date().toISOString(),
  };

  emit('complete', { result });

  return result;
}
