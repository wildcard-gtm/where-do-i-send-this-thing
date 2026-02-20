/**
 * Tool definitions (Anthropic tool_use schema) and dispatch.
 * Tool descriptions are loaded from the database (SystemPrompt table)
 * so admins can edit them from the admin panel.
 */

import type { ToolDefinition, ToolResult, ToolUseBlock, AgentDecision } from './types';
import {
  enrichLinkedInProfile,
  searchPersonAddress,
  searchExaAI,
  getPropertyDetails,
  calculateDistance,
  researchOfficeDelivery,
  enrichWithPDL,
  searchExaPerson,
} from './services';
import { PrismaClient } from '@prisma/client';

// ─── Fallback Tool Descriptions ─────────────────────────
// Used when DB is unavailable or prompts haven't been seeded

const FALLBACK_DESCRIPTIONS: Record<string, string> = {
  enrich_linkedin_profile:
    'Enriches a LinkedIn profile URL via Bright Data. Returns name, company, title, location, experience. Use FIRST when a LinkedIn URL is provided.',
  search_person_address:
    'Search for residential address history by person name. Uses WhitePages as primary source, with Endato as fallback. Returns current addresses, owned properties, phone numbers. Best for finding US home addresses.',
  search_web:
    'Neural web search via Exa AI. Use for researching company office addresses, remote work policies, person info, news articles.',
  verify_property:
    'Verify property ownership via PropMix. Check if a US street address is owned by a specific person. Useful for confirming home address ownership.',
  calculate_distance:
    'Calculate driving distance and travel time between two addresses via Google Maps. Use to assess commute viability and office suitability. >60 min commute = person may not regularly attend that office.',
  research_office_delivery:
    'Dedicated office research sub-call using GPT-4o with web search. Researches company remote/hybrid policy, finds the closest verified office address, checks building package delivery policy (mailroom vs direct-to-desk), and estimates delivery success rate. Use this ONCE after you have the person\'s name, title, company, and location. Do not use search_web to research office policies — use this instead.',
  enrich_with_pdl:
    'Enriches a LinkedIn profile URL via People Data Labs (PDL). Returns verified phone numbers, emails, location history, job title, and company. Use IMMEDIATELY after enrich_linkedin_profile to get contact points that can be used with search_person_address.',
  search_person_linkedin:
    'Searches for a person\'s LinkedIn profile by name and company using Exa AI people search. Returns matching LinkedIn URLs. Use when you need to find or confirm a LinkedIn profile URL.',
  submit_decision:
    'Submit your final delivery recommendation. Call this ONLY when you have gathered enough evidence and your confidence is above 75%.',
};

// ─── Tool Schema Builder ────────────────────────────────

