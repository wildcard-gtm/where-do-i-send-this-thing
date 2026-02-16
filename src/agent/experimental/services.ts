/**
 * Experimental data source services.
 *
 * New sources beyond the base agent:
 * - FEC Campaign Finance (political donations with home addresses)
 * - OpenCorporates (company officer records with registered addresses)
 * - Census ACS (median income by zip code for neighborhood scoring)
 * - State Business Registry scraping (via OpenCorporates)
 */

import axios, { type AxiosError } from 'axios';
import type { ToolResult } from '../types';
import type { FECResponse, OCSearchResponse, CensusIncomeData } from './types';

const TIMEOUT = 30_000;

// ─── FEC Campaign Finance Donations ──────────────────────
// Political donors' home addresses are public record.
// If someone donated to any federal campaign, their name,
// address, employer, and occupation are searchable.
//
// API: https://api.open.fec.gov/developers
// Key: Free from api.data.gov (DEMO_KEY works with rate limits)

export async function searchFECDonations(
  name: string,
  state?: string,
  employer?: string,
): Promise<ToolResult> {
  const apiKey = process.env.FEC_API_KEY ?? 'DEMO_KEY';

  try {
    const params: Record<string, string | number> = {
      api_key: apiKey,
      contributor_name: name,
      sort: '-contribution_receipt_date',
      per_page: 10,
      is_individual: 'true',
    };
    if (state) params.contributor_state = state;
    if (employer) params.contributor_employer = employer;

    const res = await axios.get<FECResponse>(
      'https://api.open.fec.gov/v1/schedules/schedule_a/',
      { params, timeout: TIMEOUT },
    );

    const results = res.data.results ?? [];
    if (results.length === 0) {
      return { success: true, data: null, summary: `No FEC donation records found for "${name}"` };
    }

    // Deduplicate by address
    const seen = new Set<string>();
    const uniqueAddresses = results.filter(r => {
      const key = `${r.contributor_street_1}|${r.contributor_zip}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      success: true,
      data: uniqueAddresses.slice(0, 5).map(r => ({
        name: r.contributor_name,
        address: [r.contributor_street_1, r.contributor_street_2].filter(Boolean).join(', '),
        city: r.contributor_city,
        state: r.contributor_state,
        zip: r.contributor_zip,
        employer: r.contributor_employer,
        occupation: r.contributor_occupation,
        amount: r.contribution_receipt_amount,
        date: r.contribution_receipt_date,
        committee: r.committee_name,
      })),
      summary: `${results.length} donation(s) found, ${uniqueAddresses.length} unique address(es). Source: FEC public records.`,
    };
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    return { success: false, summary: `FEC search failed (HTTP ${status ?? 'unknown'}): ${(err as Error).message}` };
  }
}

// ─── OpenCorporates Officer Search ───────────────────────
// Search for a person as a company officer/director.
// Officers' addresses are often their home address,
// especially for small companies and LLCs.
//
// API: https://api.opencorporates.com/documentation/API-Reference
// Free for public benefit; rate limited without API key.

export async function searchCorporateOfficer(
  name: string,
  jurisdiction?: string,
): Promise<ToolResult> {
  const apiKey = process.env.OPENCORPORATES_API_KEY;

  try {
    const params: Record<string, string> = { q: name };
    if (jurisdiction) params.jurisdiction_code = jurisdiction;
    if (apiKey) params.api_token = apiKey;

    const res = await axios.get<OCSearchResponse>(
      'https://api.opencorporates.com/v0.4.8/officers/search',
      { params, timeout: TIMEOUT },
    );

    const officers = res.data.results?.officers ?? [];
    if (officers.length === 0) {
      return { success: true, data: null, summary: `No corporate officer records found for "${name}"` };
    }

    return {
      success: true,
      data: officers.slice(0, 5).map(o => ({
        name: o.officer.name,
        position: o.officer.position,
        address: o.officer.address,
        company: o.officer.company.name,
        companyJurisdiction: o.officer.company.jurisdiction_code,
        companyRegisteredAddress: o.officer.company.registered_address_in_full,
        startDate: o.officer.start_date,
        endDate: o.officer.end_date,
      })),
      summary: `${officers.length} officer record(s) found across ${res.data.total_count} total matches`,
    };
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    return { success: false, summary: `OpenCorporates search failed (HTTP ${status ?? 'unknown'}): ${(err as Error).message}` };
  }
}

// ─── Census ACS Median Income by ZIP ─────────────────────
// Free API from Census Bureau. Returns median household income
// by ZIP Code Tabulation Area (ZCTA).
//
// Used for the Bayesian narrowing technique: if we know someone's
// approximate income, we can weight ZIP codes by affordability match.
//
// API: https://api.census.gov/data/2023/acs/acs5
// Variable B19013_001E = Median Household Income
// Key: Free from https://api.census.gov/data/key_signup.html

export async function getCensusIncomeByState(
  stateCode: string,
): Promise<ToolResult> {
  const apiKey = process.env.CENSUS_API_KEY;
  if (!apiKey) {
    return { success: false, summary: 'CENSUS_API_KEY not configured. Get a free key at https://api.census.gov/data/key_signup.html' };
  }

  // State FIPS codes (common ones)
  const fipsMap: Record<string, string> = {
    AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09',
    DE: '10', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18',
    IA: '19', KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25',
    MI: '26', MN: '27', MS: '28', MO: '29', MT: '30', NE: '31', NV: '32',
    NH: '33', NJ: '34', NM: '35', NY: '36', NC: '37', ND: '38', OH: '39',
    OK: '40', OR: '41', PA: '42', RI: '44', SC: '45', SD: '46', TN: '47',
    TX: '48', UT: '49', VT: '50', VA: '51', WA: '53', WV: '54', WI: '55',
    WY: '56', DC: '11',
  };

  const fips = fipsMap[stateCode.toUpperCase()];
  if (!fips) {
    return { success: false, summary: `Unknown state code: ${stateCode}` };
  }

  try {
    const res = await axios.get<string[][]>(
      `https://api.census.gov/data/2023/acs/acs5`,
      {
        params: {
          get: 'B19013_001E,NAME',
          for: 'zip code tabulation area:*',
          in: `state:${fips}`,
          key: apiKey,
        },
        timeout: TIMEOUT,
      },
    );

    // Response is array of arrays: [["B19013_001E","NAME","state","zip code tabulation area"], ["75000","ZCTA5 37201","47","37201"], ...]
    const rows = res.data.slice(1); // skip header
    const incomeData: CensusIncomeData[] = rows.map(row => ({
      medianIncome: row[0] ? parseInt(row[0], 10) : null,
      name: row[1],
      zipCode: row[3],
    })).filter(d => d.medianIncome !== null && d.medianIncome > 0);

    return {
      success: true,
      data: incomeData,
      summary: `${incomeData.length} ZIP codes with income data in ${stateCode}`,
    };
  } catch (err) {
    return { success: false, summary: `Census API failed: ${(err as Error).message}` };
  }
}

// ─── Income-Filtered ZIP Search ──────────────────────────
// Given a target income and state, find ZIPs where median income
// is within a range (e.g., 60%-150% of target income).
// This narrows the geographic search space significantly.

export async function findAffordableZips(
  stateCode: string,
  estimatedIncome: number,
  tolerancePct: number = 0.4,
): Promise<ToolResult> {
  const result = await getCensusIncomeByState(stateCode);
  if (!result.success || !result.data) return result;

  const allZips = result.data as CensusIncomeData[];
  const minIncome = estimatedIncome * (1 - tolerancePct);
  const maxIncome = estimatedIncome * (1 + tolerancePct);

  const matching = allZips
    .filter(z => z.medianIncome !== null && z.medianIncome >= minIncome && z.medianIncome <= maxIncome)
    .sort((a, b) => {
      const diffA = Math.abs((a.medianIncome ?? 0) - estimatedIncome);
      const diffB = Math.abs((b.medianIncome ?? 0) - estimatedIncome);
      return diffA - diffB;
    });

  return {
    success: true,
    data: {
      matchingZips: matching.slice(0, 20).map(z => ({
        zip: z.zipCode,
        medianIncome: z.medianIncome,
        incomeGap: Math.abs((z.medianIncome ?? 0) - estimatedIncome),
      })),
      totalMatching: matching.length,
      totalZips: allZips.length,
      incomeRange: { min: Math.round(minIncome), max: Math.round(maxIncome) },
    },
    summary: `${matching.length}/${allZips.length} ZIP codes match income range $${Math.round(minIncome).toLocaleString()}-$${Math.round(maxIncome).toLocaleString()}`,
  };
}

// ─── Commute Probability Score ───────────────────────────
// Given a workplace and candidate home address with known distance,
// compute a probability score based on commute distribution.
//
// Based on Census ACS commute data:
// - Median US commute: ~28 minutes / ~16 miles
// - 75th percentile: ~40 minutes / ~25 miles
// - 95th percentile: ~60 minutes / ~50 miles
// Uses log-normal distribution (most commutes are short, long tail)

export function computeCommuteProbability(distanceMiles: number): number {
  // Log-normal parameters fit to US commute data
  // mu = ln(16) ≈ 2.77 (median ~16 miles)
  // sigma = 0.8 (spread)
  const mu = 2.77;
  const sigma = 0.8;

  if (distanceMiles <= 0) return 0.95; // Same location = very likely
  if (distanceMiles > 200) return 0.01; // >200 miles = very unlikely

  const lnDist = Math.log(distanceMiles);
  const z = (lnDist - mu) / sigma;
  // Probability density (higher = more likely commute distance)
  const pdf = Math.exp(-0.5 * z * z) / (distanceMiles * sigma * Math.sqrt(2 * Math.PI));
  // Normalize to 0-1 range (peak at ~16 miles ≈ 0.03)
  const normalized = Math.min(1, pdf / 0.032);
  return Math.round(normalized * 100) / 100;
}
