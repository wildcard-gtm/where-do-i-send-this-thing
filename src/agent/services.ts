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

const TIMEOUT = 30_000;
const MAX_TEXT_PER_RESULT = 1500; // Truncate Exa text to avoid burning context

// ─── Bright Data LinkedIn Enrichment ─────────────────────

const LINKEDIN_DATASET_ID = 'gd_l1viktl72bvl7bjuj0';

export async function enrichLinkedInProfile(url: string): Promise<ToolResult> {
  const apiKey = process.env.BRIGHT_DATA_API_KEY;
  if (!apiKey) return { success: false, summary: 'BRIGHT_DATA_API_KEY not configured' };

  try {
    const trigger = await axios.post(
      `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${LINKEDIN_DATASET_ID}&include_errors=true`,
      [{ url }],
      {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: TIMEOUT,
      },
    );

    const snapshotId: string | undefined = trigger.data?.snapshot_id;
    if (!snapshotId) {
      return { success: false, summary: 'No snapshot ID returned from Bright Data' };
    }

    // Poll for results (up to ~20 seconds)
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 2000));

      try {
        const res = await axios.get(
          `https://api.brightdata.com/datasets/v3/snapshot/${snapshotId}?format=json`,
          { headers: { Authorization: `Bearer ${apiKey}` }, timeout: TIMEOUT },
        );

        if (Array.isArray(res.data) && res.data.length > 0) {
          const profile = res.data[0] as LinkedInProfile;
          return {
            success: true,
            data: {
              name: profile.name,
              headline: profile.headline,
              company: profile.current_company_name,
              position: profile.current_company_position,
              city: profile.city,
              state: profile.state,
              country: profile.country,
              about: profile.about?.slice(0, 500),
              experience: (profile.experience ?? []).slice(0, 5).map(e => ({
                company: e.company,
                title: e.title,
                location: e.location,
                start_date: e.start_date,
                end_date: e.end_date,
              })),
            },
            summary: `${profile.name ?? 'Unknown'}, ${profile.current_company_name ?? 'N/A'}, ${profile.city ?? 'N/A'}`,
          };
        }
      } catch (err) {
        const status = (err as AxiosError).response?.status;
        // 404 means still processing; anything else is a real error
        if (status !== 404) {
          return { success: false, summary: `Bright Data poll error (HTTP ${status})` };
        }
      }
    }

    return { success: false, summary: 'Timeout waiting for LinkedIn profile data' };
  } catch (err) {
    return { success: false, summary: `LinkedIn enrichment failed: ${(err as Error).message}` };
  }
}

// ─── Endato (Enformion) People Search ────────────────────

export async function searchPersonAddress(
  firstName: string,
  lastName: string,
  middleName?: string,
  city?: string,
  state?: string,
): Promise<ToolResult> {
  const apiName = process.env.ENDATO_API_NAME;
  const apiPassword = process.env.ENDATO_API_PASSWORD;
  if (!apiName || !apiPassword) {
    return { success: false, summary: 'Endato credentials not configured (ENDATO_API_NAME, ENDATO_API_PASSWORD)' };
  }

  try {
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

    const res = await axios.post(
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

    const persons: EndatoPerson[] = res.data?.persons ?? [];
    if (persons.length === 0) {
      return { success: true, data: null, summary: `No address records found for ${firstName} ${lastName}` };
    }

    const person = persons[0];
    const addresses = person.addresses ?? [];
    const phones = person.phoneNumbers ?? [];
    const fullName = person.fullName
      ?? [person.name?.firstName, person.name?.middleName, person.name?.lastName].filter(Boolean).join(' ');

    return {
      success: true,
      data: {
        name: fullName,
        age: person.age,
        isCurrentPropertyOwner: person.isCurrentPropertyOwner,
        currentAddress: addresses[0]?.fullAddress ?? 'Not available',
        addressHistory: addresses.slice(0, 5).map(a => ({
          address: a.fullAddress,
          city: a.city,
          state: a.state,
          zip: a.zip,
          lat: a.latitude,
          lng: a.longitude,
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
        totalResults: res.data?.counts?.searchResults ?? persons.length,
      },
      summary: `${fullName}, age ${person.age ?? '?'}, ${addresses.length} address(es), ${phones.length} phone(s), property owner: ${person.isCurrentPropertyOwner ?? 'unknown'}`,
    };
  } catch (err) {
    const axiosErr = err as AxiosError;
    const status = axiosErr.response?.status;
    const detail = status ? ` (HTTP ${status})` : '';
    return { success: false, summary: `Endato search failed${detail}: ${(err as Error).message}` };
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

    return { success: true, data: res.data, summary: 'Property details retrieved' };
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    if (status === 404) {
      return { success: true, data: null, summary: 'No property data found for this address' };
    }
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
    return { success: false, summary: `Distance calculation failed: ${(err as Error).message}` };
  }
}
