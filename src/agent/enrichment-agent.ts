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
import { fetchCompanyLogo, fetchBrandfetch, fetchLogoDev, searchExaAI, searchExaPerson, fetchBrightDataLinkedIn, fetchBrightDataCompany, enrichWithPDL, validateLogoUrl, scrapeWithFirecrawl, getVetricProfile, getVetricExperience, searchVetricPosts } from './services';
import axios, { type AxiosError } from 'axios';
import { appLog } from '@/lib/app-log';
import { isPlaceholderUrl } from '@/lib/photo-finder/detect-placeholder';

// ─── Types ───────────────────────────────────────────────

export interface EnrichmentInput {
  contactId: string;
  name: string;
  company: string;
  linkedinUrl: string;
  title?: string;
  location?: string;
  officeAddress?: string;
  csvRowData?: string;
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
    name: 'vetric_profile',
    description: 'Get a LinkedIn profile via Vetric API (live, real-time). This is the PRIMARY source for any person\'s current employer, title, photo, and headline. Returns: first_name, last_name, headline, profile_picture (800×800 headshot), location, connections, top_position (current company name + logo + start date). Use this FIRST for the main contact and for EVERY team member candidate — it is ground truth for verifying current employment. Pass either a full LinkedIn URL or just the username slug (e.g. "jamesdurkin").',
    input_schema: {
      type: 'object' as const,
      properties: {
        linkedin_url: { type: 'string', description: 'LinkedIn profile URL (https://www.linkedin.com/in/username) or just the username slug' },
      },
      required: ['linkedin_url'],
    },
  },
  {
    name: 'vetric_experience',
    description: 'Get a person\'s full work history via Vetric API (live, real-time). Returns array of companies with positions, dates, descriptions. Use this to verify current employment when top_position from vetric_profile isn\'t sufficient, or to check if someone recently left a company. Each entry has company name, logo, positions with start/end dates and is_current flag.',
    input_schema: {
      type: 'object' as const,
      properties: {
        linkedin_url: { type: 'string', description: 'LinkedIn profile URL or username slug' },
      },
      required: ['linkedin_url'],
    },
  },
  {
    name: 'vetric_search_posts',
    description: 'Search LinkedIn posts via Vetric API (live, real-time). Returns posts with FULL AUTHOR DATA: name, occupation (current title), image_url (profile photo), profile URL, public_identifier. This is how you DISCOVER team members — search for "{company name} recruiting hiring" or "{company name} talent acquisition" to find recruiters who post about the company. Each author result gives you their photo and LinkedIn slug for verification. Use datePosted="month" to get recent posters who are likely still at the company.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keywords: { type: 'string', description: 'Search keywords, e.g. "GitLab recruiting hiring" or "Stripe talent acquisition"' },
        sort_by: { type: 'string', enum: ['latest', 'top'], description: 'Sort order (default: latest)' },
        date_posted: { type: 'string', enum: ['day', 'week', 'month'], description: 'Filter by recency (default: no filter). Use "month" for team discovery.' },
        from_organization: { type: 'string', description: 'Filter by company org ID (get from vetric_search_posts or search_web). Optional.' },
      },
      required: ['keywords'],
    },
  },
  {
    name: 'scrape_linkedin_profile',
    description: 'Scrape a LinkedIn profile via Bright Data to get a headshot photo URL. Use this ONLY as a LAST RESORT fallback when vetric_profile returned no profile_picture for a verified team member. vetric_profile already returns 800×800 photos — only use this if Vetric\'s photo was null or a placeholder.',
    input_schema: {
      type: 'object' as const,
      properties: {
        linkedin_url: { type: 'string', description: 'Full LinkedIn profile URL, e.g. https://www.linkedin.com/in/username' },
      },
      required: ['linkedin_url'],
    },
  },
  {
    name: 'scrape_linkedin_company',
    description: 'Scrape a LinkedIn company page via Bright Data. Returns logo URL, office locations, and up to 4 featured employees with photos. Use this as a FALLBACK for company data when Vetric profile top_position doesn\'t give enough company info, or when you need the company logo and fetch_company_logo failed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        company_url: { type: 'string', description: 'LinkedIn company URL, e.g. https://www.linkedin.com/company/stripe' },
      },
      required: ['company_url'],
    },
  },
  {
    name: 'fetch_company_logo',
    description: 'Fetch company logo from Brandfetch (high-quality SVG/PNG brand assets). Use this to get a crisp logo for the postcard — Brandfetch logos are higher quality than LinkedIn CDN logos. Falls back to Hunter.io and Logo.dev.',
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Company domain (e.g. "stripe.com", "gitlab.com")' },
      },
      required: ['domain'],
    },
  },
  {
    name: 'search_web',
    description: 'Search the web using Exa AI. Use for finding company values, mission statement, office locations, careers pages, and open roles. Also use for company-level data since Vetric has no company endpoint. For team member discovery, prefer vetric_search_posts first — only use Exa as fallback.',
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
    description: 'Search for people on LinkedIn using Exa AI people search. Returns LinkedIn profile URLs with names/titles. Use as a FALLBACK when vetric_search_posts doesn\'t find enough team member candidates. Exa data may be weeks old — always verify results with vetric_profile before including anyone.',
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
    description: 'Fetch and read the contents of a URL. Use to scrape company careers page, about page, or values page for roles and values data.',
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
          description: 'Photo URLs of Talent/Recruiting team members at the company (aim for 4 people). Prioritize Talent Acquisition, Recruiters, Head of People, etc. Each must be a direct URL to a headshot.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              photo_url: { type: 'string' },
              title: { type: 'string' },
              linkedin_url: { type: 'string', description: 'LinkedIn profile URL of this team member' },
            },
            required: ['name', 'photo_url', 'linkedin_url'],
          },
        },
      },
      required: ['company_name'],
    },
  },
];

