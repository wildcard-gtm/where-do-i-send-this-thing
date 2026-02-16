/**
 * Tool definitions (Anthropic tool_use schema) and dispatch.
 */

import type { ToolDefinition, ToolResult, ToolUseBlock, AgentDecision } from './types';
import {
  enrichLinkedInProfile,
  searchPersonAddress,
  searchExaAI,
  getPropertyDetails,
  calculateDistance,
} from './services';

// ─── Tool Schemas ────────────────────────────────────────

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'enrich_linkedin_profile',
    description:
      'Enriches a LinkedIn profile URL via Bright Data. Returns name, company, title, location, experience. Use FIRST when a LinkedIn URL is provided.',
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
    description:
      'Search for residential address history by person name via Endato. Returns current and past addresses, phone numbers. Best for finding US home addresses.',
    input_schema: {
      type: 'object',
      properties: {
        first_name: { type: 'string', description: 'First name' },
        middle_name: { type: 'string', description: 'Middle name (optional)' },
        last_name: { type: 'string', description: 'Last name' },
        city: { type: 'string', description: 'City (optional, helps narrow results)' },
        state: { type: 'string', description: 'Two-letter US state code (optional)' },
      },
      required: ['first_name', 'last_name'],
    },
  },
  {
    name: 'search_web',
    description:
      'Neural web search via Exa AI. Use for researching company office addresses, remote work policies, person info, news articles.',
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
    description:
      'Verify property ownership via PropMix. Check if a US street address is owned by a specific person. Useful for confirming home address ownership.',
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
    description:
      'Calculate driving distance and travel time between two addresses via Google Maps. Use to assess commute viability. >50 miles typically indicates remote worker.',
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
    name: 'submit_decision',
    description:
      'Submit your final delivery recommendation. Call this ONLY when you have gathered enough evidence and your confidence is above 75%.',
    input_schema: {
      type: 'object',
      properties: {
        recommendation: {
          type: 'string',
          enum: ['HOME', 'OFFICE', 'BOTH'],
          description: 'Where to deliver the package',
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
      },
      required: ['recommendation', 'confidence', 'reasoning'],
    },
  },
];

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

    case 'submit_decision':
      return {
        toolResult: { success: true, summary: 'Decision submitted', data: args },
        decision: args as unknown as AgentDecision,
      };

    default:
      return { toolResult: { success: false, summary: `Unknown tool: ${toolUse.name}` } };
  }
}