function buildToolDefinitions(descriptions: Record<string, string>): ToolDefinition[] {
  return [
    {
      name: 'enrich_linkedin_profile',
      description: descriptions.enrich_linkedin_profile,
      input_schema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'LinkedIn profile URL (https://www.linkedin.com/in/...)' },
        },
        required: ['url'],
      },
    },
    {
      name: 'search_person_address',
      description: descriptions.search_person_address,
      input_schema: {
        type: 'object',
        properties: {
          first_name: { type: 'string', description: 'First name' },
          middle_name: { type: 'string', description: 'Middle name (optional)' },
          last_name: { type: 'string', description: 'Last name' },
          city: { type: 'string', description: 'City (optional, helps narrow results)' },
          state: { type: 'string', description: 'Two-letter US state code (optional)' },
          phone: { type: 'string', description: 'Phone number to reverse-lookup or confirm identity (optional). Use when you have a phone from LinkedIn or other source.' },
          street: { type: 'string', description: 'Partial street address filter, e.g. "123 Main" (optional)' },
          zip_code: { type: 'string', description: '5-digit ZIP code filter (optional)' },
        },
        required: ['first_name', 'last_name'],
      },
    },
    {
      name: 'search_web',
      description: descriptions.search_web,
      input_schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query (be specific)' },
          category: {
            type: 'string',
            enum: ['company', 'people', 'news', 'auto'],
            description: 'Search category (default: auto)',
          },
          num_results: { type: 'number', description: 'Number of results, 1-10 (default: 5)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'verify_property',
      description: descriptions.verify_property,
      input_schema: {
        type: 'object',
        properties: {
          street_address: { type: 'string', description: 'Full street address (e.g., "123 Main St")' },
          city: { type: 'string', description: 'City name' },
          state: { type: 'string', description: 'Two-letter state code' },
          order_id: { type: 'string', description: 'Unique identifier (use firstname-lastname-timestamp)' },
        },
        required: ['street_address', 'city', 'state', 'order_id'],
      },
    },
    {
      name: 'calculate_distance',
      description: descriptions.calculate_distance,
      input_schema: {
        type: 'object',
        properties: {
          origin: { type: 'string', description: 'Starting address or location' },
          destination: { type: 'string', description: 'Destination address or location' },
        },
        required: ['origin', 'destination'],
      },
    },
    {
      name: 'research_office_delivery',
      description: descriptions.research_office_delivery,
      input_schema: {
        type: 'object',
        properties: {
          full_name: { type: 'string', description: 'Full name of the person' },
          title: { type: 'string', description: 'Current job title (optional)' },
          company_name: { type: 'string', description: 'Current company name' },
          linkedin_location: { type: 'string', description: 'Location from LinkedIn profile (e.g. "San Francisco, CA")' },
        },
        required: ['full_name', 'company_name'],
      },
    },
    {
      name: 'enrich_with_pdl',
      description: descriptions.enrich_with_pdl,
      input_schema: {
        type: 'object',
        properties: {
          linkedin_url: { type: 'string', description: 'LinkedIn profile URL (https://www.linkedin.com/in/...)' },
        },
        required: ['linkedin_url'],
      },
    },
    {
      name: 'search_person_linkedin',
      description: descriptions.search_person_linkedin,
      input_schema: {
        type: 'object',
        properties: {
          person_name: { type: 'string', description: 'Full name of the person to search for' },
          company_name: { type: 'string', description: 'Company name to narrow the search (optional)' },
          num_results: { type: 'number', description: 'Number of results to return, 1-10 (default: 5)' },
        },
        required: ['person_name'],
      },
    },
    {
      name: 'submit_decision',
      description: descriptions.submit_decision,
      input_schema: {
        type: 'object',
        properties: {
          recommendation: {
            type: 'string',
            enum: ['HOME', 'OFFICE', 'COURIER'],
            description: 'Where to deliver the package. HOME = verified home address. OFFICE = direct-to-desk office delivery confirmed. COURIER = no direct delivery option available, needs a courier/concierge service.',
          },
          confidence: {
            type: 'number',
            description: 'Confidence percentage (0-100). Must be >75 to be accepted.',
          },
          reasoning: {
            type: 'string',
            description: 'Detailed explanation of why this recommendation was chosen',
          },
          home_address: {
            type: 'object',
            properties: {
              address: { type: 'string' },
              confidence: { type: 'number' },
              reasoning: { type: 'string' },
            },
            description: 'Home address details (if found)',
          },
          office_address: {
            type: 'object',
            properties: {
              address: { type: 'string' },
              confidence: { type: 'number' },
              reasoning: { type: 'string' },
            },
            description: 'Office address details (if found)',
          },
          flags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Notable flags or caveats (e.g., "common name", "international address")',
          },
          career_summary: {
            type: 'string',
            description: 'Brief 2-3 sentence summary of the person\'s career trajectory and current role',
          },
          profile_image_url: {
            type: 'string',
            description: 'URL of the person\'s profile picture from LinkedIn enrichment (the avatar field)',
          },
        },
        required: ['recommendation', 'confidence', 'reasoning'],
      },
    },
  ];
}

