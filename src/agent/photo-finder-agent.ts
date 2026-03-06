/**
 * Photo Finder Agent
 * Given a contact whose profile photo is missing or a placeholder,
 * runs an AI agent loop to search the web, scrape pages, and find
 * their real headshot photo.
 *
 * Uses the same Bedrock Claude model as the enrichment agent.
 * Tools: search_web, fetch_url, scrape_linkedin_profile, submit_photo
 */

import type { Message, ToolUseBlock, ToolResultBlock, TextBlock } from './types';
import { getAIClientForRole } from '@/lib/ai/config';
import { fetchBrightDataLinkedIn, enrichWithPDL, searchExaAI } from './services';
import axios, { type AxiosError } from 'axios';
import { appLog } from '@/lib/app-log';

// ─── Types ───────────────────────────────────────────────

export interface PhotoFinderInput {
  contactId: string;
  name: string;
  company: string;
  linkedinUrl: string;
  title?: string;
  /** Extra context from enrichment (company name, values, etc.) to help identify the right person */
  enrichmentContext?: string;
}

export interface PhotoFinderResult {
  photoUrl: string | null;
  source: string; // "google_search", "company_page", "linkedin", "pdl", etc.
  confidence: string; // "high", "medium", "low"
}

export type PhotoFinderEventType =
  | 'start'
  | 'step'
  | 'tool_call'
  | 'tool_result'
  | 'complete'
  | 'error';

export interface PhotoFinderEvent {
  type: PhotoFinderEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── Tool Definitions ────────────────────────────────────

const PHOTO_FINDER_TOOLS = [
  {
    name: 'search_web',
    description: 'Search the web using Exa AI. Use broad queries like "{Full Name} {Company}" to find pages mentioning this person. DO NOT add "headshot", "photo", "linkedin" — just the person\'s name and company. Returns URLs and text snippets from matching pages.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query — just the person\'s full name and company name' },
        num_results: { type: 'number', description: 'Number of results (default: 10, max: 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'fetch_url',
    description: 'Fetch a web page and extract all images from it. Returns the page text content plus a list of all <img> tags found with their src, alt, width, and surrounding context. Use this to inspect pages from search results for the prospect\'s photo.',
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'URL to fetch and extract images from' },
      },
      required: ['url'],
    },
  },
  {
    name: 'scrape_linkedin_profile',
    description: 'Scrape a LinkedIn profile via Bright Data to get the avatar (headshot) URL. This is the most reliable source for profile photos. Use if you find an alternative LinkedIn URL for this person.',
    input_schema: {
      type: 'object' as const,
      properties: {
        linkedin_url: { type: 'string', description: 'Full LinkedIn profile URL' },
      },
      required: ['linkedin_url'],
    },
  },
  {
    name: 'check_image',
    description: 'Download an image URL and verify it\'s a real human photo (not a placeholder, logo, or icon). Returns the image size in bytes and a color diversity score. Real photos have 200+ unique color samples, placeholders have < 60.',
    input_schema: {
      type: 'object' as const,
      properties: {
        image_url: { type: 'string', description: 'URL of the image to check' },
      },
      required: ['image_url'],
    },
  },
  {
    name: 'submit_photo',
    description: 'Submit the found photo URL as the final result. Call this when you\'ve found a photo you\'re confident belongs to this specific person.',
    input_schema: {
      type: 'object' as const,
      properties: {
        photo_url: { type: 'string', description: 'Direct URL to the person\'s headshot photo' },
        source: { type: 'string', description: 'Where you found it, e.g. "company_about_page", "linkedin_alt", "conference_speaker_page", "news_article"' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'How confident you are this is the right person' },
      },
      required: ['photo_url', 'source', 'confidence'],
    },
  },
  {
    name: 'give_up',
    description: 'Call this if you\'ve exhausted all search strategies and cannot find a photo of this person. Explain why.',
    input_schema: {
      type: 'object' as const,
      properties: {
        reason: { type: 'string', description: 'Why the photo could not be found' },
      },
      required: ['reason'],
    },
  },
];

