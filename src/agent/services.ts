/**
 * API service functions for each data source.
 * Each function returns a standardized ToolResult.
 */

import axios, { type AxiosError } from 'axios';
import type {
  ToolResult,
  LinkedInProfile,
  EndatoPerson,
  EndatoEmail,
  ExaSearchResponse,
  DistanceMatrixResponse,
} from './types';
import { appLog } from '@/lib/app-log';
import { isPlaceholderUrl } from '@/lib/photo-finder/detect-placeholder';

const TIMEOUT = 30_000;
const MAX_TEXT_PER_RESULT = 1500; // Truncate Exa text to avoid burning context

// ─── Vetric API — LinkedIn Live Data (Primary) ────────────

const VETRIC_BASE = 'https://api.vetric.io/linkedin/v1';

function getVetricHeaders(): Record<string, string> {
  const apiKey = process.env.LI_API_KEY;
  return {
    'x-api-key': apiKey ?? '',
    'accept': 'application/json',
  };
}

/**
 * Extract LinkedIn username slug from a full URL or return as-is if already a slug.
 */
function extractLinkedInSlug(urlOrSlug: string): string {
  if (urlOrSlug.includes('linkedin.com/in/')) {
    return urlOrSlug.replace(/^.*linkedin\.com\/in\//, '').replace(/[/?#].*$/, '').trim();
  }
  return urlOrSlug.trim();
}

/**
 * Get a person's full LinkedIn profile via Vetric API.
 * Returns: name, headline, photo (800×800), location, connections, top_position (company + logo), etc.
 */
export async function getVetricProfile(linkedinUrlOrSlug: string): Promise<ToolResult> {
  const slug = extractLinkedInSlug(linkedinUrlOrSlug);
  if (!slug) return { success: false, summary: 'Vetric: no LinkedIn slug provided' };
  if (!process.env.LI_API_KEY) return { success: false, summary: 'LI_API_KEY not configured' };

  try {
    const res = await axios.get(`${VETRIC_BASE}/profile/${slug}`, {
      headers: getVetricHeaders(),
      timeout: TIMEOUT,
    });
    const d = res.data;
    if (d?.message === 'Entity Not Found') {
      return { success: false, summary: `Vetric: profile not found for "${slug}"` };
    }
    appLog('info', 'vetric', 'profile', `Vetric profile: ${d.first_name} ${d.last_name} — ${d.headline}`, { slug }).catch(() => {});
    return {
      success: true,
      data: d,
      summary: `Vetric profile: ${d.first_name} ${d.last_name} | ${d.headline} | ${d.location?.name ?? 'unknown location'}`,
    };
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    appLog('error', 'vetric', 'profile', `Vetric profile failed for "${slug}": ${(err as Error).message}`, { slug }).catch(() => {});
    return { success: false, summary: `Vetric profile failed${status ? ` (HTTP ${status})` : ''}: ${(err as Error).message}` };
  }
}

/**
 * Get a person's full work history via Vetric API.
 * Returns: array of companies with positions, dates, descriptions.
 */
export async function getVetricExperience(linkedinUrlOrSlug: string): Promise<ToolResult> {
  const slug = extractLinkedInSlug(linkedinUrlOrSlug);
  if (!slug) return { success: false, summary: 'Vetric: no LinkedIn slug provided' };
  if (!process.env.LI_API_KEY) return { success: false, summary: 'LI_API_KEY not configured' };

  try {
    const res = await axios.get(`${VETRIC_BASE}/profile/${slug}/experience`, {
      headers: getVetricHeaders(),
      timeout: TIMEOUT,
    });
    appLog('info', 'vetric', 'experience', `Vetric experience: ${slug}`, { slug }).catch(() => {});
    return {
      success: true,
      data: res.data,
      summary: `Vetric experience for ${slug}: ${(res.data?.experience ?? []).length} positions`,
    };
  } catch (err) {
    return { success: false, summary: `Vetric experience failed: ${(err as Error).message}` };
  }
}

/**
 * Search LinkedIn posts via Vetric API.
 * Useful for finding team members at a company (search "{company} recruiting hiring").
 * Returns posts with full author data: name, title (occupation), photo URL, profile URL.
 */
export async function searchVetricPosts(
  keywords: string,
  sortBy: 'latest' | 'top' = 'latest',
  datePosted?: 'day' | 'week' | 'month',
  fromOrganization?: string,
): Promise<ToolResult> {
  if (!process.env.LI_API_KEY) return { success: false, summary: 'LI_API_KEY not configured' };

  try {
    const params: Record<string, string> = { keywords, sortBy };
    if (datePosted) params.datePosted = datePosted;
    if (fromOrganization) params.fromOrganization = fromOrganization;

    const res = await axios.get(`${VETRIC_BASE}/search/posts`, {
      headers: getVetricHeaders(),
      params,
      timeout: TIMEOUT,
    });
    const posts = res.data?.posts ?? [];
    appLog('info', 'vetric', 'search_posts', `Vetric post search: "${keywords}" — ${posts.length} results`, { keywords, total: res.data?.total_matches }).catch(() => {});
    return {
      success: true,
      data: { posts, total_matches: res.data?.total_matches, cursor: res.data?.cursor },
      summary: `Found ${res.data?.total_matches ?? posts.length} posts for "${keywords}"`,
    };
  } catch (err) {
    return { success: false, summary: `Vetric post search failed: ${(err as Error).message}` };
  }
}

/**
 * Search LinkedIn mentions via Vetric API.
 * Returns company/member URN entities. Useful for resolving company org IDs.
 */
export async function searchVetricMentions(keywords: string): Promise<ToolResult> {
  if (!process.env.LI_API_KEY) return { success: false, summary: 'LI_API_KEY not configured' };

  try {
    const res = await axios.get(`${VETRIC_BASE}/search/mentions`, {
      headers: getVetricHeaders(),
      params: { keywords },
      timeout: TIMEOUT,
    });
    const results = Array.isArray(res.data) ? res.data : [];
    return {
      success: true,
      data: results,
      summary: `Found ${results.length} mention(s) for "${keywords}"`,
    };
  } catch (err) {
    return { success: false, summary: `Vetric mentions failed: ${(err as Error).message}` };
  }
}

// ─── LinkedIn MCP Server (Legacy — kept as fallback) ──────

const LINKEDIN_MCP_URL = process.env.LINKEDIN_MCP_URL ?? 'http://5.9.70.211:7777/mcp';
const LINKEDIN_MCP_API_KEY = process.env.LINKEDIN_MCP_API_KEY ?? 'bWcwEc_cI91Dc1DMLJY_Ljyl1ITjaZC_KxEqoCUBM08';

/**
 * Call a tool on the LinkedIn MCP server (streamable-http transport).
 * Handles session initialization + tool invocation in sequence.
 */
export async function callLinkedInMCP(
  toolName: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    // Common auth header
    const authHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(LINKEDIN_MCP_API_KEY ? { Authorization: `Bearer ${LINKEDIN_MCP_API_KEY}` } : {}),
    };

    // Step 1: Initialize session
    const initRes = await axios.post(
      LINKEDIN_MCP_URL,
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'wdistt-agent', version: '1.0' },
        },
      },
      {
        headers: authHeaders,
        timeout: TIMEOUT,
        // Response is SSE — parse the session ID from headers
        responseType: 'text',
      },
    );

    // Extract session ID from response headers
    const sessionId = initRes.headers['mcp-session-id'] as string | undefined;
    if (!sessionId) {
      return { success: false, summary: 'LinkedIn MCP: failed to get session ID' };
    }

    // Step 2: Send initialized notification
    await axios.post(
      LINKEDIN_MCP_URL,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      {
        headers: { ...authHeaders, 'Mcp-Session-Id': sessionId },
        timeout: 10_000,
        validateStatus: () => true,
      },
    );

    // Step 3: Call the tool
    const toolRes = await axios.post(
      LINKEDIN_MCP_URL,
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      },
      {
        headers: { ...authHeaders, 'Mcp-Session-Id': sessionId },
        timeout: 60_000, // LinkedIn scraping can be slow
        responseType: 'text',
      },
    );

    // Parse SSE response — extract the JSON data line
    const raw = typeof toolRes.data === 'string' ? toolRes.data : JSON.stringify(toolRes.data);
    let result: unknown;
    const dataMatch = raw.match(/^data:\s*(.+)$/m);
    if (dataMatch) {
      const parsed = JSON.parse(dataMatch[1]);
      result = parsed.result ?? parsed;
    } else {
      // Try parsing as plain JSON
      const parsed = JSON.parse(raw);
      result = parsed.result ?? parsed;
    }

    appLog('info', 'linkedin_mcp', toolName, `LinkedIn MCP ${toolName} succeeded`, { toolName, args }).catch(() => {});

    // MCP tool results have content array with text parts
    const content = (result as Record<string, unknown>)?.content;
    if (Array.isArray(content)) {
      const textParts = content
        .filter((c: Record<string, unknown>) => c.type === 'text')
        .map((c: Record<string, unknown>) => c.text as string);
      const combined = textParts.join('\n');

      // Try to parse as JSON for structured data
      try {
        const data = JSON.parse(combined);
        return {
          success: true,
          data,
          summary: `LinkedIn MCP ${toolName}: data retrieved`,
        };
      } catch {
        return {
          success: true,
          data: { text: combined.slice(0, 8000) },
          summary: `LinkedIn MCP ${toolName}: ${combined.slice(0, 200)}`,
        };
      }
    }

    return {
      success: true,
      data: result,
      summary: `LinkedIn MCP ${toolName}: response received`,
    };
  } catch (err) {
    const axErr = err as AxiosError;
    const status = axErr.response?.status;
    const detail = status ? ` (HTTP ${status})` : '';
    appLog('error', 'linkedin_mcp', toolName, `LinkedIn MCP call failed${detail}: ${(err as Error).message}`, { toolName, args }).catch(() => {});
    return { success: false, summary: `LinkedIn MCP ${toolName} failed${detail}: ${(err as Error).message}` };
  }
}

