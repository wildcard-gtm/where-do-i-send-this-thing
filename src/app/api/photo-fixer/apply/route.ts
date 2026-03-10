import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";
import axios from "axios";

const VETRIC_BASE = "https://api.vetric.io/linkedin/v1";

function extractSlug(url: string | null): string | null {
  if (!url) return null;
  if (url.includes("linkedin.com/in/"))
    return url
      .replace(/^.*linkedin\.com\/in\//, "")
      .replace(/[/?#].*$/, "")
      .trim();
  return url.trim();
}

interface ApplyItem {
  contactId: string;
  type: "contact" | "team";
  enrichmentId?: string;
  teamMemberIndex?: number;
  teamMemberName?: string;
}

interface TeamMember {
  name?: string;
  photoUrl?: string;
  title?: string;
  linkedinUrl?: string;
}

// POST /api/photo-fixer/apply
// Body: { items: ApplyItem[] }
// For backwards compat, also accepts { contactIds: string[] } (treats all as contact type)
export async function POST(request: Request) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await request.json();

  // Support both old format (contactIds) and new format (items)
  let items: ApplyItem[];
  if (body.items && Array.isArray(body.items)) {
    items = body.items;
  } else if (body.contactIds && Array.isArray(body.contactIds)) {
    items = body.contactIds.map((id: string) => ({
      contactId: id,
      type: "contact" as const,
    }));
  } else {
    return NextResponse.json(
      { error: "items or contactIds required" },
      { status: 400 }
    );
  }

  const teamUserIds = await getTeamUserIds(user);

  const vetricHeaders = {
    "x-api-key": process.env.LI_API_KEY || "",
    accept: "application/json",
  };

  const results: {
    contactId: string;
    name: string;
    type: "contact" | "team";
    teamMemberName?: string;
    teamMemberIndex?: number;
    success: boolean;
    newPhotoUrl?: string;
    error?: string;
  }[] = [];

  // Process contact-type items
  const contactItems = items.filter((i) => i.type === "contact");
  if (contactItems.length > 0) {
    const contactIds = contactItems.map((i) => i.contactId);
    const contacts = await prisma.contact.findMany({
      where: { id: { in: contactIds }, userId: { in: teamUserIds } },
      select: { id: true, name: true, linkedinUrl: true },
    });

    for (const c of contacts) {
      const slug = extractSlug(c.linkedinUrl);
      if (!slug) {
        results.push({
          contactId: c.id,
          name: c.name || "Unknown",
          type: "contact",
          success: false,
          error: "No LinkedIn slug",
        });
        continue;
      }

      try {
        const r = await axios.get(`${VETRIC_BASE}/profile/${slug}`, {
          headers: vetricHeaders,
          timeout: 15000,
        });
        const d = r.data;
        if (!d || d.message === "Entity Not Found" || !d.profile_picture) {
          results.push({
            contactId: c.id,
            name: c.name || "Unknown",
            type: "contact",
            success: false,
            error: "No Vetric photo",
          });
          continue;
        }

        await prisma.contact.update({
          where: { id: c.id },
          data: { profileImageUrl: d.profile_picture },
        });

        results.push({
          contactId: c.id,
          name: c.name || "Unknown",
          type: "contact",
          success: true,
          newPhotoUrl: d.profile_picture,
        });
      } catch (err) {
        results.push({
          contactId: c.id,
          name: c.name || "Unknown",
          type: "contact",
          success: false,
          error: (err as Error).message,
        });
      }
    }
  }

  // Process team-type items — update teamPhotos JSON in CompanyEnrichment
  const teamItems = items.filter((i) => i.type === "team");
  // Group by enrichmentId for efficient updates
  const byEnrichment = new Map<string, ApplyItem[]>();
  for (const item of teamItems) {
    if (!item.enrichmentId) continue;
    const existing = byEnrichment.get(item.enrichmentId) || [];
    existing.push(item);
    byEnrichment.set(item.enrichmentId, existing);
  }

  for (const [enrichmentId, enrichItems] of byEnrichment) {
    const enrichment = await prisma.companyEnrichment.findUnique({
      where: { id: enrichmentId },
      select: { id: true, teamPhotos: true, contactId: true },
    });
    if (!enrichment || !enrichment.teamPhotos) continue;

    const members = enrichment.teamPhotos as TeamMember[];
    if (!Array.isArray(members)) continue;

    let updated = false;
    for (const item of enrichItems) {
      const idx = item.teamMemberIndex;
      if (idx === undefined || idx < 0 || idx >= members.length) {
        results.push({
          contactId: item.contactId,
          name: item.teamMemberName || "Unknown",
          type: "team",
          teamMemberName: item.teamMemberName,
          teamMemberIndex: idx,
          success: false,
          error: "Invalid team member index",
        });
        continue;
      }

      const member = members[idx];
      const slug = extractSlug(member.linkedinUrl || null);
      if (!slug) {
        results.push({
          contactId: item.contactId,
          name: member.name || "Unknown",
          type: "team",
          teamMemberName: member.name,
          teamMemberIndex: idx,
          success: false,
          error: "No LinkedIn slug for team member",
        });
        continue;
      }

      try {
        const r = await axios.get(`${VETRIC_BASE}/profile/${slug}`, {
          headers: vetricHeaders,
          timeout: 15000,
        });
        const d = r.data;
        if (!d || d.message === "Entity Not Found" || !d.profile_picture) {
          results.push({
            contactId: item.contactId,
            name: member.name || "Unknown",
            type: "team",
            teamMemberName: member.name,
            teamMemberIndex: idx,
            success: false,
            error: "No Vetric photo for team member",
          });
          continue;
        }

        members[idx] = { ...member, photoUrl: d.profile_picture };
        updated = true;

        results.push({
          contactId: item.contactId,
          name: member.name || "Unknown",
          type: "team",
          teamMemberName: member.name,
          teamMemberIndex: idx,
          success: true,
          newPhotoUrl: d.profile_picture,
        });
      } catch (err) {
        results.push({
          contactId: item.contactId,
          name: member.name || "Unknown",
          type: "team",
          teamMemberName: member.name,
          teamMemberIndex: idx,
          success: false,
          error: (err as Error).message,
        });
      }
    }

    if (updated) {
      await prisma.companyEnrichment.update({
        where: { id: enrichmentId },
        data: { teamPhotos: members },
      });
    }
  }

  return NextResponse.json({
    applied: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  });
}
