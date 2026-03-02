import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

// GET - all postcards for current user
export async function GET(request: Request) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const contactId = searchParams.get("contactId");
  const campaignId = searchParams.get("campaignId");

  const teamUserIds = await getTeamUserIds(user);

  const where: Record<string, unknown> = {
    contact: { userId: { in: teamUserIds } },
  };
  if (status) where.status = status;
  if (contactId) where.contactId = contactId;
  if (campaignId) where.postcardBatch = { scanBatchId: campaignId };

  const postcards = await prisma.postcard.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      contact: { select: { id: true, name: true, company: true } },
    },
  });

  return NextResponse.json({ postcards });
}