/**
 * Extract LinkedIn username slug from a full URL or return as-is if already a slug.
 */
function extractLinkedInUsername(urlOrUsername: string): string {
  return urlOrUsername.includes('linkedin.com/in/')
    ? urlOrUsername.replace(/^.*linkedin\.com\/in\//, '').replace(/\/$/, '').split('?')[0]
    : urlOrUsername;
}

/**
 * Extract LinkedIn company slug from a full URL or return as-is if already a slug.
 */
function extractLinkedInCompanySlug(urlOrSlug: string): string {
  return urlOrSlug.includes('linkedin.com/company/')
    ? urlOrSlug.replace(/^.*linkedin\.com\/company\//, '').replace(/\/$/, '').split('?')[0]
    : urlOrSlug;
}

/**
 * Get a person's LinkedIn profile via the MCP server.
 * Accepts a full LinkedIn URL (https://linkedin.com/in/username) or just the username slug.
 * The MCP requires `linkedin_username` (slug only), not the full URL.
 * Optional sections: "experience", "education", "contact_info", "posts", "honors", "languages"
 */
export async function getLinkedInProfileViaMCP(linkedinUrlOrUsername: string, sections?: string): Promise<ToolResult> {
  const username = extractLinkedInUsername(linkedinUrlOrUsername);
  const args: Record<string, unknown> = { linkedin_username: username };
  if (sections) args.sections = sections;
  return callLinkedInMCP('get_person_profile', args);
}

/**
 * Get a company's LinkedIn profile via the MCP server.
 * Accepts a full LinkedIn company URL or just the slug.
 * The MCP requires `company_name` (slug only), not the full URL.
 * Optional sections: "posts", "jobs"
 */
export async function getLinkedInCompanyViaMCP(companyUrlOrSlug: string, sections?: string): Promise<ToolResult> {
  const slug = extractLinkedInCompanySlug(companyUrlOrSlug);
  const args: Record<string, unknown> = { company_name: slug };
  if (sections) args.sections = sections;
  return callLinkedInMCP('get_company_profile', args);
}

/**
 * Search for people on LinkedIn via the MCP server.
 * Note: returns a search URL with section text — parse the text to extract names/titles/URLs.
 */
export async function searchLinkedInPeopleViaMCP(keywords: string, location?: string): Promise<ToolResult> {
  const args: Record<string, unknown> = { keywords };
  if (location) args.location = location;
  return callLinkedInMCP('search_people', args);
}

/**
 * Search for jobs on LinkedIn via the MCP server.
 */
export async function searchLinkedInJobsViaMCP(keywords: string, location?: string): Promise<ToolResult> {
  const args: Record<string, unknown> = { keywords };
  if (location) args.location = location;
  return callLinkedInMCP('search_jobs', args);
}

// ─── People Data Labs (PDL) Enrichment ───────────────────

export async function enrichWithPDL(linkedinUrl: string): Promise<ToolResult> {
  const apiKey = process.env.PDL_API_KEY;
  if (!apiKey) return { success: false, summary: 'PDL_API_KEY not configured' };

  try {
    const url = new URL('https://api.peopledatalabs.com/v5/person/enrich');
    url.searchParams.set('profile', linkedinUrl);
    url.searchParams.set('min_likelihood', '2');
    url.searchParams.set('titlecase', 'true');

    const res = await axios.get(url.toString(), {
      headers: { 'X-API-Key': apiKey },
      timeout: TIMEOUT,
    });

    const d = res.data;
    if (!d || d.status !== 200) {
      return { success: false, summary: `PDL: no record found (status ${d?.status ?? 'unknown'})` };
    }

    const person = d.data;
    const phones: string[] = (person.phone_numbers ?? []).slice(0, 3);
    const emails: string[] = (person.emails ?? []).map((e: { address: string }) => e.address).slice(0, 3);
    const locations: string[] = (person.location_names ?? []).slice(0, 3);
    const jobTitle: string = person.job_title ?? '';
    const company: string = person.job_company_name ?? '';
    const name: string = person.full_name ?? '';

    appLog('info', 'pdl', 'enrich', `PDL enrichment: ${name}${company ? ` at ${company}` : ''}`, { linkedinUrl, name, company }).catch(() => {});
    return {
      success: true,
      data: {
        name,
        jobTitle,
        company,
        phones,
        emails,
        locations,
        linkedinUrl: person.linkedin_url ?? linkedinUrl,
        industry: person.industry ?? '',
        summary: person.summary ?? '',
        profile_pic_url: person.profile_pic_url ?? null,
      },
      summary: `PDL: ${name}${company ? ` at ${company}` : ''}${phones.length ? `, phones: ${phones.join(', ')}` : ''}${emails.length ? `, emails: ${emails.join(', ')}` : ''}`,
    };
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    if (status === 404) return { success: false, summary: 'PDL: person not found' };
    appLog('error', 'pdl', 'enrich', `PDL enrichment failed: ${(err as Error).message}`, { linkedinUrl, error: (err as Error).message }).catch(() => {});
    return { success: false, summary: `PDL error: ${(err as Error).message}` };
  }
}

// ─── Exa Person Search (LinkedIn-specific) ───────────────

export async function searchExaPerson(
  personName: string,
  companyName: string,
  numResults = 5,
): Promise<ToolResult> {
  const apiKey = process.env.EXA_AI_KEY;
  if (!apiKey) return { success: false, summary: 'EXA_AI_KEY not configured' };

  const query = `${personName} ${companyName}`;

  try {
    const res = await axios.post(
      'https://api.exa.ai/search',
      {
        query,
        category: 'people',
        includeDomains: ['linkedin.com'],
        numResults,
      },
      {
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        timeout: TIMEOUT,
      },
    );

    const results = (res.data?.results ?? []) as Array<{ title?: string; url?: string; score?: number }>;
    const profiles = results.filter(r => r.url?.includes('linkedin.com/in/'));

    if (profiles.length === 0) {
      return { success: false, summary: `No LinkedIn profiles found for "${query}"` };
    }

    appLog('info', 'exa_ai', 'person_search', `Exa person search: ${profiles.length} profile(s) for "${query}"`, { query, numResults: profiles.length }).catch(() => {});
    return {
      success: true,
      data: profiles.map(r => ({ name: r.title ?? '', url: r.url ?? '', score: r.score })),
      summary: `Found ${profiles.length} LinkedIn profile(s) for "${query}": ${profiles.map(r => r.url).join(', ')}`,
    };
  } catch (err) {
    appLog('error', 'exa_ai', 'person_search', `Exa person search failed: ${(err as Error).message}`, { query, error: (err as Error).message }).catch(() => {});
    return { success: false, summary: `Exa person search error: ${(err as Error).message}` };
  }
}

// ─── Bright Data LinkedIn Enrichment ─────────────────────

const LINKEDIN_DATASET_ID = 'gd_l1viktl72bvl7bjuj0';
const LINKEDIN_COMPANY_DATASET_ID = 'gd_l1vikfnt1wgvvqz95w';

export async function fetchBrightDataLinkedIn(url: string): Promise<LinkedInProfile | null> {
  const apiKey = process.env.BRIGHT_DATA_API_KEY;
  if (!apiKey) return null;

  const trigger = await axios.post(
    `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${LINKEDIN_DATASET_ID}&include_errors=true`,
    [{ url }],
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: TIMEOUT,
    },
  );

  const snapshotId: string | undefined = trigger.data?.snapshot_id;
  if (!snapshotId) return null;

  // Poll for results (up to ~20 seconds)
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await axios.get(
        `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: TIMEOUT },
      );
      if (Array.isArray(res.data) && res.data.length > 0) {
        return res.data[0] as LinkedInProfile;
      }
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status !== 404) return null;
    }
  }
  return null;
}

// ─── Bright Data LinkedIn Company Scraping ────────────────

export interface LinkedInCompanyData {
  name?: string;
  logo?: string;
  website?: string;
  about?: string;
  headquarters?: string;
  company_size?: string;
  employees_in_linkedin?: number;
  industries?: string[];
  specialties?: string[];
  founded?: string;
  locations?: string[];
  formatted_locations?: string[];
  employees?: Array<{ name?: string; link?: string; title?: string; img?: string }>;
}

export async function fetchBrightDataCompany(url: string): Promise<LinkedInCompanyData | null> {
  const apiKey = process.env.BRIGHT_DATA_API_KEY;
  if (!apiKey) return null;

  const trigger = await axios.post(
    `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${LINKEDIN_COMPANY_DATASET_ID}&include_errors=true`,
    [{ url }],
    {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: TIMEOUT,
    },
  );

  const snapshotId: string | undefined = trigger.data?.snapshot_id;
  if (!snapshotId) return null;

  // Poll for results (up to ~20 seconds)
  for (let attempt = 0; attempt < 10; attempt++) {
    await new Promise(r => setTimeout(r, 2000));
    try {
      const res = await axios.get(
        `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
        { headers: { Authorization: `Bearer ${apiKey}` }, timeout: TIMEOUT },
      );
      if (Array.isArray(res.data) && res.data.length > 0) {
        appLog('info', 'bright_data', 'company_scrape', `Company page scraped: ${url}`, { url, hasLogo: !!res.data[0]?.logo }).catch(() => {});
        return res.data[0] as LinkedInCompanyData;
      }
    } catch (err) {
      const status = (err as AxiosError).response?.status;
      if (status !== 404) return null;
    }
  }
  return null;
}