// ─── Static Export (fallback) ───────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = buildToolDefinitions(FALLBACK_DESCRIPTIONS);

// ─── Dynamic Loader ─────────────────────────────────────

export async function getToolDefinitions(): Promise<ToolDefinition[]> {
  try {
    const prisma = new PrismaClient();
    const rows = await prisma.systemPrompt.findMany({
      where: { key: { startsWith: 'tool_' } },
    });
    await prisma.$disconnect();

    if (rows.length === 0) return TOOL_DEFINITIONS;

    // Build descriptions from DB, falling back to defaults
    const descriptions = { ...FALLBACK_DESCRIPTIONS };
    for (const row of rows) {
      // key format: "tool_enrich_linkedin_profile" -> "enrich_linkedin_profile"
      const toolName = row.key.replace(/^tool_/, '');
      descriptions[toolName] = row.content;
    }

    return buildToolDefinitions(descriptions);
  } catch {
    return TOOL_DEFINITIONS;
  }
}

// ─── Tool Dispatch ───────────────────────────────────────

export interface ToolDispatchResult {
  toolResult: ToolResult;
  decision?: AgentDecision;
}

export async function executeTool(toolUse: ToolUseBlock): Promise<ToolDispatchResult> {
  const args = toolUse.input;

  switch (toolUse.name) {
    case 'enrich_linkedin_profile':
      return { toolResult: await enrichLinkedInProfile(args.url as string) };

    case 'search_person_address':
      return {
        toolResult: await searchPersonAddress(
          args.first_name as string,
          args.last_name as string,
          args.middle_name as string | undefined,
          args.city as string | undefined,
          args.state as string | undefined,
          args.phone as string | undefined,
          args.street as string | undefined,
          args.zip_code as string | undefined,
        ),
      };

    case 'search_web':
      return {
        toolResult: await searchExaAI(
          args.query as string,
          (args.category as string | undefined) ?? 'auto',
          (args.num_results as number | undefined) ?? 5,
        ),
      };

    case 'verify_property':
      return {
        toolResult: await getPropertyDetails(
          args.street_address as string,
          args.city as string,
          args.state as string,
          args.order_id as string,
        ),
      };

    case 'calculate_distance':
      return {
        toolResult: await calculateDistance(args.origin as string, args.destination as string),
      };

    case 'research_office_delivery':
      return {
        toolResult: await researchOfficeDelivery(
          args.full_name as string,
          (args.title as string | undefined) ?? '',
          (args.company_name as string | undefined) ?? '',
          (args.linkedin_location as string | undefined) ?? '',
        ),
      };

    case 'enrich_with_pdl':
      return { toolResult: await enrichWithPDL(args.linkedin_url as string) };

    case 'search_person_linkedin':
      return {
        toolResult: await searchExaPerson(
          args.person_name as string,
          (args.company_name as string | undefined) ?? '',
          (args.num_results as number | undefined) ?? 5,
        ),
      };

    case 'submit_decision': {
      // Sanitize address fields — model occasionally passes a raw string instead of an object
      const sanitizeAddress = (val: unknown): { address: string; confidence?: number; reasoning?: string } | undefined => {
        if (!val) return undefined;
        if (typeof val === 'object' && val !== null && 'address' in val) {
          return val as { address: string; confidence?: number; reasoning?: string };
        }
        if (typeof val === 'string' && val.trim() && !val.includes('<parameter')) {
          return { address: val.trim() };
        }
        return undefined;
      };
      const decision = {
        ...args,
        home_address: sanitizeAddress(args.home_address),
        office_address: sanitizeAddress(args.office_address),
      } as unknown as AgentDecision;
      return {
        toolResult: { success: true, summary: 'Decision submitted', data: decision },
        decision,
      };
    }

    default:
      return { toolResult: { success: false, summary: `Unknown tool: ${toolUse.name}` } };
  }
}
