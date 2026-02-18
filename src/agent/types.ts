/**
 * Type definitions for the Address Verification Agent.
 */

// ─── Agent Core ──────────────────────────────────────────

export type Recommendation = 'HOME' | 'OFFICE' | 'COURIER';

export interface AddressInfo {
  address: string;
  confidence: number;
  reasoning: string;
}

export interface AgentDecision {
  recommendation: Recommendation;
  confidence: number;
  reasoning: string;
  home_address?: AddressInfo;
  office_address?: AddressInfo;
  flags?: string[];
  career_summary?: string;
  profile_image_url?: string;
}

export interface AgentResult {
  input: string;
  iterations: number;
  decision: AgentDecision | null;
  timestamp: string;
}

// ─── Tool System ─────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data?: unknown;
  summary: string;
  error?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ─── Claude / Bedrock Messages ───────────────────────────

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface ClaudeResponse {
  content: ContentBlock[];
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens';
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

// ─── API Response Types ──────────────────────────────────

// Endato (Enformion)
export interface EndatoAddress {
  fullAddress?: string;
  houseNumber?: string;
  streetName?: string;
  streetType?: string;
  city?: string;
  state?: string;
  zip?: string;
  zip4?: string;
  county?: string;
  latitude?: string;
  longitude?: string;
  addressOrder?: number;
  firstReportedDate?: string;
  lastReportedDate?: string;
  isDeliverable?: boolean;
  isPublic?: boolean;
  phoneNumbers?: string[];
}

export interface EndatoPhone {
  phoneNumber?: string;
  phoneType?: string;
  company?: string;
  location?: string;
  isConnected?: boolean;
  firstReportedDate?: string;
  lastReportedDate?: string;
}

export interface EndatoEmail {
  emailAddress?: string;
  firstReportedDate?: string;
  lastReportedDate?: string;
}

export interface EndatoPersonName {
  firstName?: string;
  middleName?: string;
  lastName?: string;
  prefix?: string;
  suffix?: string;
}

export interface EndatoPerson {
  name: EndatoPersonName;
  fullName?: string;
  age?: number;
  addresses: EndatoAddress[];
  phoneNumbers: EndatoPhone[];
  emailAddresses?: EndatoEmail[];
  isCurrentPropertyOwner?: boolean;
  propensityToPayScore?: number;
  akas?: EndatoPersonName[];
  indicators?: Record<string, unknown>;
}

export interface EndatoSearchResponse {
  persons?: EndatoPerson[];
  counts?: {
    searchResults: number;
    addresses: number;
    phoneNumbers: number;
    emailAddresses: number;
  };
  pagination?: {
    currentPageNumber: number;
    resultsPerPage: number;
    totalPages: number;
  };
}

// Bright Data LinkedIn
export interface LinkedInExperience {
  company?: string;
  title?: string;
  location?: string;
  start_date?: string;
  end_date?: string;
  description?: string;
}

export interface LinkedInProfile {
  name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  current_company_name?: string;
  current_company_position?: string;
  city?: string;
  state?: string;
  country?: string;
  about?: string;
  experience?: LinkedInExperience[];
  [key: string]: unknown;
}

// Google Distance Matrix
export interface DistanceElement {
  distance?: { text: string; value: number };
  duration?: { text: string; value: number };
  status: string;
}

export interface DistanceMatrixResponse {
  destination_addresses: string[];
  origin_addresses: string[];
  rows: Array<{ elements: DistanceElement[] }>;
  status: string;
}

// Exa AI
export interface ExaSearchResult {
  title?: string;
  url?: string;
  text?: string;
  highlights?: string[];
  publishedDate?: string;
  author?: string;
}

export interface ExaSearchResponse {
  results: ExaSearchResult[];
  requestId?: string;
}