export async function enrichLinkedInProfile(url: string): Promise<ToolResult> {
  const slug = extractLinkedInSlug(url);

  // 1. Try Vetric first (live data, fastest, most reliable)
  const [vetricProfile, vetricExp, pdlResult] = await Promise.allSettled([
    slug ? getVetricProfile(slug) : Promise.resolve({ success: false, summary: 'no slug' } as ToolResult),
    slug ? getVetricExperience(slug) : Promise.resolve({ success: false, summary: 'no slug' } as ToolResult),
    enrichWithPDL(url),
  ]);

  const vetric = vetricProfile.status === 'fulfilled' && vetricProfile.value.success ? vetricProfile.value.data as Record<string, unknown> : null;
  const vetricExpData = vetricExp.status === 'fulfilled' && vetricExp.value.success ? vetricExp.value.data as Record<string, unknown> : null;
  const pdl = pdlResult.status === 'fulfilled' && pdlResult.value.success ? pdlResult.value.data as Record<string, unknown> : null;

  // 2. Fall back to Bright Data + Exa if Vetric fails
  let bdProfile: LinkedInProfile | null = null;
  if (!vetric) {
    try {
      bdProfile = await fetchBrightDataLinkedIn(url);
    } catch { /* continue */ }
  }

  if (!vetric && !bdProfile && !pdl) {
    appLog('error', 'vetric', 'linkedin_enrich', `LinkedIn enrichment failed for ${url} (Vetric + BD + PDL all failed)`, { url }).catch(() => {});
    return { success: false, summary: 'All sources failed — could not retrieve LinkedIn profile data' };
  }

  // Build combined enrichment — Vetric is ground truth, others fill gaps
  const topPos = vetric?.top_position as Record<string, unknown> | undefined;
  const topCompanyInfo = topPos?.company_info as Record<string, unknown> | undefined;

  const name = vetric
    ? `${vetric.first_name ?? ''} ${vetric.last_name ?? ''}`.trim()
    : bdProfile?.name ?? (pdl?.name as string | undefined) ?? 'Unknown';
  const company = topCompanyInfo?.name as string ?? bdProfile?.current_company_name ?? (pdl?.company as string | undefined) ?? 'N/A';
  const position = vetric?.headline as string ?? bdProfile?.current_company_position ?? (pdl?.jobTitle as string | undefined) ?? '';
  const locationObj = vetric?.location as Record<string, unknown> | undefined;
  const city = locationObj?.name as string ?? bdProfile?.city ?? '';
  const state = bdProfile?.state ?? '';

  // Build experience from Vetric or Bright Data
  const experience = vetricExpData
    ? ((vetricExpData.experience ?? []) as Array<Record<string, unknown>>).slice(0, 8).map(e => {
        const positions = (e.positions ?? []) as Array<Record<string, unknown>>;
        const companyObj = e.company as Record<string, unknown> | undefined;
        return positions.map(p => ({
          company: companyObj?.name as string ?? '',
          title: p.role as string ?? '',
          location: p.location as string ?? companyObj?.location as string ?? '',
          start_date: p.start_date ? `${(p.start_date as Record<string, unknown>).year ?? ''}` : '',
          end_date: p.is_current_position ? 'Present' : (p.end_date ? `${(p.end_date as Record<string, unknown>).year ?? ''}` : ''),
          is_current: p.is_current_position as boolean ?? false,
        }));
      }).flat()
    : (bdProfile?.experience ?? []).slice(0, 8).map(e => ({
        company: e.company,
        title: e.title,
        location: e.location,
        start_date: e.start_date,
        end_date: e.end_date,
        is_current: !e.end_date || e.end_date === 'Present',
      }));

  // Avatar: Vetric profile_picture is 800×800, best quality
  const vetricPhoto = vetric?.profile_picture as string | undefined;
  const bdAvatar = (bdProfile as Record<string, unknown> | null)?.avatar as string | undefined;
  const pdlPic = pdl?.profile_pic_url as string | undefined;
  const avatar = (vetricPhoto && !isPlaceholderUrl(vetricPhoto)) ? vetricPhoto
    : (bdAvatar && !isPlaceholderUrl(bdAvatar)) ? bdAvatar
    : (pdlPic && !isPlaceholderUrl(pdlPic)) ? pdlPic
    : undefined;

  // PDL contact points — phones, emails
  const phones: string[] = (pdl?.phones as string[] | undefined) ?? [];
  const emails: string[] = (pdl?.emails as string[] | undefined) ?? [];
  const pdlCompany = pdl?.company as string | undefined;

  const employerMismatch = pdlCompany && company && pdlCompany !== company &&
    !pdlCompany.toLowerCase().includes(company.toLowerCase()) &&
    !company.toLowerCase().includes(pdlCompany.toLowerCase());

  const data = {
    name,
    headline: vetric?.headline as string ?? bdProfile?.headline ?? '',
    company,
    position,
    city,
    state,
    country: (locationObj?.country as Record<string, unknown>)?.name as string ?? bdProfile?.country ?? '',
    about: vetric?.about as string ?? bdProfile?.about?.slice(0, 500) ?? '',
    avatar,
    experience,
    connections: vetric?.connections as number ?? undefined,
    followers: vetric?.followers as number ?? undefined,
    company_logo: topCompanyInfo?.logo as string ?? undefined,
    phones,
    emails,
    pdl_company: pdlCompany,
    employer_discrepancy: employerMismatch
      ? `LinkedIn shows "${company}" but PDL shows "${pdlCompany}" — verify which is current before proceeding`
      : undefined,
    source: vetric ? 'vetric' : bdProfile ? 'bright_data' : 'pdl',
  };

  appLog('info', 'vetric', 'linkedin_enrich', `LinkedIn profile enriched: ${name} at ${company} (via ${data.source})`, { url, source: data.source }).catch(() => {});

  const summaryParts = [`${name}, ${company}, ${city || 'location unknown'}`];
  if (phones.length) summaryParts.push(`phones: ${phones.join(', ')}`);
  if (emails.length) summaryParts.push(`emails: ${emails.join(', ')}`);
  if (employerMismatch) summaryParts.push(`⚠ employer mismatch: LinkedIn="${company}" vs PDL="${pdlCompany}"`);

  return {
    success: true,
    data,
    summary: summaryParts.join(' | '),
  };
}

