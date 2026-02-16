/**
 * Experimental tool definitions — extends base tools with new data sources.
 */

import type { ToolDefinition, ToolResult, ToolUseBlock, AgentDecision } from '../types';

// Import base tools
import {
  enrichLinkedInProfile,
  searchPersonAddress,
  searchExaAI,
  getPropertyDetails,
  calculateDistance,
} from '../services';

// Import experimental tools
import {
  searchFECDonations,
  searchCorporateOfficer,
  findAffordableZips,
  computeCommuteProbability,
} from './services';

// Base tool definitions (same as stable agent)
import { TOOL_DEFINITIONS as BASE_TOOLS } from '../tools';

// ─── New Experimental Tool Schemas ───────────────────────

const EXPERIMENTAL_TOOLS: ToolDefinition[] = [
  {
    name: 'search_fec_donations',
    description:
      'Search FEC (Federal Election Commission) public records for political campaign donations. Donors\' HOME ADDRESSES are public record. This is one of the most reliable ways to find a home address. Search by name, optionally filter by state or employer.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name to search (e.g., "John Smith")' },
        state: { type: 'string', description: 'Two-letter state code to narrow results (optional)' },
        employer: { type: 'string', description: 'Employer name to narrow results (optional)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'search_corporate_officer',
    description:
      'Search OpenCorporates for a person as a company officer, director, or registered agent. Officers\' addresses are often on file and may be their home address, especially for small companies/LLCs. Covers 200M+ companies globally.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Person name to search (e.g., "Alp Levent")' },
        jurisdiction: { type: 'string', description: 'Jurisdiction code like "us_tn" for Tennessee (optional)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'find_affordable_zips',
    description:
      'Given an estimated annual income and state, find ZIP codes where the median household income is within range. Uses Census ACS data. Helps narrow the geographic search space — people tend to live in neighborhoods matching their income level.',
    input_schema: {
      type: 'object',
      properties: {
        state: { type: 'string', description: 'Two-letter state code (e.g., "TN")' },
        estimated_income: { type: 'number', description: 'Estimated annual household income in dollars' },
        tolerance_pct: { type: 'number', description: 'Tolerance as decimal (default 0.4 = +/-40%)' },
      },
      required: ['state', 'estimated_income'],
    },
  },
  {
    name: 'score_commute_probability',
    description:
      'Given a distance in miles between a candidate home address and the workplace, compute the probability that this is a realistic commute. Based on Census commute distribution data. Returns 0-1 probability (higher = more likely). Use after calculate_distance to score candidate addresses.',
    input_schema: {
      type: 'object',
      properties: {
        distance_miles: { type: 'number', description: 'Driving distance in miles' },
      },
      required: ['distance_miles'],
    },
  },
];

// Combine base + experimental tools
export const TOOL_DEFINITIONS: ToolDefinition[] = [...BASE_TOOLS, ...EXPERIMENTAL_TOOLS];

// ─── Tool Dispatch ───────────────────────────────────────

export interface ToolDispatchResult {
  toolResult: ToolResult;
  decision?: AgentDecision;
}

export async function executeTool(toolUse: ToolUseBlock): Promise<ToolDispatchResult> {
  const args = toolUse.input;

  switch (toolUse.name) {
    // ─── Base tools ──────────────────────────────────
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

    // ─── Experimental tools ──────────────────────────
    case 'search_fec_donations':
      return {
        toolResult: await searchFECDonations(
          args.name as string,
          args.state as string | undefined,
          args.employer as string | undefined,
        ),
      };

    case 'search_corporate_officer':
      return {
        toolResult: await searchCorporateOfficer(
          args.name as string,
          args.jurisdiction as string | undefined,
        ),
      };

    case 'find_affordable_zips':
      return {
        toolResult: await findAffordableZips(
          args.state as string,
          args.estimated_income as number,
          (args.tolerance_pct as number | undefined) ?? 0.4,
        ),
      };

    case 'score_commute_probability': {
      const distMiles = args.distance_miles as number;
      const prob = computeCommuteProbability(distMiles);
      return {
        toolResult: {
          success: true,
          data: { distanceMiles: distMiles, probability: prob },
          summary: `Commute probability for ${distMiles} miles: ${(prob * 100).toFixed(0)}%`,
        },
      };
    }

    default:
      return { toolResult: { success: false, summary: `Unknown tool: ${toolUse.name}` } };
  }
}
