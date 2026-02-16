/**
 * Types for experimental agent — extends base types with new data sources.
 */

// Re-export all base types
export type * from '../types';

// ─── FEC Campaign Finance ────────────────────────────────

export interface FECContribution {
  contributor_name: string;
  contributor_city: string;
  contributor_state: string;
  contributor_zip: string;
  contributor_street_1?: string;
  contributor_street_2?: string;
  contributor_employer?: string;
  contributor_occupation?: string;
  contribution_receipt_amount: number;
  contribution_receipt_date: string;
  committee_name?: string;
}

export interface FECResponse {
  results: FECContribution[];
  pagination: {
    count: number;
    pages: number;
    per_page: number;
    page: number;
  };
}

// ─── OpenCorporates ──────────────────────────────────────

export interface OCOfficer {
  id: number;
  name: string;
  position: string;
  start_date?: string;
  end_date?: string;
  occupation?: string;
  nationality?: string;
  address?: string;
  company: {
    name: string;
    company_number: string;
    jurisdiction_code: string;
    registered_address_in_full?: string;
    opencorporates_url: string;
  };
}

export interface OCSearchResponse {
  results: {
    officers: Array<{
      officer: OCOfficer;
    }>;
  };
  total_count: number;
  total_pages: number;
}

// ─── Census ACS Income Data ──────────────────────────────

export interface CensusIncomeData {
  zipCode: string;
  medianIncome: number | null;
  name: string;
}

// ─── Probability Scoring ─────────────────────────────────

export interface CandidateAddress {
  address: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number;
  lng?: number;
  source: string;
  confidence: number;
  signals: string[];
}

export interface ProbabilityProfile {
  candidateAddresses: CandidateAddress[];
  workplaceAddress?: string;
  estimatedIncome?: number;
  commuteRadiusKm?: number;
  incomeMatchZips?: string[];
}