// ─── WhitePages People Search (primary) ──────────────────

interface WhitepagesCurrentAddress { id: string | null; address: string; }
interface WhitepagesOwnedProperty { id: string; address: string; }
interface WhitepagesPhoneNumber { number: string; type: string; }
interface WhitepagesPerson {
  id?: string | null;
  name: string;
  is_dead: boolean;
  current_addresses: WhitepagesCurrentAddress[];
  owned_properties: WhitepagesOwnedProperty[];
  phones: WhitepagesPhoneNumber[];
  emails: string[];
  date_of_birth?: string | null;
}

async function searchWhitePages(
  name?: string,
  city?: string,
  stateCode?: string,
  phone?: string,
  street?: string,
  zipCode?: string,
): Promise<ToolResult> {
  const apiKey = process.env.WHITEPAGES_API_KEY;
  if (!apiKey) {
    return { success: false, summary: 'WHITEPAGES_API_KEY not configured' };
  }
  if (!name && !phone) {
    return { success: false, summary: 'WhitePages requires name or phone' };
  }

  try {
    const url = new URL('https://api.whitepages.com/v1/person');
    if (name) url.searchParams.set('name', name);
    if (phone) url.searchParams.set('phone', phone.replace(/[^0-9+]/g, ''));
    if (street) url.searchParams.set('street', street);
    if (city) url.searchParams.set('city', city);
    if (stateCode) url.searchParams.set('state_code', stateCode);
    if (zipCode) url.searchParams.set('zip_code', zipCode);

    const res = await axios.get<WhitepagesPerson[]>(url.toString(), {
      headers: { Accept: 'application/json', 'X-Api-Key': apiKey },
      timeout: TIMEOUT,
    });

    const people = res.data ?? [];
    const label = name || phone || 'query';
    if (people.length === 0) {
      return { success: true, data: null, summary: `No WhitePages records found for "${label}"` };
    }

    return {
      success: true,
      data: people.slice(0, 5).map(p => ({
        name: p.name,
        is_dead: p.is_dead,
        date_of_birth: p.date_of_birth,
        current_addresses: p.current_addresses,
        owned_properties: p.owned_properties,
        phones: p.phones.slice(0, 3),
        emails: p.emails.slice(0, 3),
      })),
      summary: `WhitePages: ${people.length} result(s) for "${label}"`,
    };
  } catch (err) {
    const axiosErr = err as AxiosError;
    const status = axiosErr.response?.status;
    const detail = status ? ` (HTTP ${status})` : '';
    return { success: false, summary: `WhitePages search failed${detail}: ${(err as Error).message}` };
  }
}

