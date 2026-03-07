import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

// GET - all postcards for current user
// Query params:
//   status - filter by status (ready, approved, etc.)
//   contactId - filter by contact
//   campaignId - filter by campaign
//   latestOnly - "true" to return only the most recent postcard per contact
//   includeAll - "true" to include failed/pending/generating (excluded by default)
export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const contactId = searchParams.get("contactId");
  const campaignId = searchParams.get("campaignId");
  const latestOnly = searchParams.get("latestOnly") === "true";
  const includeAll = searchParams.get("includeAll") === "true";

  const teamUserIds = await getTeamUserIds(user);

  const where: Record<string, unknown> = {
    contact: { userId: { in: teamUserIds } },
  };

  if (status) {
    where.status = status;
  } else if (!includeAll) {
    // By default, exclude failed/pending/generating/cancelled
    where.status = { in: ["ready", "approved", "reviewed"] };
  }

  if (contactId) where.contactId = contactId;
  if (campaignId) where.postcardBatch = { scanBatchId: campaignId };

  let postcards = await prisma.postcard.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      contact: { select: { id: true, name: true, company: true, linkedinUrl: true, profileImageUrl: true } },
    },
  });

  // Deduplicate: keep only the most recent non-cancelled/non-failed postcard per contact.
  // Cancelled/failed postcards should never shadow a good (reviewed/approved/ready) one.
  if (latestOnly) {
    const seen = new Set<string>();
    postcards = postcards.filter((p) => {
      if (seen.has(p.contactId)) return false;
      // Skip cancelled/failed so an older reviewed/ready postcard can be "latest"
      if (p.status === "cancelled" || p.status === "failed") return false;
      seen.add(p.contactId);
      return true;
    });
  }

  return NextResponse.json({ postcards });
}
