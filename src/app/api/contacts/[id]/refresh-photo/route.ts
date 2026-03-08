import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import {
  fetchBrightDataLinkedIn,
  enrichWithPDL,
  searchExaPerson,
} from "@/agent/services";
import { isPlaceholderUrl } from "@/lib/photo-finder/detect-placeholder";

// POST /api/contacts/[id]/refresh-photo
// Lightweight photo-only refresh: tries Bright Data → PDL → Exa+Bright Data
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

  // 1. Bright Data — scrape LinkedIn profile for avatar
  try {
    const profile = await fetchBrightDataLinkedIn(contact.linkedinUrl);
    const avatar = profile
      ? ((profile as Record<string, unknown>).avatar as string | undefined)
      : undefined;
    if (avatar && !isPlaceholderUrl(avatar)) photoUrl = avatar;
  } catch {
    // continue to next fallback
  }

  // 2. PDL — profile_pic_url
  if (!photoUrl) {
    try {
      const pdlResult = await enrichWithPDL(contact.linkedinUrl);
      if (pdlResult.success && pdlResult.data) {
        const pic = (pdlResult.data as Record<string, unknown>)
          .profile_pic_url as string | undefined;
        if (pic && !isPlaceholderUrl(pic)) photoUrl = pic;
      }
    } catch {
      // continue to next fallback
    }
  }

  // 3. Exa person search → find LinkedIn → scrape with Bright Data
  if (!photoUrl && contact.name && contact.company) {
    try {
      const exaResult = await searchExaPerson(
        contact.name,
        contact.company,
        3
      );
      if (exaResult.success && Array.isArray(exaResult.data)) {
        for (const result of exaResult.data as Array<{
          url?: string;
          name?: string;
        }>) {
          if (!result.url?.includes("linkedin.com/in/")) continue;
          try {
            const profile = await fetchBrightDataLinkedIn(result.url);
            const avatar = profile
              ? ((profile as Record<string, unknown>).avatar as
                  | string
                  | undefined)
              : undefined;
            if (avatar && !isPlaceholderUrl(avatar)) {
              photoUrl = avatar;
              break;
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      // all fallbacks exhausted
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
