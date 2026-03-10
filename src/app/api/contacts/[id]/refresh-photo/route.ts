import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import { getVetricProfile, fetchBrightDataLinkedIn } from "@/agent/services";
import { isPlaceholderUrl } from "@/lib/photo-finder/detect-placeholder";

// POST /api/contacts/[id]/refresh-photo
// Lightweight photo-only refresh: tries Vetric (800×800) → Bright Data
// Only updates profileImageUrl, never touches other fields.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { id } = await params;
  const teamUserIds = await getTeamUserIds(user);

  const contact = await prisma.contact.findFirst({
    where: { id, userId: { in: teamUserIds } },
    select: { id: true, name: true, linkedinUrl: true, company: true },
  });

  if (!contact)
    return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  let photoUrl: string | null = null;

  // 1. Vetric — returns 800×800 profile photo directly
  try {
    const vetricRes = await getVetricProfile(contact.linkedinUrl);
    if (vetricRes.success && vetricRes.data) {
      const pic = (vetricRes.data as Record<string, unknown>).profile_picture as string | undefined;
      if (pic && !isPlaceholderUrl(pic)) photoUrl = pic;
    }
  } catch {
    // continue to fallback
  }

  // 2. Bright Data — scrape LinkedIn profile for avatar
  if (!photoUrl) {
    try {
      const profile = await fetchBrightDataLinkedIn(contact.linkedinUrl);
      const avatar = profile
        ? ((profile as Record<string, unknown>).avatar as string | undefined)
        : undefined;
      if (avatar && !isPlaceholderUrl(avatar)) photoUrl = avatar;
    } catch {
      // fallback exhausted
    }
  }

  if (!photoUrl) {
    return NextResponse.json(
      { error: "Could not find a profile photo", profileImageUrl: null },
      { status: 200 }
    );
  }

  // Update only profileImageUrl — nothing else
  await prisma.contact.update({
    where: { id },
    data: { profileImageUrl: photoUrl },
  });

  return NextResponse.json({ profileImageUrl: photoUrl });
}
