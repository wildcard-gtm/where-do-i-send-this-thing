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
const MAX_ITERATIONS = 30;
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
      max_tokens: 65536,
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
    content: `You are a delivery address intelligence specialist. Your mission: determine the best verified physical mailing address for sending a package to a specific person, and produce a professional report for the client.

You have access to 6 tools. You MUST use multiple tools — not just web search. Each tool can be called up to 15 times. Be thorough.

═══════════════════════════════════════════
MANDATORY WORKFLOW (follow in order):
═══════════════════════════════════════════

STEP 1 — PROFILE ENRICHMENT (required first step)
→ Tool: enrich_linkedin_profile
→ Extract: full name, current company, job title, location, work history
→ This gives you the foundation for all subsequent searches

STEP 2 — ADDRESS DISCOVERY (use BOTH tools below)
→ Tool: search_person_address (Endato)
  - Search with first name + last name from Step 1
  - Add city/state from LinkedIn location to narrow results
  - If initial search returns no results, try without city/state
  - If multiple results: match by city, employer, age range
  - IMPORTANT: Also search for spouse/family members at the same address — if a family member (spouse, adult child) is found at an address, that strengthens the home address confidence
  - Try name variations (middle name, maiden name) if initial search fails
→ Tool: search_web (Exa)
  - Search for: "{company name} office address {city}"
  - Search for: "{person name} address" or "{person name} {company}"
  - Search for company remote work policy: "{company name} remote work policy" or "{company name} office locations"
  - Look for news articles, press releases, or public records mentioning the person

STEP 3 — VERIFICATION (use when you have candidate addresses)
→ Tool: verify_property
  - Verify ownership of any home address candidates
  - Check if the property is owned by the person or their spouse/family
  - This is critical for confirming the right address
→ Tool: calculate_distance
  - Calculate distance between home and office address
  - >50 miles = likely remote worker → prefer HOME delivery
  - <15 miles = likely commutes → either could work
  - No home address found → prefer OFFICE

STEP 4 — DECISION
→ Tool: submit_decision
  - Only submit when confidence ≥ 76%
  - You MUST include addresses with full street, city, state, ZIP
  - Reasoning must be written as a CLIENT-FACING REPORT (see below)

═══════════════════════════════════════════
DECISION LOGIC:
═══════════════════════════════════════════

HOME recommended when:
- Verified residential address found (ownership confirmed or strong match)
- Person appears to work remotely (distance >50mi, company has remote policy, no local office)
- Family members found at same address (strengthens confidence)

OFFICE recommended when:
- No verified home address could be found
- Company has a confirmed physical office location
- Person's role suggests on-site work (warehouse, showroom, retail, manufacturing)
- Person is a business owner with a physical establishment

BOTH recommended when:
- Both addresses verified with high confidence
- Unclear which is better (e.g., hybrid worker, <30mi commute)

═══════════════════════════════════════════
IDENTITY VERIFICATION RULES:
═══════════════════════════════════════════
- Cross-reference name + city + employer across all sources
- If Endato returns 3+ results, use LinkedIn location and company to find the match
- For common names: also match by age range, middle initial, or address proximity to workplace
- Flag if identity match is uncertain

═══════════════════════════════════════════
REPORT FORMAT (for the "reasoning" field in submit_decision):
═══════════════════════════════════════════

Write the reasoning field as a professional client-facing report using markdown. The client is a business that wants to send a physical package. They do NOT know or care about internal tools, APIs, or technical processes. Never mention Endato, Exa, PropMix, Bright Data, or any tool names.

Structure your report like this:

**Delivery Recommendation: [HOME/OFFICE]**

[1-2 sentence summary of the recommendation]

**Verified Address:**
[Full address with street, city, state, ZIP]
[Business hours if OFFICE]
[Phone number if available]

**Key Findings:**
1. [Finding about person's role/company]
2. [Finding about address verification]
3. [Finding about work arrangement — remote/on-site/hybrid]
4. [Any relevant notes about accessibility or delivery reliability]

**Confidence Notes:**
- [What strengthens this recommendation]
- [Any caveats or flags]

═══════════════════════════════════════════

Target: ${input}

Begin now. Start with enrich_linkedin_profile, then use search_person_address AND search_web, then verify with verify_property and calculate_distance. Be thorough — use each tool as many times as needed.`,
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
