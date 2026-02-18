/**
 * Streaming variant of the agent runner.
 * Same logic as agent.ts, but emits structured events via callback
 * instead of console.log.
 */

import type {
  Message,
  ToolUseBlock,
  ToolResultBlock,
  TextBlock,
  AgentDecision,
  AgentResult,
} from './types';
import { getToolDefinitions, executeTool } from './tools';
import { PrismaClient } from '@prisma/client';
import { getAIClientForRole, getModelConfigForRole } from '@/lib/ai/config';

// Prompt is loaded from DB on each agent run

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

const MAX_ITERATIONS = 30;
const MIN_CONFIDENCE = 75;

// ─── Initial Prompt ─────────────────────────────────────

const FALLBACK_AGENT_PROMPT = `You are a delivery address intelligence specialist. Your mission: determine the best verified physical mailing address for sending a package to a specific person, and produce a professional report for the client.

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
  - Calculate commute time from home to office
  - >60 min commute = person may not regularly attend that office → prefer HOME or flag COURIER
  - <60 min commute = person likely commutes in → OFFICE can work if delivery is direct-to-desk
  - Search for office delivery/reception policy: "{company name} office package delivery policy" or "{company name} mailroom"
  - Avoid OFFICE recommendation for: large campus/mega HQ (Google, Amazon, Meta, etc.), mailroom-only pickup offices

STEP 4 — DECISION
→ Tool: submit_decision
  - Only submit when confidence ≥ 76%
  - You MUST include addresses with full street, city, state, ZIP
  - Reasoning must be written as a CLIENT-FACING REPORT (see below)
  - Include career_summary: a 2-3 sentence summary of the person's career trajectory and current role (based on LinkedIn enrichment data)
  - Include profile_image_url: the avatar URL returned from the LinkedIn enrichment step (if available)

═══════════════════════════════════════════
DECISION LOGIC:
═══════════════════════════════════════════

HOME recommended when:
- Verified residential address found (ownership confirmed or strong match)
- Person appears to work remotely (commute >60 min, company has remote policy, no local office)
- Family members found at same address (strengthens confidence)
- HOME is always preferred over OFFICE when a reliable home address exists

OFFICE recommended when:
- No verified home address could be found
- Company has a confirmed physical office with DIRECT-TO-DESK delivery (not mailroom pickup)
- Commute from home to office is under 60 minutes (person regularly attends)
- Office is NOT a large campus or mega HQ (avoid Google HQ, Amazon HQ, Meta campus, etc.)
- Person's role is clearly on-site (warehouse, showroom, retail, manufacturing, physical business)

COURIER recommended when:
- No reliable home address found AND office delivery is not viable
  (mailroom-only office, large campus where packages get stuck, or commute >60 min)
- Use this instead of OFFICE when direct delivery to the person cannot be confirmed
- Always include the best known address in office_address with a note on why courier is needed

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
- [Any caveats or flags]`;

const FALLBACK_INITIAL_MESSAGE = `{{agent_prompt}}

═══════════════════════════════════════════

Target: {{input}}

Begin now. Start with enrich_linkedin_profile, then use search_person_address AND search_web, then verify with verify_property and calculate_distance. Be thorough — use each tool as many times as needed.`;

async function getAgentPrompts(): Promise<{ agentPrompt: string; initialMessageTemplate: string }> {
  try {
    const prisma = new PrismaClient();
    const rows = await prisma.systemPrompt.findMany({
      where: { key: { in: ['agent_main', 'agent_initial_message'] } },
    });
    await prisma.$disconnect();

    const agentPrompt = rows.find(r => r.key === 'agent_main')?.content ?? FALLBACK_AGENT_PROMPT;
    const initialMessageTemplate = rows.find(r => r.key === 'agent_initial_message')?.content ?? FALLBACK_INITIAL_MESSAGE;

    return { agentPrompt, initialMessageTemplate };
  } catch {
    return { agentPrompt: FALLBACK_AGENT_PROMPT, initialMessageTemplate: FALLBACK_INITIAL_MESSAGE };
  }
}

function buildInitialMessage(agentPrompt: string, initialMessageTemplate: string, input: string): Message {
  const content = initialMessageTemplate
    .replace(/\{\{agent_prompt\}\}/g, agentPrompt)
    .replace(/\{\{input\}\}/g, input);

  return { role: 'user', content };
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

  const modelConfig = await getModelConfigForRole('agent');
  const aiClient = await getAIClientForRole('agent');
  const [{ agentPrompt, initialMessageTemplate }, tools] = await Promise.all([
    getAgentPrompts(),
    getToolDefinitions(),
  ]);
  const messages: Message[] = [buildInitialMessage(agentPrompt, initialMessageTemplate, input)];

  let iteration = 0;
  let decision: AgentDecision | null = null;

  emit('agent_start', {
    input,
    provider: modelConfig.provider,
    model: modelConfig.modelId,
    maxIterations: MAX_ITERATIONS,
    minConfidence: MIN_CONFIDENCE,
  });

  while (iteration < MAX_ITERATIONS && !decision) {
    iteration++;
    emit('iteration_start', { maxIterations: MAX_ITERATIONS }, iteration);

    try {
      const response = await aiClient.callModel(messages, tools);

      // Extract any text blocks as "thinking"
      const textBlocks = response.content.filter(
        (block): block is TextBlock => block.type === 'text',
      );
      if (textBlocks.length > 0) {
        const thinkingText = textBlocks.map((b) => b.text).join('\n');
        emit('thinking', { text: thinkingText }, iteration);
      }

      // Model finished without calling tools
      if (response.stop_reason === 'end_turn') {
        messages.push({ role: 'assistant', content: response.content });
        messages.push({
          role: 'user',
          content: 'You must call tools to gather evidence. Start by searching for the person and company.',
        });
        continue;
      }

      // Model wants to call tools
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