// ─── Endato (Enformion) People Search (fallback) ─────────

async function searchEndato(
  firstName: string,
  lastName: string,
  middleName?: string,
  city?: string,
  state?: string,
): Promise<ToolResult> {
  const apiName = process.env.ENDATO_API_NAME;
  const apiPassword = process.env.ENDATO_API_PASSWORD;
  if (!apiName || !apiPassword) {
    return { success: false, summary: 'Endato credentials not configured' };
  }

  const body: Record<string, unknown> = {
    FirstName: firstName,
    LastName: lastName,
    Page: 1,
    ResultsPerPage: 10,
  };

  if (middleName) body.MiddleName = middleName;
  if (city || state) {
    const addr: Record<string, string> = {};
    if (city) addr.City = city;
    if (state) addr.StateCode = state;
    body.Addresses = [addr];
  }

  let res;
  try {
    res = await axios.post(
      'https://devapi.enformion.com/PersonSearch',
      body,
      {
        headers: {
          'Content-Type': 'application/json',
          'galaxy-ap-name': apiName,
          'galaxy-ap-password': apiPassword,
          'galaxy-search-type': 'Person',
        },
        timeout: TIMEOUT,
      },
    );
  } catch (err) {
    const axiosErr = err as AxiosError;
    // HTTP 400 often means the city-specific filter returned no results.
    // Retry with state-only (drop the city) if we had a city in the request.
    if (axiosErr.response?.status === 400 && city && state) {
      const bodyStateOnly = { ...body, Addresses: [{ StateCode: state }] };
      res = await axios.post(
        'https://devapi.enformion.com/PersonSearch',
        bodyStateOnly,
        {
          headers: {
            'Content-Type': 'application/json',
            'galaxy-ap-name': apiName,
            'galaxy-ap-password': apiPassword,
            'galaxy-search-type': 'Person',
          },
          timeout: TIMEOUT,
        },
      );
    } else {
      throw err;
    }
  }

  const persons: EndatoPerson[] = res.data?.persons ?? [];
  if (persons.length === 0) {
    return { success: true, data: null, summary: `No Endato records found for ${firstName} ${lastName}` };
  }

  // Return all matched persons (up to 3) so agent can pick the right one by state/age/phone
  const mappedPersons = persons.slice(0, 3).map(person => {
    const addresses = person.addresses ?? [];
    const phones = person.phoneNumbers ?? [];
    const fullName = person.fullName
      ?? [person.name?.firstName, person.name?.middleName, person.name?.lastName].filter(Boolean).join(' ');
    return {
      name: fullName,
      age: person.age,
      isCurrentPropertyOwner: person.isCurrentPropertyOwner,
      currentAddress: addresses[0]?.fullAddress ?? 'Not available',
      addressHistory: addresses.slice(0, 8).map(a => ({
        address: a.fullAddress,
        city: a.city,
        state: a.state,
        zip: a.zip,
        firstReported: a.firstReportedDate,
        lastReported: a.lastReportedDate,
        deliverable: a.isDeliverable,
      })),
      phones: phones.slice(0, 3).map(p => ({
        number: p.phoneNumber,
        type: p.phoneType,
        carrier: p.company,
        connected: p.isConnected,
      })),
      emails: (person.emailAddresses ?? []).slice(0, 3).map((e: EndatoEmail) => e.emailAddress),
    };
  });

  const primary = mappedPersons[0];
  const totalResults = res.data?.counts?.searchResults ?? persons.length;
  const summaryLabel = mappedPersons.length > 1
    ? `Endato: ${mappedPersons.length} persons matched for ${firstName} ${lastName} (showing top ${mappedPersons.length}), age ${primary.age ?? '?'}, ${(persons[0].addresses ?? []).length} address(es)`
    : `Endato: ${primary.name}, age ${primary.age ?? '?'}, ${(persons[0].addresses ?? []).length} address(es)`;

  return {
    success: true,
    data: {
      source: 'endato',
      totalResults,
      persons: mappedPersons,
      // Keep top-level fields pointing at primary match for backwards compatibility
      name: primary.name,
      age: primary.age,
      currentAddress: primary.currentAddress,
      addressHistory: primary.addressHistory,
      phones: primary.phones,
      emails: primary.emails,
    },
    summary: summaryLabel,
  };
}

