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

const MAX_ITERATIONS = 40;
const MIN_CONFIDENCE = 75;

// ─── Initial Prompt ─────────────────────────────────────

const FALLBACK_AGENT_PROMPT = `You are a delivery address intelligence specialist. Your mission: determine the best verified physical mailing address for sending a package to a specific person, and produce a professional report for the client.

The most important thing is DELIVERABILITY. Do not fabricate addresses. If you are not confident, say so. A wrong address is worse than no address.

You have access to 7 tools. Each tool can be called up to 15 times. Be thorough and use all relevant tools.

═══════════════════════════════════════════
MANDATORY WORKFLOW (follow in order):
═══════════════════════════════════════════

STEP 1 — PROFILE ENRICHMENT (required first step)
→ Tool: enrich_linkedin_profile
→ Extract: full name, current company, job title, location, work history
→ This gives you the foundation for all subsequent searches

STEP 2 — HOME ADDRESS DISCOVERY
→ Tool: search_person_address
  - Search with first name + last name from Step 1
  - Add city/state from LinkedIn location to narrow results
  - If no results, try without city/state
  - If multiple results: match by city, employer, age range, phone numbers
  - THE COMMON NAME PROBLEM: If you get 5+ results, this is a common name (e.g. "John Smith in Miami").
    In this case, try to narrow by city, try middle name/initial, and focus harder on getting a solid office address as backup.
  - Also search for spouse/family at the same address — strengthens home address confidence
  - Try name variations (middle name, maiden name) if initial search fails
→ Tool: search_web
  - Search for: "{person name} {company}" or "{person name} {city}"
  - Look for news, public records, press releases mentioning the person

STEP 3 — OFFICE RESEARCH (always run this — it's a dedicated sub-call)
→ Tool: research_office_delivery
  - Pass: full_name, title, company_name, linkedin_location
  - This runs a specialized web research call to find office address, remote/hybrid policy, and building delivery policy
  - Use this tool ONCE per person — it is thorough by design
  - DO NOT use search_web for office policy research — this tool does it better

STEP 4 — VERIFICATION (use when you have candidate addresses)
→ Tool: verify_property
  - Verify ownership of any home address candidates
  - Check if property is owned by the person or their spouse/family
  - This confirms you have the right person at the right address
→ Tool: calculate_distance
  - Calculate driving time from home address to office
  - >60 min = person likely remote → prefer HOME
  - <60 min = person likely commutes → OFFICE viable if research_office_delivery confirms direct-to-desk

STEP 5 — DECISION
→ Tool: submit_decision
  - Only submit when confidence ≥ 76%
  - You MUST include full addresses: street, city, state, ZIP
  - Reasoning must be written as a CLIENT-FACING REPORT (see below)
  - Include career_summary: 2-3 sentence summary of person's career and current role
  - Include profile_image_url: avatar URL from LinkedIn enrichment step (if available)

═══════════════════════════════════════════
DECISION LOGIC:
═══════════════════════════════════════════

HOME recommended when:
- Verified residential address found (ownership confirmed or strong match)
- Person appears to work remotely (commute >60 min, company has remote policy, no local office)
- Family members found at same address (strengthens confidence)
- HOME is always preferred when a reliable home address exists

OFFICE recommended when:
- research_office_delivery confirms DIRECT-TO-DESK delivery (not mailroom pickup)
- Commute from home to office is under 60 minutes
- Office is NOT a large campus/mega HQ (avoid Google HQ, Amazon HQ, Meta campus, etc.)
- Person's role is clearly on-site (retail, warehouse, showroom, physical business)
- No verified home address found

COURIER recommended when:
- No reliable home address AND office delivery is not viable
  (mailroom-only, large corporate campus, security desk pickup, commute >60 min)
- Use instead of OFFICE when direct-to-desk delivery cannot be confirmed
- Include the best known address in office_address with a note explaining why courier is needed

═══════════════════════════════════════════
IDENTITY VERIFICATION RULES:
═══════════════════════════════════════════
- Cross-reference name + city + employer across all data sources
- If person address search returns 5+ results: common name — try middle initial, narrow by city
- Match by age range, phone numbers, or address proximity to workplace when name is ambiguous
- Flag if identity match is uncertain — do not guess

═══════════════════════════════════════════
REPORT FORMAT (for the "reasoning" field in submit_decision):
═══════════════════════════════════════════

Write as a professional client-facing report using markdown. The client wants to send a physical package. Never mention tool names, APIs, or internal processes.

Structure:

**Delivery Recommendation: [HOME/OFFICE/COURIER]**

[1-2 sentence summary]

**Verified Address:**
[Full address: street, city, state, ZIP]
[Business hours if OFFICE]
[Phone number if available]

**Key Findings:**
1. [Person's role/company/work arrangement]
2. [How address was verified]
3. [Office delivery policy — direct-to-desk or mailroom?]
4. [Any delivery reliability notes or caveats]

**Confidence Notes:**
- [What strengthens this recommendation]
- [Any flags or caveats]`;

const FALLBACK_INITIAL_MESSAGE = `{{agent_prompt}}

═══════════════════════════════════════════

Target: {{input}}

Begin now. Follow the workflow: 1) enrich_linkedin_profile, 2) search_person_address, 3) research_office_delivery, 4) verify_property + calculate_distance, 5) submit_decision. Be thorough — use each tool as many times as needed.`;

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
