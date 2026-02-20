/**
 * Company Enrichment Agent
 * Given a contact's existing data (name, company, LinkedIn URL, etc.),
 * runs an AI agent loop that fetches:
 *  - Company logo (Hunter.io → website scraping fallback)
 *  - Top 3 open roles
 *  - Company values
 *  - Office locations
 *  - Team member photos
 */

import type { Message, ToolUseBlock, ToolResultBlock, TextBlock } from './types';
import { getAIClientForRole } from '@/lib/ai/config';
import { createAIClient } from '@/lib/ai/index';
import { fetchCompanyLogo, searchExaAI, researchOfficeDelivery } from './services';
import axios, { type AxiosError } from 'axios';

// ─── Types ───────────────────────────────────────────────

export interface EnrichmentInput {
  contactId: string;
  name: string;
  company: string;
  linkedinUrl: string;
  title?: string;
  location?: string;
  officeAddress?: string;
}

export interface OpenRole {
  title: string;
  location: string;
  level: string;
  url?: string;
}

export interface TeamPhoto {
  name?: string;
  photoUrl: string;
  title?: string;
}

export interface EnrichmentResult {
  companyName: string;
  companyWebsite?: string;
  companyLogo?: string;
  openRoles?: OpenRole[];
  companyValues?: string[];
  companyMission?: string;
  officeLocations?: string[];
  teamPhotos?: TeamPhoto[];
}

export type EnrichmentEventType =
  | 'start'
  | 'step'
  | 'tool_call'
  | 'tool_result'
  | 'complete'
  | 'error';

export interface EnrichmentEvent {
  type: EnrichmentEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── Tool Definitions ────────────────────────────────────

const ENRICHMENT_TOOLS = [
  {
    name: 'fetch_company_logo',
    description: 'Fetch company logo from Hunter.io using the company domain. Try this first before scraping.',
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Company domain (e.g. "stripe.com", "ashbyhq.com")' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'search_web',
    description: 'Search the web for company information. Use for finding open roles, company values, mission statement, office locations, and team photos.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        num_results: { type: 'number', description: 'Number of results (default: 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch and read the contents of a URL. Use to scrape company careers page, about page, or values page.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to fetch' },
      },
      required: ['url'],
    },
  },
  {
    name: 'submit_enrichment',
    description: 'Submit the final enriched company data. Call this when you have gathered all available information.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_name: { type: 'string', description: 'Confirmed company name' },
        company_website: { type: 'string', description: 'Company website URL (e.g. https://stripe.com)' },
        company_logo: { type: 'string', description: 'URL to company logo image' },
        open_roles: {
          type: 'array',
          description: 'Top 3 highest-level open roles',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              location: { type: 'string' },
              level: { type: 'string', description: 'e.g. senior, staff, principal, vp, director' },
              url: { type: 'string', description: 'Link to job posting (optional)' },
            },
            required: ['title', 'location', 'level'],
          },
        },
        company_values: {
          type: 'array',
          description: 'Company core values (3-6 items)',
          items: { type: 'string' },
        },
        company_mission: { type: 'string', description: 'Company mission statement (1-2 sentences)' },
        office_locations: {
          type: 'array',
          description: 'Cities/regions where company has offices',
          items: { type: 'string' },
        },
        team_photos: {
          type: 'array',
          description: 'Photo URLs of team members (from LinkedIn company page or website)',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              photo_url: { type: 'string' },
              title: { type: 'string' },
            },
            required: ['photo_url'],
          },
        },
      },
      required: ['company_name'],
    },
  },
];

// ─── System Prompt ───────────────────────────────────────

const ENRICHMENT_SYSTEM_PROMPT = `You are a company data enrichment specialist. Given a contact's name, company, and LinkedIn URL, your job is to research and collect the following data about their company:

1. **Company logo** — Try fetch_company_logo first with the company domain. If it fails, use search_web to find the logo URL from the company website.
2. **Top 3 open roles** — Find the 3 highest-level open positions (prioritize Director, VP, Staff, Principal, Senior roles). Include the location for each role.
3. **Company values** — Find 3-6 core company values from their website or about page.
4. **Company mission** — Find the mission statement (1-2 sentences) from their website.
5. **Office locations** — Find cities/regions where the company has offices.
6. **Team photos** — Find 2-3 photos of team members from the company website or LinkedIn.

WORKFLOW:
1. First, determine the company domain from the company name (e.g. "Stripe" → "stripe.com")
2. Call fetch_company_logo with that domain
3. Use search_web to find: "[company] open jobs careers", "[company] company values mission", "[company] office locations"
4. Use fetch_url to scrape the careers page and about/values page directly if search_web gives you URLs
5. Call submit_enrichment with everything you found — include whatever you have, even if some fields are missing

Be efficient — you have a max of 15 tool calls. Don't repeat searches. Prioritize quality over quantity.
If you can't find certain data, submit what you have with null for missing fields.
Never make up data. Only include what you actually found.`;

// ─── Tool Executor ───────────────────────────────────────