// ─── Public: Search Person Address (WhitePages + Endato parallel) ─

export async function searchPersonAddress(
  firstName: string,
  lastName: string,
  middleName?: string,
  city?: string,
  state?: string,
  phone?: string,
  street?: string,
  zipCode?: string,
): Promise<ToolResult> {
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');

  // Run WhitePages and Endato in parallel — both results shown to AI regardless
  const [wpResult, endatoResult] = await Promise.all([
    searchWhitePages(fullName, city, state, phone, street, zipCode).catch((err) => ({
      success: false as const,
      data: null,
      summary: `WhitePages error: ${(err as Error).message}`,
    })),
    searchEndato(firstName, lastName, middleName, city, state).catch((err) => ({
      success: false as const,
      data: null,
      summary: `Endato error: ${(err as Error).message}`,
    })),
  ]);

  const wpOk = wpResult.success && wpResult.data !== null;
  const endatoOk = endatoResult.success && endatoResult.data !== null;

  if (!wpOk && !endatoOk) {
    appLog('error', 'endato', 'address_search', `Address search failed for ${fullName}: both WhitePages and Endato returned no results`).catch(() => {});
    return {
      success: false,
      data: null,
      summary: `Both sources failed. WhitePages: ${wpResult.summary}. Endato: ${endatoResult.summary}`,
    };
  }
  appLog('info', 'endato', 'address_search', `Address search for ${fullName}: WP=${wpOk ? 'ok' : 'fail'}, Endato=${endatoOk ? 'ok' : 'fail'}`).catch(() => {});

  // Merge both results into a single response so the AI sees everything
  const combinedData: Record<string, unknown> = {};
  if (wpOk) combinedData.whitepages = wpResult.data;
  if (endatoOk) combinedData.endato = endatoResult.data;

  const sources: string[] = [];
  if (wpOk) sources.push(`WhitePages: ${wpResult.summary}`);
  else sources.push(`WhitePages: ${wpResult.summary}`);
  if (endatoOk) sources.push(`Endato: ${endatoResult.summary}`);
  else sources.push(`Endato: ${endatoResult.summary}`);

  return {
    success: true,
    data: combinedData,
    summary: sources.join(' | '),
  };
}

// ─── Office Delivery Research (OpenAI sub-call) ──────────

export async function researchOfficeDelivery(
  fullName: string,
  title: string,
  companyName: string,
  linkedinLocation: string,
): Promise<ToolResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { success: false, summary: 'OPENAI_API_KEY not configured' };

  const prompt = `You are an expert at finding corporate office addresses and understanding package delivery logistics.

I need to find office delivery information for: ${fullName}${title ? `, ${title}` : ''}${companyName ? ` at ${companyName}` : ''} based in ${linkedinLocation || 'location unknown'}.

Please research and answer these questions:

1. What is ${companyName || 'the company'}'s remote/hybrid work policy? (check their about page, recent job postings, news)
2. Does someone in a "${title || 'similar'}" role typically work in-office or remotely?
3. What is the closest office address for ${companyName || 'the company'} near ${linkedinLocation || 'their location'}? (only current company, not past employers)
4. Is that office in a large corporate building with a mailroom? Or a smaller office with direct-to-desk delivery?
5. What is the package reception policy for that building? Can FedEx deliver directly to the person, or does it go to a mailroom/security desk?
6. Estimate: if we send a FedEx package to that office address, what is the likelihood ${fullName} actually receives it?

Output format:
Remote/hybrid policy: [answer]
Role work location: [in-office / remote / hybrid]
Office address: [full address with street, city, state, ZIP — or "none found"]
Building type: [small office / large corporate campus / co-working / other]
Delivery policy: [direct-to-desk / mailroom pickup / security desk / unknown]
Delivery success estimate: [high/medium/low] — [brief reason]
Recommendation: [OFFICE unless the person is CLEARLY fully remote OR the building is a mega-campus where packages get lost / COURIER only if mega-campus (Google HQ, Amazon, Meta, etc.) or delivery is explicitly unreliable / HOME only if fully remote with no local office]

DEFAULT TO OFFICE: If the person works hybrid or in-office and the building is a regular office (any size, including those with mailrooms or security desks), recommend OFFICE. Hybrid workers go in regularly; packages wait at the office. Do NOT recommend HOME just because the person might sometimes work from home or because they are a senior executive — executives have assistants who collect packages.

IMPORTANT: Most regular office mailrooms DO successfully deliver packages. Only recommend COURIER for truly problematic environments like Google HQ, Amazon campus, Meta HQ, or very large multi-tenant buildings where packages are known to get lost. A standard mid-size company office = OFFICE recommendation.

FedEx label: Output a complete, copy-pasteable FedEx shipping label for the best office address found. Include recipient name, company, full street address, city, state, ZIP. If no office found, write "No office address found".`;

  try {
    const res = await axios.post(
      'https://api.openai.com/v1/responses',
      {
        model: 'gpt-5.2',
        input: prompt,
        tools: [{ type: 'web_search_preview' }],
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60_000,
      },
    );

    // Extract text from the response
    const output = res.data?.output ?? [];
    const text = output
      .filter((o: Record<string, unknown>) => o.type === 'message')
      .flatMap((o: Record<string, unknown>) => (o.content as Array<Record<string, unknown>>) ?? [])
      .filter((c: Record<string, unknown>) => c.type === 'output_text')
      .map((c: Record<string, unknown>) => c.text as string)
      .join('\n');

    if (!text) {
      return { success: false, summary: 'No response from office research sub-call' };
    }

    appLog('info', 'openai', 'office_research', `Office research complete for ${companyName || fullName}`, { fullName, companyName }).catch(() => {});
    return {
      success: true,
      data: { analysis: text },
      summary: `Office research complete for ${companyName || fullName}`,
    };
  } catch (err) {
    const axiosErr = err as AxiosError;
    const status = axiosErr.response?.status;
    const detail = status ? ` (HTTP ${status})` : '';
    appLog('error', 'openai', 'office_research', `Office research failed${detail}: ${(err as Error).message}`, { fullName, companyName, error: (err as Error).message }).catch(() => {});
    return { success: false, summary: `Office research failed${detail}: ${(err as Error).message}` };
  }
}