// ─── System Prompt ───────────────────────────────────────

function buildSystemPrompt(input: PhotoFinderInput): string {
  return `You are a specialist at finding real headshot photographs of specific people on the internet.

## YOUR MISSION
Find a REAL photograph (headshot or professional photo) of this specific person:
- **Full Name:** ${input.name}
- **Company:** ${input.company}
- **Job Title:** ${input.title ?? 'Unknown'}
- **LinkedIn:** ${input.linkedinUrl}
${input.enrichmentContext ? `\n## ADDITIONAL CONTEXT FROM ENRICHMENT\n${input.enrichmentContext}\n` : ''}
Their current LinkedIn profile photo is MISSING or a generic placeholder. The standard LinkedIn/PDL scrape already failed to find a real photo, so you need to look BEYOND LinkedIn.

## STRATEGY (follow this order)

### Round 1 — Search broadly
1. Search for "${input.name} ${input.company}" (nothing else — no "photo", "headshot", "linkedin")
2. Look at the top 10 results. Promising page types:
   - Company "About Us" / "Team" / "Leadership" pages
   - Conference speaker bios
   - News articles or press releases mentioning them
   - Industry directory profiles
   - Podcast guest pages
   - University alumni pages
   - Professional association pages

### Round 2 — Inspect promising pages
3. For each promising URL, call fetch_url to get the page content and image list
4. Look for images where:
   - The alt text or nearby text mentions "${input.name}" or their first name
   - The image filename contains their name
   - The image is in a team/leadership section near their name
   - The image is a reasonable size for a headshot (not tiny icons, not huge banners)
5. Use check_image to verify candidate photos are real human photos (not logos/icons/placeholders)

### Round 3 — LinkedIn alternatives
6. If web search didn't work, try scrape_linkedin_profile on their known LinkedIn URL (sometimes Bright Data succeeds on retry)
7. Search for variations of their name that might have a different LinkedIn URL

## CRITICAL RULES FOR IDENTITY VERIFICATION
- **NEVER submit a photo unless you can verify it's THIS specific person** — same name AND same company/role context
- If a page shows "${input.name}" with a photo next to their name/title at ${input.company}, that's high confidence
- If a page mentions "${input.name}" but the photo could be someone else on the page, that's LOW confidence — skip it
- Conference speaker pages are great because they pair photo + name + company
- Team pages are great because they pair photo + name + title
- Generic stock photos, group photos where you can't identify individuals, logos — SKIP ALL OF THESE
- If a name is common (e.g. "John Smith"), be EXTRA careful — require company/title match near the photo
- NEVER guess. If you're not sure, call give_up rather than submit a wrong photo

## EFFICIENCY
- You have max 15 tool calls. Be strategic.
- Don't fetch pages that are unlikely to have photos (PDFs, login walls, social media feeds)
- Focus on pages with "team", "about", "speaker", "author" in the URL — these almost always have headshots
- If you find a good photo early, submit it — don't keep searching`;
}

// ─── Tool Executor ───────────────────────────────────────