async function executeEnrichmentTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ result: Record<string, unknown>; enrichmentData?: EnrichmentResult }> {
  switch (toolName) {
    case 'fetch_company_logo': {
      const res = await fetchCompanyLogo(args.domain as string);
      return { result: { success: res.success, data: res.data, summary: res.summary } };
    }

    case 'search_web': {
      const res = await searchExaAI(
        args.query as string,
        'auto',
        (args.num_results as number | undefined) ?? 5,
      );
      return { result: { success: res.success, data: res.data, summary: res.summary } };
    }

    case 'fetch_url': {
      try {
        const res = await axios.get(args.url as string, {
          timeout: 15_000,
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; enrichment-bot/1.0)' },
          validateStatus: (s) => s < 500,
        });
        // Truncate to avoid burning context
        const text = typeof res.data === 'string'
          ? res.data.slice(0, 8000)
          : JSON.stringify(res.data).slice(0, 8000);
        return { result: { success: true, content: text, url: args.url } };
      } catch (err) {
        return { result: { success: false, error: (err as AxiosError).message } };
      }
    }

    case 'submit_enrichment': {
      const data: EnrichmentResult = {
        companyName: args.company_name as string,
        companyWebsite: args.company_website as string | undefined,
        companyLogo: args.company_logo as string | undefined,
        openRoles: args.open_roles as OpenRole[] | undefined,
        companyValues: args.company_values as string[] | undefined,
        companyMission: args.company_mission as string | undefined,
        officeLocations: args.office_locations as string[] | undefined,
        teamPhotos: args.team_photos
          ? (args.team_photos as Array<{ name?: string; photo_url: string; title?: string }>).map(p => ({
              name: p.name,
              photoUrl: p.photo_url,
              title: p.title,
            }))
          : undefined,
      };
      return { result: { success: true, summary: 'Enrichment submitted' }, enrichmentData: data };
    }

    default:
      return { result: { success: false, error: `Unknown tool: ${toolName}` } };
  }
}

// ─── Agent Runner ────────────────────────────────────────

const MAX_ITERATIONS = 15;

export async function runEnrichmentAgent(
  input: EnrichmentInput,
  onEvent: (event: EnrichmentEvent) => void,
): Promise<EnrichmentResult | null> {
  const emit = (type: EnrichmentEventType, data: Record<string, unknown>) => {
    onEvent({ type, timestamp: new Date().toISOString(), data });
  };

  emit('start', { contactId: input.contactId, company: input.company, name: input.name });

  let aiClient = await getAIClientForRole('agent');
  let usingFallback = false;

  const userMessage = `${ENRICHMENT_SYSTEM_PROMPT}

---

Contact to enrich:
- Name: ${input.name}
- Company: ${input.company}
- Job Title: ${input.title ?? 'Unknown'}
- Location: ${input.location ?? 'Unknown'}
- LinkedIn URL: ${input.linkedinUrl}
${input.officeAddress ? `- Known Office Address: ${input.officeAddress}` : ''}

Begin by determining the company domain, then follow the workflow above. Submit all findings using submit_enrichment.`;

  const messages: Message[] = [{ role: 'user', content: userMessage }];

  let iteration = 0;
  let enrichmentData: EnrichmentResult | null = null;

  const isRateLimit = (err: unknown): boolean => {
    const msg = (err as Error)?.message ?? '';
    return msg.includes('Too many tokens') || msg.includes('ThrottlingException') || msg.includes('rate limit');
  };

  while (iteration < MAX_ITERATIONS && !enrichmentData) {
    iteration++;
    emit('step', { iteration, maxIterations: MAX_ITERATIONS });

    let response;
    try {
      response = await aiClient.callModel(messages, ENRICHMENT_TOOLS);
    } catch (err) {
      if (isRateLimit(err) && !usingFallback) {
        usingFallback = true;
        aiClient = createAIClient('openai', 'gpt-4o');
        emit('step', { iteration, note: 'Rate limited — switching to fallback provider' });
        try {
          response = await aiClient.callModel(messages, ENRICHMENT_TOOLS);
        } catch (fallbackErr) {
          emit('error', { message: (fallbackErr as Error).message });
          break;
        }
      } else {
        emit('error', { message: (err as Error).message });
        break;
      }
    }

    if (!response) break;

    // Log any thinking text
    const textBlocks = response.content.filter((b): b is TextBlock => b.type === 'text');
    if (textBlocks.length > 0) {
      emit('step', { iteration, thinking: textBlocks.map(b => b.text).join('\n') });
    }

    if (response.stop_reason === 'end_turn') {
      // Nudge it to use tools
      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: 'Please use the tools to gather company data and submit with submit_enrichment.' });
      continue;
    }

    if (response.stop_reason === 'max_tokens') {
      emit('error', { message: 'Hit token limit during enrichment' });
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      const toolResults: ToolResultBlock[] = [];

      for (const toolUse of toolUses) {
        emit('tool_call', { tool: toolUse.name, input: toolUse.input });

        const { result, enrichmentData: submitted } = await executeEnrichmentTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
        );

        if (submitted) {
          enrichmentData = submitted;
          emit('tool_result', { tool: toolUse.name, success: true, summary: 'Enrichment complete' });
        } else {
          emit('tool_result', { tool: toolUse.name, success: result.success as boolean, summary: result.summary ?? result.error });
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result),
        });
      }

      messages.push({ role: 'assistant', content: response.content });
      messages.push({ role: 'user', content: toolResults as unknown as Message['content'] });
    }
  }

  emit('complete', { found: !!enrichmentData, iterations: iteration, result: enrichmentData ?? {} });

  return enrichmentData;
}
