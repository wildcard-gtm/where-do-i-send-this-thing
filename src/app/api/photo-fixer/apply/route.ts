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

// POST /api/photo-fixer/apply
// Body: { contactIds: string[] }
// Fetches the Vetric photo for each contact and updates profileImageUrl
export async function POST(request: Request) {
  const user = await getSession();
  if (!user)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { contactIds } = await request.json();
  if (!Array.isArray(contactIds) || contactIds.length === 0)
    return NextResponse.json(
      { error: "contactIds required" },
      { status: 400 }
    );

  const teamUserIds = await getTeamUserIds(user);

  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds }, userId: { in: teamUserIds } },
    select: { id: true, name: true, linkedinUrl: true },
  });

  const vetricHeaders = {
    "x-api-key": process.env.LI_API_KEY || "",
    accept: "application/json",
  };

  const results: { contactId: string; name: string; success: boolean; newPhotoUrl?: string; error?: string }[] = [];

  for (const c of contacts) {
    const slug = extractSlug(c.linkedinUrl);
    if (!slug) {
      results.push({ contactId: c.id, name: c.name || "Unknown", success: false, error: "No LinkedIn slug" });
      continue;
    }

    try {
      const r = await axios.get(`${VETRIC_BASE}/profile/${slug}`, {
        headers: vetricHeaders,
        timeout: 15000,
      });
      const d = r.data;
      if (!d || d.message === "Entity Not Found" || !d.profile_picture) {
        results.push({ contactId: c.id, name: c.name || "Unknown", success: false, error: "No Vetric photo" });
        continue;
      }

      await prisma.contact.update({
        where: { id: c.id },
        data: { profileImageUrl: d.profile_picture },
      });

      results.push({
        contactId: c.id,
        name: c.name || "Unknown",
        success: true,
        newPhotoUrl: d.profile_picture,
      });
    } catch (err) {
      results.push({
        contactId: c.id,
        name: c.name || "Unknown",
        success: false,
        error: (err as Error).message,
      });
    }
  }

  return NextResponse.json({
    applied: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
  });
}