async function executePhotoFinderTool(
  toolName: string,
  args: Record<string, unknown>,
): Promise<{ result: Record<string, unknown>; photoData?: PhotoFinderResult }> {
  switch (toolName) {
    case 'search_web': {
      const query = args.query as string;
      const numResults = Math.min((args.num_results as number | undefined) ?? 10, 10);
      const res = await searchExaAI(query, 'auto', numResults);
      return { result: { success: res.success, data: res.data, summary: res.summary } };
    }

    case 'fetch_url': {
      try {
        const res = await axios.get(args.url as string, {
          timeout: 15_000,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          validateStatus: (s) => s < 500,
          maxRedirects: 3,
        });

        if (typeof res.data !== 'string') {
          return { result: { success: true, content: JSON.stringify(res.data).slice(0, 6000), images: [], url: args.url } };
        }

        const html = res.data as string;

        // Extract all <img> tags with their attributes and surrounding context
        const imgRegex = /<img\s+[^>]*?src\s*=\s*["']([^"']+)["'][^>]*>/gi;
        const images: Array<{ src: string; alt: string; context: string }> = [];
        let match;
        while ((match = imgRegex.exec(html)) !== null && images.length < 30) {
          const tag = match[0];
          const src = match[1];

          // Skip tiny icons, data URIs, tracking pixels
          if (src.startsWith('data:') || src.includes('1x1') || src.includes('pixel') || src.includes('.svg')) continue;
          if (src.includes('icon') && !src.includes('linkedin')) continue;

          // Extract alt text
          const altMatch = tag.match(/alt\s*=\s*["']([^"']*?)["']/i);
          const alt = altMatch?.[1] ?? '';

          // Get ~200 chars of surrounding context
          const tagIdx = match.index;
          const contextStart = Math.max(0, tagIdx - 200);
          const contextEnd = Math.min(html.length, tagIdx + tag.length + 200);
          const context = html.slice(contextStart, contextEnd)
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 300);

          // Resolve relative URLs
          let fullSrc = src;
          if (src.startsWith('//')) fullSrc = 'https:' + src;
          else if (src.startsWith('/')) {
            try {
              const base = new URL(args.url as string);
              fullSrc = base.origin + src;
            } catch { /* keep as-is */ }
          }

          images.push({ src: fullSrc, alt, context });
        }

        // Also extract text content (truncated)
        const textContent = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 4000);

        return {
          result: {
            success: true,
            url: args.url,
            images_found: images.length,
            images: images.slice(0, 20), // limit to top 20
            text_content: textContent,
          },
        };
      } catch (err) {
        return { result: { success: false, error: (err as AxiosError).message, url: args.url } };
      }
    }

    case 'scrape_linkedin_profile': {
      const linkedinUrl = args.linkedin_url as string;
      try {
        // Try Bright Data first
        const profile = await fetchBrightDataLinkedIn(linkedinUrl);
        let avatar = profile ? (profile as Record<string, unknown>).avatar as string | undefined : undefined;
        const name = profile?.name;
        const title = profile?.current_company_position ?? profile?.headline;

        // PDL fallback
        if (!avatar) {
          try {
            const pdl = await enrichWithPDL(linkedinUrl);
            if (pdl.success && pdl.data) {
              const pic = (pdl.data as Record<string, unknown>).profile_pic_url as string | undefined;
              if (pic) avatar = pic;
            }
          } catch { /* continue */ }
        }

        return {
          result: {
            success: true,
            name,
            title,
            photo_url: avatar ?? null,
            summary: avatar
              ? `Found photo for ${name ?? 'person'}: ${avatar}`
              : `Scraped ${name ?? 'profile'} but no photo found`,
          },
        };
      } catch (err) {
        return { result: { success: false, summary: `LinkedIn scrape failed: ${(err as Error).message}` } };
      }
    }

    case 'check_image': {
      const imageUrl = args.image_url as string;
      try {
        const { checkPhoto } = await import('@/lib/photo-finder/detect-placeholder');
        const result = await checkPhoto(imageUrl);
        return {
          result: {
            success: true,
            image_url: imageUrl,
            is_real_photo: result === 'real',
            classification: result,
            summary: result === 'real'
              ? 'This looks like a real human photograph'
              : result === 'placeholder'
              ? 'This is a placeholder/icon/logo — NOT a real photo'
              : `Could not verify: ${result}`,
          },
        };
      } catch (err) {
        return { result: { success: false, error: (err as Error).message } };
      }
    }

    case 'submit_photo': {
      const data: PhotoFinderResult = {
        photoUrl: args.photo_url as string,
        source: args.source as string,
        confidence: args.confidence as string,
      };
      return { result: { success: true, summary: 'Photo submitted' }, photoData: data };
    }

    case 'give_up': {
      return {
        result: { success: true, summary: `Gave up: ${args.reason}` },
        photoData: { photoUrl: null, source: 'exhausted', confidence: 'low' },
      };
    }

    default:
      return { result: { success: false, error: `Unknown tool: ${toolName}` } };
  }
}

