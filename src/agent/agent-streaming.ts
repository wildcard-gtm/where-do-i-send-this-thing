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
import { createAIClient } from '@/lib/ai/index';
import fs from 'fs';
import path from 'path';

// Prompts are loaded from prompts/ files, with DB as override fallback

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

const MAX_ITERATIONS = 25;
const MIN_CONFIDENCE = 75;

// ─── Initial Prompt ─────────────────────────────────────

const FALLBACK_AGENT_PROMPT = `You are a delivery address intelligence specialist. Your mission: determine the address with the highest probability of a physical package actually reaching this person, and produce a professional report for the client.

The most important thing is DELIVERABILITY — not address type. A home address where the person no longer lives is worse than a good office address. A mailroom office address where packages sit uncollected is worse than a verified home. Always ask: "If we FedEx a package to this address, what are the odds it reaches this person?" Choose the address with the highest odds.

Do not fabricate addresses. If you are not confident, say so. A wrong address is worse than no address.

You have access to 9 tools and a maximum of 20 tool call steps total. Be strategic — plan your calls to gather everything you need within that budget. Come to a conclusion before you run out. Do not repeat calls that return the same data.

═══════════════════════════════════════════
MANDATORY WORKFLOW (follow in order):
═══════════════════════════════════════════

STEP 1 — PROFILE ENRICHMENT (required first step)
→ Tool: enrich_linkedin_profile
→ Extract: full name, current company, job title, location, work history
→ This gives you the foundation for all subsequent searches

STEP 1.5 — PDL CONTACT ENRICHMENT (run immediately after Step 1)
→ Tool: enrich_with_pdl
→ Pass the same LinkedIn URL from Step 1
→ This returns verified phone numbers, emails, and location history from People Data Labs
→ Save the phones/emails — use them in Step 2 to confirm identity (phone match = high confidence)
→ If PDL returns a location that differs from LinkedIn, note the discrepancy

STEP 2 — HOME ADDRESS DISCOVERY
→ Tool: search_person_address
  - Search with first name + last name from Step 1
  - ALWAYS include city/state from LinkedIn location to narrow results
  - If no results with city/state, try without — but stay skeptical of results in wrong states
  - LOCATION VALIDATION (CRITICAL): After getting results, check that the returned address
    state matches the person's LinkedIn state. If LinkedIn says "Pennsylvania" and every result
    is in Florida, REJECT those results — you have the wrong person. Try a narrower search.
  - THE COMMON NAME PROBLEM: If you get 5+ results, this is a common name (e.g. "John Smith in Miami").
    In this case: (a) narrow by city/state, (b) try middle name/initial, (c) look for contact
    point matches — if LinkedIn data has a phone number and a WhitePages result shares it, that's
    a strong identity confirmation. When name is common, make extra effort to get a solid office address too.
  - CONTACT POINT MATCHING: If you have any phone numbers or emails from the LinkedIn profile,
    check if any WhitePages result shares those. A phone/email match = high-confidence identity hit.
  - ENDATO ADDRESS HISTORY: When Endato returns address history, scan ALL listed addresses and
    pick the one that matches the person's LinkedIn city/state — not necessarily the "current" one.
    The most recent entry in their DB may be stale. Prioritize addresses in the correct state.
    If Endato shows a LinkedIn-state address anywhere in the history, verify it with verify_property.
  - Also search for spouse/family at the same address — strengthens home address confidence
  - Try name variations (middle name, maiden name, hyphenated) if initial search fails
→ Tool: search_web
  - Search for: "{person name} {company}" or "{person name} {city} {state}"
  - Look for news, public records, press releases mentioning the person

STEP 3 — OFFICE RESEARCH (always run this — it's a dedicated sub-call)
→ Tool: research_office_delivery
  - Pass: full_name, title, company_name, linkedin_location
  - This runs a specialized web research call to find office address, remote/hybrid policy, and building delivery policy
  - Use this tool ONCE per person — it is thorough by design
  - DO NOT use search_web for office policy research — this tool does it better
  - OFFICE CURRENCY CHECK: Make sure any office address is current and not permanently closed.
    A closed or moved office is useless. Verify the office is still operating.
  - CURRENT COMPANY ONLY: We only care about the person's CURRENT employer's office. Never use
    a past company's address. The LinkedIn current role is the only one that matters here.

STEP 4 — VERIFICATION (use when you have candidate addresses)
→ Tool: verify_property
  - YOU MUST run this for any home address candidate before submitting
  - Check if property is owned by the person or their spouse/family
  - OWNER-OCCUPIED CHECK: If the property owner name is completely different with no family connection,
    the person may have sold and moved. Treat this as a stale address — do a fresh search.
  - MARRIED NAME CHECK: If the person's current surname differs from the owner (e.g. maiden name vs married
    name), check if there is a spouse/partner at the same address. A maiden-name-to-married-name change is
    common — "Jill Trotter" at "2823 Wildwood" owned by "Jill East" = same person, married name changed.
    If you see this pattern (female name, address in the right city/state), use it — flag the name change.
  - MULTIPLE CANDIDATES: When you have two address candidates in the correct city/state, verify BOTH with
    verify_property and pick the one where ownership confirms the person (or their spouse). Do not stop
    at the first candidate.
  - If it's an apartment or rental, note that — it's fine, just flag it
  - This confirms you have the right person at the right address
→ Tool: calculate_distance
  - Calculate driving time from home address to office
  - >60 min commute = person is likely remote → home delivery preferred
  - <60 min commute = person likely commutes in → assess office delivery viability

STEP 5 — DECISION
→ Tool: submit_decision
  - Only submit when confidence ≥ 76%
  - You MUST include full addresses: street, city, state, ZIP
  - Reasoning must be written as a CLIENT-FACING REPORT (see below)
  - Include career_summary: 2-3 sentence summary of person's career and current role
  - Include profile_image_url: avatar URL from LinkedIn enrichment step (if available)

═══════════════════════════════════════════
DECISION LOGIC — ALWAYS CHOOSE BY DELIVERABILITY:
═══════════════════════════════════════════

Before choosing, ask yourself: "If we FedEx a package here tomorrow, what is the realistic chance this person receives it?" Use that to decide.

**DEFAULT RULE: When in doubt between HOME and OFFICE, choose OFFICE.**
- Most working professionals receive packages at their office more reliably than at home
- An office with staff (receptionist, mailroom) accepts packages even when the person is out
- Home packages sit on doorsteps, require someone to be home, and can be stolen

OFFICE is the RIGHT choice when ALL of these are true:
1. Commute is under 60 minutes (person plausibly goes in)
2. Office address is current and confirmed open (not permanently closed)
3. research_office_delivery reports viable delivery (direct-to-desk OR standard mailroom)

Do NOT let these factors override a valid OFFICE recommendation:
- "Hybrid work" — hybrid workers still go in regularly; packages wait at the office
- "Senior executive" or "VP-level" — executives have assistants who collect packages
- "Multi-tenant building" — standard mailrooms in multi-tenant buildings work fine
- "Package may sit unclaimed" — offices hold packages; homes don't guarantee someone is there either
- Having a verified home address does NOT automatically mean home is better

HOME is the RIGHT choice when:
- Person is CLEARLY fully remote (commute >60 min AND company has no local office OR is fully distributed)
- Office address is unverifiable, permanently closed, or relocated
- Property ownership confirms the person still lives there AND no viable office exists
- Home delivery probability is DEMONSTRABLY higher — not just hypothetically

COURIER recommended when:
- Office is a MEGA-CAMPUS (Google HQ, Amazon campus, Meta HQ, large coworking floors with hundreds of companies) where packages routinely get lost in transit between mailroom and recipient
- Home address cannot be verified with confidence AND office delivery is also unreliable
- Person is international or in an area with no reliable office or home address
- Include the best known address with a note explaining courier is needed and why

NOTE — Standard office mailrooms are fine for OFFICE recommendation:
- Most regular offices (even those with a mailroom or front desk) successfully deliver packages
- Only flag COURIER for truly problematic delivery environments: mega-campuses, huge shared buildings, or where research explicitly confirms packages are never forwarded to recipients
- A typical mid-size company office with a receptionist or mailroom = viable OFFICE delivery

YOU MAY INCLUDE BOTH ADDRESSES in your report when you have reasonable confidence in both:
- If you found a solid home address AND a viable office, include both in the report with your primary recommendation clearly stated
- This gives the client options if the primary delivery fails
- Example: Recommend HOME but also note "Office address available as backup: [address]"

═══════════════════════════════════════════
IDENTITY VERIFICATION RULES:
═══════════════════════════════════════════
- Cross-reference name + city/STATE + employer across all data sources
- STATE IS THE MOST IMPORTANT FILTER: LinkedIn says Colorado → reject addresses in Florida.
  LinkedIn says Pennsylvania → reject addresses in Washington. Never accept an address in a
  state that doesn't match or neighbor the LinkedIn location unless there's a clear explanation.
- If person address search returns 5+ results: common name — try middle initial, narrow by city.
  DO NOT pick the first result. You must find a result that matches the LinkedIn state.
- CONTACT POINT MATCH = HIGH CONFIDENCE: If a phone number or email from the LinkedIn data
  appears in the WhitePages result for that person, that's a strong identity confirmation.
- Match by age range, phone numbers, or address proximity to workplace when name is ambiguous
- If you cannot find an address in the correct state after multiple searches, do NOT fall
  through to a wrong-state address. Accept that home is unknown and escalate to office research.
- NEVER make up an address. If you cannot verify one with confidence, say so.
- Flag if identity match is uncertain — do not guess

═══════════════════════════════════════════
REPORT FORMAT (for the "reasoning" field in submit_decision):
═══════════════════════════════════════════

Write as a professional client-facing report using markdown. The client wants to send a physical package. Never mention tool names, APIs, or internal processes.

Structure:

**Delivery Recommendation: [HOME/OFFICE/COURIER]**

[1-2 sentence summary explaining WHY this address gives the best delivery odds]

**Verified Address:**
[Full address: street, city, state, ZIP]
[Business hours if OFFICE]
[Phone number if available]

**Key Findings:**
1. [Person's role/company/work arrangement — remote, hybrid, or on-site?]
2. [How home address was verified — ownership, family match, contact point match?]
3. [Office delivery policy — direct-to-desk, mailroom, or unknown?]
4. [Estimated delivery success probability and why]

**Confidence Notes:**
- [What strengthens this recommendation]
- [Any flags or caveats]`;

