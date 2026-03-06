import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isPlaceholderUrl } from "@/lib/photo-finder/detect-placeholder";

// GET /api/photos/missing?key=DEBUG_API_KEY
// Returns contacts and team members with missing/placeholder photos + their LinkedIn URLs
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");
  if (!key || key !== process.env.DEBUG_API_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all contacts with their enrichments
  const contacts = await prisma.contact.findMany({
    select: {
      id: true,
      name: true,
      company: true,
      linkedinUrl: true,
      profileImageUrl: true,
      companyEnrichments: {
        where: { isLatest: true, enrichmentStatus: "completed" },
        select: { id: true, companyName: true, teamPhotos: true },
        take: 1,
      },
    },
  });

  interface MissingPhoto {
    type: "contact" | "team";
    contactId: string;
    enrichmentId?: string;
    teamIndex?: number;
    name: string;
    company: string;
    linkedinUrl: string;
    currentPhotoUrl: string | null;
  }

  const missing: MissingPhoto[] = [];

  for (const c of contacts) {
    // Check prospect photo
    if (c.linkedinUrl && (!c.profileImageUrl || isPlaceholderUrl(c.profileImageUrl))) {
      missing.push({
        type: "contact",
        contactId: c.id,
        name: c.name,
        company: c.company ?? "Unknown",
        linkedinUrl: c.linkedinUrl,
        currentPhotoUrl: c.profileImageUrl,
      });
    }

    // Check team member photos
    const enrichment = c.companyEnrichments[0];
    if (!enrichment) continue;
    const teamPhotos = enrichment.teamPhotos as Array<{
      name?: string;
      photoUrl: string;
      title?: string;
      linkedinUrl?: string;
    }> | null;
    if (!teamPhotos) continue;

    for (let i = 0; i < teamPhotos.length; i++) {
      const tp = teamPhotos[i];
      if (!tp.linkedinUrl) continue;
      if (!tp.photoUrl || isPlaceholderUrl(tp.photoUrl)) {
        missing.push({
          type: "team",
          contactId: c.id,
          enrichmentId: enrichment.id,
          teamIndex: i,
          name: tp.name ?? "Unknown",
          company: enrichment.companyName ?? c.company ?? "Unknown",
          linkedinUrl: tp.linkedinUrl,
          currentPhotoUrl: tp.photoUrl || null,
        });
      }
    }
  }

  return NextResponse.json({ total: missing.length, missing });
}
