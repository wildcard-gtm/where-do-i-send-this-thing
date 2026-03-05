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
import { fetchCompanyLogo, fetchBrandfetch, fetchLogoDev, searchExaAI, searchExaPerson, fetchBrightDataLinkedIn, enrichWithPDL } from './services';
import axios, { type AxiosError } from 'axios';
import { appLog } from '@/lib/app-log';

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
  linkedinUrl?: string;
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
    description: 'Fetch company logo and brand data. Tries Hunter.io first (free, fast), then Brandfetch as fallback (also returns brand colors and description). Always call this before scraping.',
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
    name: 'search_people',
    description: 'Search for people at a company using Exa AI people search. Returns LinkedIn profile URLs. Use this to find Talent Acquisition / Recruiting / People team members at the company. More targeted than search_web for finding specific people.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query, e.g. "Talent Acquisition Stripe" or "Head of Recruiting Uber"' },
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
    name: 'scrape_linkedin_profile',
    description: 'Scrape a LinkedIn profile URL via Bright Data to get the person\'s real headshot (avatar), name, and title. Use this to get team member photos — it returns a reliable photo URL unlike scraping web pages. Call with individual LinkedIn profile URLs found via search_web.',
    input_schema: {
      type: 'object' as const,
      properties: {
        linkedin_url: { type: 'string', description: 'Full LinkedIn profile URL, e.g. https://www.linkedin.com/in/username' },
      },
      required: ['linkedin_url'],
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
          description: 'Photo URLs of Talent/Recruiting team members at the company (aim for 4 people). Prioritize Talent Acquisition, Recruiters, Head of People, etc. Each must be a direct URL to a headshot.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              photo_url: { type: 'string' },
              title: { type: 'string' },
              linkedin_url: { type: 'string', description: 'LinkedIn profile URL of this team member' },
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

1. **Company logo** — Call fetch_company_logo with the company domain. It tries Hunter.io first (fast/free), then Brandfetch (may also return brand colors and company description). If both fail, use fetch_url on the company homepage and look for logo image tags in the HTML.
2. **Top 3 open roles** — Find the 3 highest-level open positions (prioritize Director, VP, Staff, Principal, Senior roles). Include the location for each role. These should come from actual job postings.
3. **Company values** — Find 3-6 core company values from their website or about page.
4. **Company mission** — Find the mission statement (1-2 sentences) from their website.
5. **Office locations** — Find cities/regions where the company has offices.
6. **Team photos** — Find up to 4 photos of people on the **Talent / People / Recruiting team** at the same company. Prioritize people with titles like: Talent Acquisition, TA, Head of Talent, VP of People, Recruiting Manager, Recruiter, Chief People Officer, People Operations, Head of Recruiting, Talent Partner. Do NOT default to random executives (CEO, CTO, CFO) — we want the target person's colleagues on the talent/recruiting team. Each photo must be a direct URL to a headshot. Aim for 4 people. If you find fewer than 4, submit what you have.

WORKFLOW:
1. First, determine the company domain from the company name (e.g. "Stripe" → "stripe.com")
2. Call fetch_company_logo with that domain
3. Use search_web to find: "[company] open jobs careers", "[company] company values mission", "[company] office locations"
4. Use fetch_url to scrape the careers page and about/values page directly if search_web gives you URLs
5. Use search_people to find Talent/Recruiting team members at [company] — search for "Talent Acquisition [company]" or "Recruiter [company]" or "Head of People [company]". This uses Exa AI people search which is optimized for finding people on LinkedIn.
6. If search_people doesn't find enough results, fall back to search_web with "site:linkedin.com/in [company name] Talent Acquisition OR Recruiter OR Head of People OR TA"
7. For each LinkedIn profile URL found (up to 4), call scrape_linkedin_profile to get their real headshot (avatar URL). This is the ONLY reliable way to get real photo URLs. IMPORTANT: When submitting team_photos, include the linkedin_url for each person so we can link back to their profile.
8. Call submit_enrichment with everything you found — include whatever you have, even if some fields are missing

Be efficient — you have a max of 18 tool calls. Don't repeat searches. Prioritize quality over quantity.
If you can't find certain data, submit what you have with null for missing fields.
Never make up data. Only include what you actually found.`;

// ─── Tool Executor ───────────────────────────────────────

async function executeEnrichmentTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ result: Record<string, unknown>; enrichmentData?: EnrichmentResult }> {
  switch (toolName) {
    case 'fetch_company_logo': {
      const domain = args.domain as string;
      // 1. Hunter.io — primary (free, unlimited)
      const hunterRes = await fetchCompanyLogo(domain);
      if (hunterRes.success) {
        return { result: { success: true, data: hunterRes.data, summary: hunterRes.summary, source: 'hunter' } };
      }
      // 2. Brandfetch — secondary fallback (also provides colors + description)
      const brandRes = await fetchBrandfetch(domain);
      if (brandRes.success) {
        return { result: { success: true, data: brandRes.data, summary: brandRes.summary, source: 'brandfetch' } };
      }
      // 3. Logo.dev — tertiary fallback (simple image URL)
      const logoDevRes = await fetchLogoDev(domain);
      if (logoDevRes.success) {
        return { result: { success: true, data: logoDevRes.data, summary: logoDevRes.summary, source: 'logodev' } };
      }
      // All failed
      return { result: { success: false, summary: `Logo not found via Hunter.io (${hunterRes.summary}), Brandfetch (${brandRes.summary}), or Logo.dev (${logoDevRes.summary}). Try fetching the company website directly.` } };
    }

    case 'search_web': {
      const res = await searchExaAI(
        args.query as string,
        'auto',
        (args.num_results as number | undefined) ?? 5,
      );
      return { result: { success: res.success, data: res.data, summary: res.summary } };
    }

    case 'search_people': {
      const query = args.query as string;
      const numResults = (args.num_results as number | undefined) ?? 5;
      // Use Exa AI people-specific search with LinkedIn domain filtering
      const res = await searchExaPerson(query, '', numResults);
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

    case 'scrape_linkedin_profile': {
      const linkedinUrl = args.linkedin_url as string;
      try {
        const profile = await fetchBrightDataLinkedIn(linkedinUrl);
        if (!profile) {
          return { result: { success: false, summary: 'Could not scrape LinkedIn profile — timeout or not found' } };
        }
        let avatar = (profile as Record<string, unknown>).avatar as string | undefined;
        const name = profile.name;
        const title = profile.current_company_position ?? profile.headline;

        // PDL fallback for photo
        if (!avatar) {
          try {
            const pdl = await enrichWithPDL(linkedinUrl);
            if (pdl.success && pdl.data) {
              const pic = (pdl.data as Record<string, unknown>).profile_pic_url as string | undefined;
              if (pic) avatar = pic;
            }
          } catch { /* continue */ }
        }

        // Exa → Bright Data fallback for photo
        if (!avatar && name) {
          const company = profile.current_company_name ?? '';
          try {
            const exa = await searchExaPerson(name, company, 3);
            if (exa.success && Array.isArray(exa.data)) {
              for (const r of exa.data as Array<{ url?: string }>) {
                if (!r.url?.includes('linkedin.com/in/')) continue;
                if (r.url === linkedinUrl) continue;
                try {
                  const p = await fetchBrightDataLinkedIn(r.url);
                  const a = p ? (p as Record<string, unknown>).avatar as string | undefined : undefined;
                  if (a) { avatar = a; break; }
                } catch { continue; }
              }
            }
          } catch { /* exhausted */ }
        }

        return {
          result: {
            success: true,
            name,
            title,
            photo_url: avatar ?? null,
            summary: avatar
              ? `Got photo for ${name ?? 'person'}: ${avatar}`
              : `Profile scraped but no photo found for ${name ?? 'person'}`,
          },
        };
      } catch (err) {
        return { result: { success: false, summary: `LinkedIn scrape failed: ${(err as Error).message}` } };
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
          ? (args.team_photos as Array<{ name?: string; photo_url: string; title?: string; linkedin_url?: string }>).map(p => ({
              name: p.name,
              photoUrl: p.photo_url,
              title: p.title,
              linkedinUrl: p.linkedin_url,
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

const MAX_ITERATIONS = 22; // extra room for up to 4 scrape_linkedin_profile calls

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
        aiClient = await getAIClientForRole('fallback');
        emit('step', { iteration, note: 'Rate limited — switching to fallback provider' });
        appLog('warn', 'bedrock', 'rate_limit', `Bedrock rate limited during enrichment for ${input.name}, switching to fallback`, { contactId: input.contactId, error: (err as Error).message }).catch(() => {});
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