const FALLBACK_INITIAL_MESSAGE = `{{agent_prompt}}

═══════════════════════════════════════════

Target: {{input}}

Begin now. Follow the workflow: 1) enrich_linkedin_profile, 1.5) enrich_with_pdl, 2) search_person_address (use PDL phones to confirm identity), 3) research_office_delivery, 4) verify_property + calculate_distance, 5) submit_decision. Be thorough — use each tool as many times as needed.`;

function loadPromptFile(filename: string): string | null {
  try {
    const filePath = path.join(process.cwd(), 'prompts', filename);
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

async function getAgentPrompts(): Promise<{ agentPrompt: string; initialMessageTemplate: string }> {
  // Load from prompts/ files first (source of truth)
  const fileAgentPrompt = loadPromptFile('agent_main.md');
  const fileInitialMessage = loadPromptFile('agent_initial_message.md');

  if (fileAgentPrompt && fileInitialMessage) {
    return { agentPrompt: fileAgentPrompt, initialMessageTemplate: fileInitialMessage };
  }

  // Fall back to DB if files not found
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
  let aiClient = await getAIClientForRole('agent');
  let usingFallback = false;
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

  // Helper: detect rate limit / throttling errors
  const isRateLimit = (err: unknown): boolean => {
    const msg = (err as Error)?.message ?? '';
    return msg.includes('Too many tokens per day') || msg.includes('ThrottlingException') || msg.includes('rate limit') || msg.includes('Rate limit');
  };

  while (iteration < MAX_ITERATIONS && !decision) {
    iteration++;
    emit('iteration_start', { maxIterations: MAX_ITERATIONS }, iteration);

    let response;
    try {
      response = await aiClient.callModel(messages, tools);
    } catch (err) {
      // On rate limit, fall back to the other provider and retry once
      if (isRateLimit(err) && !usingFallback) {
        usingFallback = true;
        // If primary is OpenAI, fall back to Bedrock; if Bedrock, fall back to OpenAI
        const primaryProvider = modelConfig?.provider ?? 'openai';
        const fallbackClient = primaryProvider === 'openai'
          ? createAIClient('bedrock', 'global.anthropic.claude-sonnet-4-5-20250929-v1:0')
          : createAIClient('openai', 'gpt-5.2');
        aiClient = fallbackClient;
        emit('thinking', { text: `[Rate limited — switching to fallback provider]` }, iteration);
        try {
          response = await aiClient.callModel(messages, tools);
        } catch (fallbackErr) {
          emit('error', { message: (fallbackErr as Error).message }, iteration);
          break;
        }
      } else {
        emit('error', { message: (err as Error).message }, iteration);
        break;
      }
    }

    // Extract any text blocks as "thinking"
    const textBlocks = response!.content.filter(
      (block): block is TextBlock => block.type === 'text',
    );
    if (textBlocks.length > 0) {
      const thinkingText = textBlocks.map((b) => b.text).join('\n');
      emit('thinking', { text: thinkingText }, iteration);
    }

    // Model finished without calling tools
    if (response!.stop_reason === 'end_turn') {
      messages.push({ role: 'assistant', content: response!.content });
      messages.push({
        role: 'user',
        content: 'You must call tools to gather evidence. Start by searching for the person and company.',
      });
      continue;
    }

    // Model wants to call tools
    if (response!.stop_reason === 'tool_use') {
      const toolUses = response!.content.filter(
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

      messages.push({ role: 'assistant', content: response!.content });
      messages.push({ role: 'user', content: toolResults as unknown as Message['content'] });
    }

    // Context window exhausted
    if (response!.stop_reason === 'max_tokens') {
      emit('error', { message: 'Hit max_tokens limit.' }, iteration);
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