// ─── Exa AI Web Search ───────────────────────────────────

export async function searchExaAI(
  query: string,
  category: string = 'auto',
  numResults: number = 5,
): Promise<ToolResult> {
  const apiKey = process.env.EXA_AI_KEY;
  if (!apiKey) return { success: false, summary: 'EXA_AI_KEY not configured' };

  try {
    const res = await axios.post<ExaSearchResponse>(
      'https://api.exa.ai/search',
      { query, numResults, category, contents: { text: true, highlights: true } },
      {
        headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
        timeout: TIMEOUT,
      },
    );

    const results = res.data.results ?? [];
    appLog('info', 'exa_ai', 'web_search', `Exa search: ${results.length} results for "${query}"`, { query, numResults: results.length }).catch(() => {});
    return {
      success: true,
      data: results.map(r => ({
        title: r.title,
        url: r.url,
        text: r.text?.slice(0, MAX_TEXT_PER_RESULT),
        highlights: r.highlights?.slice(0, 3),
      })),
      summary: `${results.length} web results for "${query}"`,
    };
  } catch (err) {
    appLog('error', 'exa_ai', 'web_search', `Exa search failed: ${(err as Error).message}`, { query, error: (err as Error).message }).catch(() => {});
    return { success: false, summary: `Exa search failed: ${(err as Error).message}` };
  }
}

// ─── PropMix Property Verification ───────────────────────

export async function getPropertyDetails(
  streetAddress: string,
  city: string,
  state: string,
  orderId: string,
): Promise<ToolResult> {
  const token = process.env.PROPMIX_ACCESS_TOKEN;
  if (!token) return { success: false, summary: 'PROPMIX_ACCESS_TOKEN not configured' };

  try {
    const res = await axios.get('https://api.propmix.io/pubrec/assessor/v1/GetPropertyDetails', {
      params: { StreetAddress: streetAddress, City: city, State: state, OrderId: orderId },
      headers: { 'Access-Token': token },
      timeout: TIMEOUT,
    });

    appLog('info', 'propmix', 'property_lookup', `Property details retrieved for ${streetAddress}, ${city}, ${state}`).catch(() => {});
    return { success: true, data: res.data, summary: 'Property details retrieved' };
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    if (status === 404) {
      return { success: true, data: null, summary: 'No property data found for this address' };
    }
    appLog('error', 'propmix', 'property_lookup', `PropMix lookup failed: ${(err as Error).message}`, { error: (err as Error).message }).catch(() => {});
    return { success: false, summary: `PropMix lookup failed: ${(err as Error).message}` };
  }
}

// ─── Google Distance Matrix ──────────────────────────────

export async function calculateDistance(
  origin: string,
  destination: string,
): Promise<ToolResult> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  if (!apiKey) return { success: false, summary: 'GOOGLE_SEARCH_API_KEY not configured' };

  try {
    const res = await axios.get<DistanceMatrixResponse>(
      'https://maps.googleapis.com/maps/api/distancematrix/json',
      {
        params: { origins: origin, destinations: destination, key: apiKey, units: 'imperial' },
        timeout: TIMEOUT,
      },
    );

    const element = res.data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') {
      return {
        success: true,
        data: null,
        summary: `Distance calculation returned status: ${element?.status ?? 'no data'}`,
      };
    }

    appLog('info', 'google_maps', 'distance', `Distance: ${origin} → ${destination}: ${element.distance?.text ?? '?'}`, { origin, destination }).catch(() => {});
    return {
      success: true,
      data: {
        distance: element.distance,
        duration: element.duration,
        origin: res.data.origin_addresses?.[0],
        destination: res.data.destination_addresses?.[0],
      },
      summary: `${element.distance?.text ?? '?'}, ${element.duration?.text ?? '?'}`,
    };
  } catch (err) {
    appLog('error', 'google_maps', 'distance', `Distance calculation failed: ${(err as Error).message}`, { origin, destination, error: (err as Error).message }).catch(() => {});
    return { success: false, summary: `Distance calculation failed: ${(err as Error).message}` };
  }
}

// ─── Hunter.io Logo API ──────────────────────────────────

export async function fetchCompanyLogo(domain: string): Promise<ToolResult> {
  try {
    const url = `https://logos.hunter.io/${domain}`;
    const res = await axios.get(url, { timeout: 10_000, validateStatus: (status) => status === 200 || status === 404 });

    if (res.status === 404) {
      return { success: false, summary: `No logo found for ${domain} on Hunter.io` };
    }

    // Validate that the returned image is actually usable (not a tiny redirect/placeholder)
    const validation = await validateLogoUrl(url);
    if (!validation.valid) {
      return { success: false, summary: `Hunter.io logo unusable for ${domain}: ${validation.reason}` };
    }

    appLog('info', 'hunter_io', 'logo_fetch', `Logo found for ${domain}`, { domain, logoUrl: url }).catch(() => {});
    return {
      success: true,
      data: { logoUrl: url },
      summary: `Logo found: ${url}`,
    };
  } catch (err) {
    appLog('error', 'hunter_io', 'logo_fetch', `Hunter.io logo fetch failed for ${domain}: ${(err as Error).message}`, { domain, error: (err as Error).message }).catch(() => {});
    return { success: false, summary: `Hunter.io logo fetch failed: ${(err as Error).message}` };
  }
}

// ─── Brandfetch Brand Data API (secondary logo fallback) ─

interface BrandfetchLogo {
  type: string; // "icon" | "logo" | "symbol" | etc.
  formats: Array<{ src: string; format: string; width?: number; height?: number }>;
}

interface BrandfetchColor {
  hex: string;
  type: string; // "accent" | "dark" | "light" | "brand"
  brightness: number;
}

export interface BrandfetchResult {
  logoUrl?: string;
  colors?: Array<{ hex: string; type: string }>;
  description?: string;
  domain?: string;
  website?: string;
  employeeCount?: string;
  foundedYear?: number;
  industry?: string;
}