// ─── Agent Runner ────────────────────────────────────────

const MAX_ITERATIONS = 15;

export async function runPhotoFinderAgent(
  input: PhotoFinderInput,
  onEvent: (event: PhotoFinderEvent) => void,
): Promise<PhotoFinderResult | null> {
  const emit = (type: PhotoFinderEventType, data: Record<string, unknown>) => {
    onEvent({ type, timestamp: new Date().toISOString(), data });
  };

  emit('start', { contactId: input.contactId, name: input.name, company: input.company });

  let aiClient = await getAIClientForRole('agent');
  let usingFallback = false;

  const systemPrompt = buildSystemPrompt(input);

  const messages: Message[] = [
    { role: 'user', content: `Find a real headshot photo for ${input.name} at ${input.company}. Their LinkedIn is ${input.linkedinUrl}. Begin searching now.` },
  ];

  let result: PhotoFinderResult | null = null;

  const isRateLimit = (err: unknown): boolean => {
    const msg = (err as Error)?.message ?? '';
    return msg.includes('Too many tokens') || msg.includes('ThrottlingException') || msg.includes('rate limit');
  };

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    emit('step', { iteration, total: MAX_ITERATIONS });

    let response;
    try {
      response = await aiClient.callModel(messages, PHOTO_FINDER_TOOLS, {
        maxTokens: 2048,
        system: systemPrompt,
      });
    } catch (err) {
      if (isRateLimit(err) && !usingFallback) {
        usingFallback = true;
        appLog('warn', 'bedrock', 'photo_finder_throttle', `Bedrock throttled, switching to fallback`, { contactId: input.contactId }).catch(() => {});
        try {
          aiClient = await getAIClientForRole('fallback');
          emit('step', { iteration, note: 'Rate limited — switching to fallback provider' });
          response = await aiClient.callModel(messages, PHOTO_FINDER_TOOLS, {
            maxTokens: 2048,
            system: systemPrompt,
          });
        } catch (fallbackErr) {
          emit('error', { error: (fallbackErr as Error).message });
          return null;
        }
      } else {
        emit('error', { error: (err as Error).message });
        return null;
      }
    }

    if (!response) break;

    // Process response
    messages.push({ role: 'assistant', content: response.content });

    // Log any thinking text
    const textBlocks = response.content.filter((b): b is TextBlock => b.type === 'text');
    if (textBlocks.length > 0) {
      emit('step', { iteration, thinking: textBlocks.map(b => b.text).join('\n') });
    }

    if (response.stop_reason === 'end_turn') {
      // Nudge it to use tools if it stopped without doing anything
      if (iteration === 0) {
        messages.push({ role: 'user', content: 'Please use the search_web tool to find this person\'s photo. Start by searching for their name and company.' });
        continue;
      }
      emit('complete', { result: null });
      break;
    }

    if (response.stop_reason === 'max_tokens') {
      emit('error', { error: 'Hit token limit' });
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
      const toolResults: ToolResultBlock[] = [];

      for (const toolUse of toolUses) {
        emit('tool_call', { tool: toolUse.name, input: toolUse.input });

        const { result: toolResult, photoData } = await executePhotoFinderTool(
          toolUse.name,
          toolUse.input as Record<string, unknown>,
        );

        emit('tool_result', { tool: toolUse.name, result: toolResult });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(toolResult),
        });

        if (photoData) {
          result = photoData;
        }
      }

      messages.push({ role: 'user', content: toolResults });

      // If we got a result, we're done
      if (result) {
        emit('complete', { result });
        break;
      }
    }
  }

  appLog('info', 'system', 'photo_finder_complete', `Photo finder for ${input.name}: ${result?.photoUrl ? 'found' : 'not found'}`, {
    contactId: input.contactId,
    photoUrl: result?.photoUrl,
    source: result?.source,
  }).catch(() => {});

  return result;
}
