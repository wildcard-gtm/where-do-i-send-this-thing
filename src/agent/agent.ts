/**
 * Core agent runner — Bedrock client + agentic loop.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type {
  Message,
  ClaudeResponse,
  ToolUseBlock,
  ToolResultBlock,
  AgentDecision,
  AgentResult,
} from './types';
import { TOOL_DEFINITIONS, executeTool } from './tools';

// ─── Configuration ───────────────────────────────────────

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'global.anthropic.claude-sonnet-4-5-20250929-v1:0';
const MAX_ITERATIONS = 15;
const MIN_CONFIDENCE = 75;

// ─── Bedrock Client ──────────────────────────────────────

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

// ─── Initial Prompt ──────────────────────────────────────

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

// ─── Agent Runner ────────────────────────────────────────

export async function runAgent(input: string): Promise<AgentResult> {
  const client = createBedrockClient();
  const messages: Message[] = [buildInitialMessage(input)];

  let iteration = 0;
  let decision: AgentDecision | null = null;

  console.log('\n' + '='.repeat(60));
  console.log('  ADDRESS VERIFICATION AGENT');
  console.log('='.repeat(60));
  console.log(`  Target:     ${input}`);
  console.log(`  Model:      ${MODEL_ID}`);
  console.log(`  Max iter:   ${MAX_ITERATIONS}`);
  console.log(`  Min conf:   ${MIN_CONFIDENCE}%`);
  console.log('='.repeat(60));

  while (iteration < MAX_ITERATIONS && !decision) {
    iteration++;
    console.log(`\n--- Iteration ${iteration}/${MAX_ITERATIONS} ---`);

    try {
      const response = await callClaude(client, messages);

      if (response.usage) {
        console.log(`  Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);
      }

      // Claude finished without calling tools — nudge it
      if (response.stop_reason === 'end_turn') {
        console.log('  No tool calls — nudging to investigate...');
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

        console.log(`  Calling ${toolUses.length} tool(s):`);
        const toolResults: ToolResultBlock[] = [];

        for (const toolUse of toolUses) {
          const inputPreview = JSON.stringify(toolUse.input).slice(0, 120);
          console.log(`    > ${toolUse.name}(${inputPreview})`);

          const { toolResult, decision: submitted } = await executeTool(toolUse);
          console.log(`      ${toolResult.success ? 'OK' : 'FAIL'}: ${toolResult.summary}`);

          // Handle decision submission
          if (toolUse.name === 'submit_decision' && submitted) {
            if (submitted.confidence < MIN_CONFIDENCE) {
              console.log(`      REJECTED: ${submitted.confidence}% < ${MIN_CONFIDENCE}% threshold`);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify({
                  rejected: true,
                  reason: `Confidence ${submitted.confidence}% is below the ${MIN_CONFIDENCE}% threshold. Gather more evidence and try again.`,
                }),
              });
              continue;
            }
            decision = submitted;
          }

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
        console.log('  WARNING: Hit max_tokens. Stopping.');
        break;
      }
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
      break;
    }
  }

  // Print final result
  console.log('\n' + '='.repeat(60));
  console.log('  RESULT');
  console.log('='.repeat(60));

  if (decision) {
    console.log(`  Recommendation: ${decision.recommendation}`);
    console.log(`  Confidence:     ${decision.confidence}%`);
    console.log(`  Reasoning:      ${decision.reasoning}`);
    if (decision.home_address) {
      console.log(`  Home:           ${decision.home_address.address} (${decision.home_address.confidence}%)`);
    }
    if (decision.office_address) {
      console.log(`  Office:         ${decision.office_address.address} (${decision.office_address.confidence}%)`);
    }
    if (decision.flags?.length) {
      console.log(`  Flags:          ${decision.flags.join(', ')}`);
    }
  } else {
    console.log('  No decision reached within iteration limit.');
  }

  console.log('='.repeat(60) + '\n');

  return {
    input,
    iterations: iteration,
    decision,
    timestamp: new Date().toISOString(),
  };
}
