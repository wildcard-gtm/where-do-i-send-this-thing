import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import { fetchBrightDataLinkedIn } from "@/agent/services";
import { isPlaceholderUrl } from "@/lib/photo-finder/detect-placeholder";

interface TeamPhoto {
  name?: string;
  photoUrl: string;
  title?: string;
  linkedinUrl?: string;
}

// POST /api/enrichments/[id]/team-member/refresh-photo
// Fetch a fresh LinkedIn headshot for a team member by index.
// Body: { index: number }
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const teamUserIds = await getTeamUserIds(user);

  const enrichment = await prisma.companyEnrichment.findFirst({
    where: { id, contact: { userId: { in: teamUserIds } } },
    select: { id: true, teamPhotos: true, companyName: true },
  });

  if (!enrichment)
    return NextResponse.json({ error: "Enrichment not found" }, { status: 404 });

  const body = await request.json();
  const index = body.index;
  const photos = (enrichment.teamPhotos as TeamPhoto[] | null) ?? [];

  if (typeof index !== "number" || index < 0 || index >= photos.length) {
    return NextResponse.json({ error: "Invalid index" }, { status: 400 });
  }

  const member = photos[index];
  if (!member.linkedinUrl) {
    return NextResponse.json(
      { error: "No LinkedIn URL for this team member", photoUrl: null },
      { status: 200 }
    );
  }

  let photoUrl: string | null = null;

  // Scrape LinkedIn profile for avatar via Bright Data
  try {
    const profile = await fetchBrightDataLinkedIn(member.linkedinUrl);
    const avatar = profile
      ? ((profile as Record<string, unknown>).avatar as string | undefined)
      : undefined;
    if (avatar && !isPlaceholderUrl(avatar)) photoUrl = avatar;
  } catch {
    // failed
  }

  if (!photoUrl) {
    return NextResponse.json(
      { error: "Could not find a profile photo", photoUrl: null },
      { status: 200 }
    );
  }

  // Update the team member's photo
  photos[index] = { ...member, photoUrl };

  await prisma.companyEnrichment.update({
    where: { id },
    data: {
      teamPhotos:
        photos as unknown as import("@prisma/client").Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ photoUrl, teamPhotos: photos });
}
