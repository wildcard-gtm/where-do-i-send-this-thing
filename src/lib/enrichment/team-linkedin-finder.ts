/**
 * Post-enrichment: find LinkedIn URLs for team members using Exa AI people search.
 * Runs fire-and-forget after enrichment completes — updates the enrichment record in DB.
 */

import axios from 'axios';
import { prisma } from '@/lib/db';
import { appLog } from '@/lib/app-log';

interface TeamPhoto {
  name?: string;
  photoUrl: string;
  title?: string;
  linkedinUrl?: string;
}

async function searchLinkedIn(personName: string, companyName: string): Promise<string | null> {
  const apiKey = process.env.EXA_AI_KEY;
  if (!apiKey) return null;

  try {
    const res = await axios.post(
      'https://api.exa.ai/search',
      {
        query: `${personName} ${companyName}`,
        category: 'people',
        includeDomains: ['linkedin.com'],
        numResults: 3,
      },
      {
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        timeout: 15000,
      },
    );

    const results = (res.data?.results ?? []) as Array<{ url?: string }>;
    const profile = results.find(r => r.url?.includes('linkedin.com/in/'));
    return profile?.url ?? null;
  } catch {
    return null;
  }
}

/**
 * Find LinkedIn URLs for team members missing them.
 * Updates the enrichment record in-place.
 * Designed to be called fire-and-forget after enrichment completes.
 */
export async function findTeamLinkedInUrls(
  enrichmentId: string,
  teamPhotos: TeamPhoto[],
  companyName: string,
): Promise<void> {
  const missing = teamPhotos
    .map((tp, i) => ({ tp, index: i }))
    .filter(({ tp }) => tp.name && !tp.linkedinUrl);

  if (missing.length === 0) return;

  let updated = false;
  const updatedPhotos = [...teamPhotos];

  for (const { tp, index } of missing) {
    const url = await searchLinkedIn(tp.name!, companyName);
    if (url) {
      updatedPhotos[index] = { ...updatedPhotos[index], linkedinUrl: url };
      updated = true;
    }
    // Rate limit
    await new Promise(r => setTimeout(r, 300));
  }

  if (updated) {
    await prisma.companyEnrichment.update({
      where: { id: enrichmentId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { teamPhotos: updatedPhotos as any },
    });
    const foundCount = updatedPhotos.filter((tp, i) =>
      tp.linkedinUrl && !teamPhotos[i].linkedinUrl
    ).length;
    appLog('info', 'exa_ai', 'team_linkedin_finder',
      `Found ${foundCount}/${missing.length} LinkedIn URLs for team members`,
      { enrichmentId, found: foundCount, total: missing.length }
    ).catch(() => {});
  }
}