export async function fetchBrandfetch(domain: string): Promise<ToolResult> {
  const apiKey = process.env.BRANDFETCH_API_KEY;
  if (!apiKey) return { success: false, summary: 'BRANDFETCH_API_KEY not configured' };

  try {
    const res = await axios.get(`https://api.brandfetch.io/v2/brands/${domain}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10_000,
    });

    const data = res.data;
    if (!data) return { success: false, summary: 'Brandfetch returned no data' };

    // Find best logo — prefer PNG/WebP (SVG excluded — Gemini can't process it)
    let logoUrl: string | undefined;
    const logos: BrandfetchLogo[] = data.logos ?? [];

    // Priority: logo type PNG > logo type WebP > icon type PNG > any
    const logoTypes = ['logo', 'symbol', 'icon'];
    const formatPriority = ['png', 'webp'];

    outer:
    for (const logoType of logoTypes) {
      const match = logos.find(l => l.type === logoType);
      if (!match) continue;
      for (const fmt of formatPriority) {
        const format = match.formats.find(f => f.format === fmt && f.src);
        if (format) {
          logoUrl = format.src;
          break outer;
        }
      }
    }

    const colors: BrandfetchColor[] = data.colors ?? [];
    const result: BrandfetchResult = {
      logoUrl,
      colors: colors.slice(0, 5).map(c => ({ hex: c.hex, type: c.type })),
      description: data.description ?? undefined,
      domain: data.domain ?? domain,
      website: data.links?.find((l: { name: string; url: string }) => l.name === 'website')?.url,
      employeeCount: data.company?.employees,
      foundedYear: data.company?.foundedYear,
      industry: data.company?.industries?.[0]?.slug,
    };

    const parts: string[] = [];
    if (logoUrl) parts.push(`logo: ${logoUrl}`);
    if (result.colors?.length) parts.push(`colors: ${result.colors.map(c => c.hex).join(', ')}`);
    if (result.description) parts.push(`desc: ${result.description.slice(0, 100)}`);

    appLog('info', 'brandfetch', 'brand_lookup', `Brandfetch for ${domain}: ${parts.join(' | ') || 'data found'}`, { domain, hasLogo: !!logoUrl }).catch(() => {});
    return {
      success: true,
      data: result,
      summary: `Brandfetch for ${domain}: ${parts.join(' | ') || 'data found but no logo/colors'}`,
    };
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    if (status === 404) return { success: false, summary: `Brandfetch: no data found for ${domain}` };
    appLog('error', 'brandfetch', 'brand_lookup', `Brandfetch failed for ${domain}: ${(err as Error).message}`, { domain, error: (err as Error).message }).catch(() => {});
    return { success: false, summary: `Brandfetch fetch failed: ${(err as Error).message}` };
  }
}

// ─── Logo.dev API (tertiary logo fallback) ───────────────

export async function fetchLogoDev(domain: string): Promise<ToolResult> {
  const token = process.env.LOGO_DEV_TOKEN;
  if (!token) return { success: false, summary: 'LOGO_DEV_TOKEN not configured' };

  try {
    const url = `https://img.logo.dev/${domain}?token=${token}&size=200&format=png`;

    // Full GET + validate instead of HEAD-only — ensures the image is actually usable
    const validation = await validateLogoUrl(url);
    if (!validation.valid) {
      return { success: false, summary: `Logo.dev logo unusable for ${domain}: ${validation.reason}` };
    }

    appLog('info', 'logo_dev', 'logo_fetch', `Logo.dev logo found for ${domain}`, { domain }).catch(() => {});
    return {
      success: true,
      data: { logoUrl: url },
      summary: `Logo found via Logo.dev: ${url}`,
    };
  } catch (err) {
    appLog('error', 'logo_dev', 'logo_fetch', `Logo.dev fetch failed for ${domain}: ${(err as Error).message}`, { domain, error: (err as Error).message }).catch(() => {});
    return { success: false, summary: `Logo.dev fetch failed: ${(err as Error).message}` };
  }
}

// ─── Logo URL Validation ──────────────────────────────────

/**
 * Validates that a logo URL is actually usable by Gemini:
 * - HTTP 200 response
 * - Not SVG (Gemini can't process SVG)
 * - Response body > 2KB (tiny images are usually placeholders)
 */
export async function validateLogoUrl(url: string): Promise<{ valid: boolean; reason?: string }> {
  try {
    const res = await axios.get(url, {
      timeout: 10_000,
      responseType: 'arraybuffer',
      validateStatus: () => true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; postcard-bot/1.0)' },
    });

    if (res.status !== 200) {
      return { valid: false, reason: `HTTP ${res.status}` };
    }

    const contentType: string = (res.headers['content-type'] ?? '').split(';')[0].trim();
    if (contentType === 'image/svg+xml') {
      return { valid: false, reason: 'SVG format (unsupported by Gemini)' };
    }

    const size = (res.data as Buffer).length;
    if (size < 2048) {
      return { valid: false, reason: `Too small (${size} bytes) — likely a placeholder` };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, reason: `Fetch failed: ${(err as Error).message}` };
  }
}

// ─── Firecrawl Web Scraping (with axios fallback) ─────────

export async function scrapeWithFirecrawl(url: string): Promise<{ success: boolean; content: string; url: string; error?: string }> {
  const apiKey = process.env.FIRECRAWL_API_KEY;

  // Try Firecrawl first
  if (apiKey) {
    try {
      const res = await axios.post<{ success: boolean; data?: { markdown?: string } }>(
        'https://api.firecrawl.dev/v1/scrape',
        { url, formats: ['markdown'] },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          timeout: 20_000,
        },
      );

      if (res.data.success && res.data.data?.markdown) {
        const markdown = res.data.data.markdown.slice(0, 12000);
        appLog('info', 'firecrawl', 'scrape', `Firecrawl scraped ${url} (${markdown.length} chars)`, { url }).catch(() => {});
        return { success: true, content: markdown, url };
      }
    } catch (err) {
      appLog('warn', 'firecrawl', 'scrape_fail', `Firecrawl failed for ${url}: ${(err as Error).message}`, { url, error: (err as Error).message }).catch(() => {});
      // Fall through to axios
    }
  }

  // Fallback: raw axios fetch
  try {
    const res = await axios.get(url, {
      timeout: 15_000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; enrichment-bot/1.0)' },
      validateStatus: (s) => s < 500,
    });
    const text = typeof res.data === 'string'
      ? res.data.slice(0, 8000)
      : JSON.stringify(res.data).slice(0, 8000);
    return { success: true, content: text, url };
  } catch (err) {
    return { success: false, content: '', url, error: (err as Error).message };
  }
}