// ─── System Prompt ───────────────────────────────────────

const ENRICHMENT_SYSTEM_PROMPT = `You are a company data enrichment specialist. Your job is to collect accurate, current data about a contact's company for a physical postcard.

## GROUND TRUTH PRINCIPLE
Vetric API tools (vetric_profile, vetric_experience, vetric_search_posts) return LIVE, real-time LinkedIn data. This is your ground truth. Never override what Vetric tells you based on Exa, Bright Data, PDL, or any other source — those are fallbacks only for filling gaps, not for making decisions about who works where or what their title is.

## WHAT YOU ARE COLLECTING
1. **Company logo** — High-quality brand logo for the postcard
2. **Top 3 open roles** — Highest-level current US roles to display on the postcard
3. **Company values** — 3-6 core values from their website
4. **Company mission** — 1-2 sentence mission statement
5. **Office locations** — Cities/regions where the company has offices
6. **Team photos** — 2-4 people from the Talent/Recruiting/People team, confirmed currently at the company via Vetric, with real headshot photos

## TEAM MEMBER SELECTION RULES
**RELEVANCE PRIORITY (most to least relevant):**
1. Talent Acquisition / Recruiting team members (TA, Recruiter, Recruiting Manager, Talent Partner)
2. HR leadership (Head of People, VP People, HR Director, CHRO)
3. People in the same city/location as the contact
4. Hiring managers from the contact's department

**NEVER INCLUDE:**
- Investors, board members, advisors
- Sales reps, account executives
- People from different countries than the contact (unless US-based company)
- Anyone not verified as CURRENTLY at the company

**TEAM SIZE:** Aim for 3 people (2-4 acceptable). Quality over quantity.
**PHOTO PREFERENCE:** Strongly prefer people who have profile photos. A team of 3 with photos beats a team of 4 where some lack photos.

## WORKFLOW

### STEP 0 — VERIFY CONTACT'S CURRENT COMPANY (do this FIRST)
Call vetric_profile with the contact's LinkedIn URL.
- Check top_position.company_info.name — this is their CURRENT employer
- If the company differs from what was provided, call vetric_experience to confirm with full work history
- Use the CORRECT current company for ALL subsequent steps
- If Vetric fails, fall back to scrape_linkedin_profile (Bright Data), then search_web as last resort

### STEP 1 — COMPANY DATA
Vetric has no company endpoint, so use search_web (Exa) for company info.
- Search for "[company] about values mission" to find their website
- The contact's vetric_profile may give you the company logo via top_position.company_info.logo (400×400 LinkedIn CDN logo — use as fallback if fetch_company_logo fails)

### STEP 2 — LOGO
Call fetch_company_logo with the company domain. This tries Hunter.io → Brandfetch → Logo.dev.
- If fetch_company_logo fails, use the company logo from vetric_profile top_position.company_info.logo
- If that's also missing, call scrape_linkedin_company for the LinkedIn CDN logo

### STEP 3 — OPEN ROLES
Search for open roles using search_web: "[company] careers jobs site:linkedin.com" or "[company] open positions"
- Pick the 3 highest-level UNIQUE US roles (Director, VP, Staff, Principal, Senior)
- Deduplicate by title — no two roles should be the same title
- Keep titles SHORT (under 40 characters) — e.g. "Sr. Director, Engineering" not "Senior Director of Engineering and Platform Development"
- If search_web finds a careers page URL, use fetch_url to scrape it for more roles

### STEP 4 — VALUES & MISSION
Call search_web for "[company] company values mission" then fetch_url on their about/values page.

### STEP 5 — DISCOVER TEAM MEMBER CANDIDATES (Vetric first)
You need 2-4 people from the Talent/Recruiting/People team who are CURRENTLY at the company.

Call vetric_search_posts with keywords like "[company name] recruiting hiring talent" and date_posted="month".
- Each post result includes the AUTHOR with: name, occupation (current title), image_url (profile photo!), public_identifier (LinkedIn slug)
- Filter authors whose occupation mentions the target company
- Authors who post about recruiting/hiring at the company are likely current employees
- The author's image_url from search results IS their profile photo — you may not need a separate photo fetch

If vetric_search_posts returns few results, try:
1. Different keywords: "[company name] talent acquisition", "[company name] recruiter", "[company name] HR"
2. Fall back to search_people (Exa) — but treat results as UNVERIFIED candidates

### STEP 6 — VERIFY EVERY CANDIDATE (no exceptions)
For each person found in Step 5, call vetric_profile with their LinkedIn slug or URL.
- Check top_position.company_info.name — if it does NOT match the target company → DISCARD THEM
- If unclear, call vetric_experience to check full work history for is_current positions
- Use the current title from vetric_profile headline — not what the search returned
- Note: vetric_profile returns profile_picture (800×800) — save this for Step 7

### STEP 7 — GET PHOTOS for verified members
vetric_profile already returns profile_picture (800×800 headshot) — use this!
vetric_search_posts author results include image_url (200×200 thumbnail) — also usable.
Only call scrape_linkedin_profile (Bright Data) as a LAST RESORT if Vetric returned no photo.
- If no photo from any source, the person can still be included — submit without photo_url.
- Never use photos from any source other than that person's own LinkedIn profile.

### STEP 8 — SUBMIT
Call submit_enrichment with everything. Partial data is fine — submit what you have.
Use names and titles exactly as they appear on LinkedIn (from Vetric).

## RULES
- Vetric is always the authoritative source for LinkedIn data. Never override it with data from other tools.
- Never include a team member you have not personally verified via vetric_profile in Step 6.
- If you can only find 2 verified members, submit 2 — never pad with unverified people.
- Never invent names, titles, or photos.
- You have a max of 22 tool calls. Be efficient — don't repeat searches.
- When submitting team_photos, always include the linkedin_url so photos can be refreshed later.`;

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
      const scraped = await scrapeWithFirecrawl(args.url as string);
      return { result: scraped };
    }

    case 'vetric_profile': {
      const res = await getVetricProfile(args.linkedin_url as string);
      return { result: { success: res.success, data: res.data, summary: res.summary } };
    }

    case 'vetric_experience': {
      const res = await getVetricExperience(args.linkedin_url as string);
      return { result: { success: res.success, data: res.data, summary: res.summary } };
    }

    case 'vetric_search_posts': {
      const res = await searchVetricPosts(
        args.keywords as string,
        (args.sort_by as 'latest' | 'top' | undefined) ?? 'latest',
        args.date_posted as 'day' | 'week' | 'month' | undefined,
        args.from_organization as string | undefined,
      );
      return { result: { success: res.success, data: res.data, summary: res.summary } };
    }

    case 'scrape_linkedin_profile': {
      // Try Vetric first for photo, fall back to Bright Data
      const linkedinUrl = args.linkedin_url as string;
      try {
        const vetricRes = await getVetricProfile(linkedinUrl);
        if (vetricRes.success && vetricRes.data) {
          const d = vetricRes.data as Record<string, unknown>;
          const photo = d.profile_picture as string | undefined;
          const name = `${d.first_name ?? ''} ${d.last_name ?? ''}`.trim();
          const title = d.headline as string | undefined;
          if (photo && !isPlaceholderUrl(photo)) {
            return {
              result: {
                success: true,
                name,
                title,
                photo_url: photo,
                summary: `Got photo for ${name}: ${photo}`,
              },
            };
          }
        }
      } catch { /* Vetric failed, try Bright Data */ }

      try {
        const profile = await fetchBrightDataLinkedIn(linkedinUrl);
        if (!profile) {
          return { result: { success: false, summary: 'Could not scrape LinkedIn profile — timeout or not found' } };
        }
        let avatar = (profile as Record<string, unknown>).avatar as string | undefined;
        if (avatar && isPlaceholderUrl(avatar)) avatar = undefined;
        const name = profile.name;
        const title = profile.current_company_position ?? profile.headline;

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

    case 'scrape_linkedin_company': {
      const companyUrl = args.company_url as string;
      try {
        const companyData = await fetchBrightDataCompany(companyUrl);
        if (!companyData) {
          return { result: { success: false, summary: 'Could not scrape LinkedIn company page — timeout or not found' } };
        }

        // Validate logo if present
        let logo = companyData.logo ?? null;
        if (logo) {
          const validation = await validateLogoUrl(logo);
          if (!validation.valid) {
            logo = null;
          }
        }

        // Filter featured employees to only those with photos
        const featuredEmployees = (companyData.employees ?? [])
          .filter(e => e.img && e.img.trim() !== '')
          .slice(0, 4)
          .map(e => ({ name: e.name, title: e.title, linkedin_url: e.link, photo_url: e.img }));

        return {
          result: {
            success: true,
            company_name: companyData.name ?? null,
            logo,
            website: companyData.website ?? null,
            about: companyData.about?.slice(0, 500) ?? null,
            headquarters: companyData.headquarters ?? null,
            company_size: companyData.company_size ?? null,
            industries: companyData.industries ?? [],
            specialties: companyData.specialties ?? [],
            office_locations: companyData.formatted_locations ?? companyData.locations ?? [],
            featured_employees: featuredEmployees,
            founded: companyData.founded ?? null,
            summary: `Company page scraped: ${companyData.name ?? companyUrl}${logo ? ' (logo found)' : ' (no logo)'}${(companyData.formatted_locations ?? []).length > 0 ? `, ${(companyData.formatted_locations ?? []).length} office location(s)` : ''}${featuredEmployees.length > 0 ? `, ${featuredEmployees.length} featured employee(s) with photos` : ''}`,
          },
        };
      } catch (err) {
        return { result: { success: false, summary: `LinkedIn company scrape failed: ${(err as Error).message}` } };
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

  const today = new Date().toISOString().split('T')[0];
  const csvBlock = input.csvRowData
    ? `\n\nUPLOADED CSV DATA (may contain useful context — verify before relying on it):\n${input.csvRowData}`
    : '';

  const userMessage = `${ENRICHMENT_SYSTEM_PROMPT}

---

Today's date: ${today}

Contact to enrich:
- Name: ${input.name}
- Company: ${input.company}
- Job Title: ${input.title ?? 'Unknown'}
- Location: ${input.location ?? 'Unknown'}
- LinkedIn URL: ${input.linkedinUrl}
${input.officeAddress ? `- Known Office Address: ${input.officeAddress}` : ''}${csvBlock}

IMPORTANT: Before enriching, verify this person CURRENTLY works at "${input.company}" as of ${today}. Scrape their LinkedIn profile first. If the company appears outdated or incorrect, use the CORRECT current company for all enrichment.

Begin by scraping the LinkedIn profile to verify the current company, then determine the company domain and follow the workflow above. Submit all findings using submit_enrichment.`;

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
