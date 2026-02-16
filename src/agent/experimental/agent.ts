/**
 * Experimental Agent v1 — Enhanced with probabilistic address narrowing.
 *
 * New capabilities over the base agent:
 * - FEC donation records (home addresses of political donors)
 * - OpenCorporates officer search (registered addresses)
 * - Census income data (neighborhood affordability scoring)
 * - Commute probability scoring (Bayesian distance weighting)
 *
 * The key insight: P(home | workplace, income, donations, property, commute)
 * Each data source either gives a direct address or constrains the search space.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import type {
  Message,
  ClaudeResponse,
  ToolUseBlock,
  ToolResultBlock,
  AgentDecision,
  AgentResult,
} from '../types';
import { TOOL_DEFINITIONS, executeTool } from './tools';

const MODEL_ID = process.env.BEDROCK_MODEL_ID ?? 'global.anthropic.claude-sonnet-4-5-20250929-v1:0';
const MAX_ITERATIONS = 20; // More iterations for deeper investigation
const MIN_CONFIDENCE = 75;

function createBedrockClient(): BedrockRuntimeClient {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing AWS credentials. Set AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY in .env');
  }

  return new BedrockRuntimeClient({ region, credentials: { accessKeyId, secretAccessKey } });
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

function buildInitialMessage(input: string): Message {
  return {
    role: 'user',
    content: `You are an advanced address verification agent using probabilistic reasoning. Your job is to determine the best physical delivery address (HOME, OFFICE, or BOTH) for sending a package.

You have access to standard AND experimental data sources. Use them strategically.

STANDARD TOOLS:
1. enrich_linkedin_profile - LinkedIn profile data via Bright Data
2. search_person_address - Residential address history via Endato (US addresses)
3. search_web - Neural web search via Exa AI
4. verify_property - Property ownership via PropMix
5. calculate_distance - Driving distance via Google Maps

EXPERIMENTAL TOOLS (use these for deeper investigation):
6. search_fec_donations - Search FEC political donation records. DONORS' HOME ADDRESSES ARE PUBLIC RECORD. If this person ever donated to a federal campaign, their full address is in the database. This is one of the most powerful tools for finding home addresses.
7. search_corporate_officer - Search OpenCorporates for the person as a company officer/director/agent. Officer registered addresses often correspond to home addresses, especially for LLCs and small companies.
8. find_affordable_zips - Given an estimated income and state, find ZIP codes where median household income matches. Narrows the geographic search space using Census data.
9. score_commute_probability - Score how likely a given distance is as a real commute. Based on Census commute distribution. Use after calculate_distance to weight candidate addresses.

PROBABILISTIC STRATEGY:
Think of this as narrowing a probability cloud: P(home_address | all_evidence)

Phase 1 — Identity (who is this person?):
  - enrich_linkedin_profile OR search_web to get name, company, title, location

Phase 2 — Direct Address Discovery (try to find addresses directly):
  - search_fec_donations — ALWAYS try this. Many professionals donate to campaigns.
  - search_person_address — Endato people search
  - search_corporate_officer — especially useful for business owners, founders, executives

Phase 3 — Workplace Verification:
  - search_web for company office address
  - verify_property if you have a candidate address

Phase 4 — Bayesian Narrowing (if no direct address found):
  - Estimate income from job title and company
  - find_affordable_zips to identify likely neighborhoods
  - calculate_distance + score_commute_probability for candidate addresses

Phase 5 — Cross-Reference & Decide:
  - If multiple sources agree on an address, boost confidence significantly
  - If FEC + Endato agree, that's very high confidence
  - If only web search, lower confidence
  - submit_decision when >75% confident

IDENTITY VERIFICATION:
  - When searching by name, verify it's the RIGHT person using employer, city, occupation
  - FEC records include employer — match against LinkedIn data
  - Flag common names or uncertain identity matches

Target: ${input}

Begin investigating now. Start with identity, then use ALL available tools including the experimental ones.`,
  };
}

export async function runExperimentalAgent(input: string): Promise<AgentResult> {
  const client = createBedrockClient();
  const messages: Message[] = [buildInitialMessage(input)];

  let iteration = 0;
  let decision: AgentDecision | null = null;

  console.log('\n' + '='.repeat(60));
  console.log('  EXPERIMENTAL ADDRESS VERIFICATION AGENT v1');
  console.log('  (Probabilistic narrowing + FEC + OpenCorporates + Census)');
  console.log('='.repeat(60));
  console.log(`  Target:     ${input}`);
  console.log(`  Model:      ${MODEL_ID}`);
  console.log(`  Max iter:   ${MAX_ITERATIONS}`);
  console.log(`  Min conf:   ${MIN_CONFIDENCE}%`);
  console.log(`  Tools:      ${TOOL_DEFINITIONS.length} (${TOOL_DEFINITIONS.length - 6} experimental)`);
  console.log('='.repeat(60));

  while (iteration < MAX_ITERATIONS && !decision) {
    iteration++;
    console.log(`\n--- Iteration ${iteration}/${MAX_ITERATIONS} ---`);

    try {
      const response = await callClaude(client, messages);

      if (response.usage) {
        console.log(`  Tokens: ${response.usage.input_tokens} in / ${response.usage.output_tokens} out`);
      }

      if (response.stop_reason === 'end_turn') {
        console.log('  No tool calls — nudging...');
        messages.push({ role: 'assistant', content: response.content });
        messages.push({
          role: 'user',
          content: 'You must call tools to gather evidence. Try search_fec_donations and search_corporate_officer — these experimental tools often find addresses that standard tools miss.',
        });
        continue;
      }

      if (response.stop_reason === 'tool_use') {
        const toolUses = response.content.filter(
          (block): block is ToolUseBlock => block.type === 'tool_use',
        );

        console.log(`  Calling ${toolUses.length} tool(s):`);
        const toolResults: ToolResultBlock[] = [];

        for (const toolUse of toolUses) {
          const inputPreview = JSON.stringify(toolUse.input).slice(0, 120);
          const isExperimental = ['search_fec_donations', 'search_corporate_officer', 'find_affordable_zips', 'score_commute_probability'].includes(toolUse.name);
          const tag = isExperimental ? '[EXP]' : '     ';
          console.log(`    ${tag} > ${toolUse.name}(${inputPreview})`);

          const { toolResult, decision: submitted } = await executeTool(toolUse);
          console.log(`    ${tag}   ${toolResult.success ? 'OK' : 'FAIL'}: ${toolResult.summary}`);

          if (toolUse.name === 'submit_decision' && submitted) {
            if (submitted.confidence < MIN_CONFIDENCE) {
              console.log(`           REJECTED: ${submitted.confidence}% < ${MIN_CONFIDENCE}%`);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: toolUse.id,
                content: JSON.stringify({
                  rejected: true,
                  reason: `Confidence ${submitted.confidence}% is below ${MIN_CONFIDENCE}%. Try experimental tools: search_fec_donations, search_corporate_officer, find_affordable_zips.`,
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

      if (response.stop_reason === 'max_tokens') {
        console.log('  WARNING: Hit max_tokens. Stopping.');
        break;
      }
    } catch (err) {
      console.error(`  ERROR: ${(err as Error).message}`);
      break;
    }
  }

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

  return { input, iterations: iteration, decision, timestamp: new Date().toISOString() };
}
