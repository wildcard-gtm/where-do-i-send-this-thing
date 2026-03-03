import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

// GET /api/enrichment-batches/[id]
// Returns a single enrichment batch with all its enrichment records and contact names
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const teamUserIds = await getTeamUserIds(user);

  const batch = await prisma.enrichmentBatch.findFirst({
    where: { id, userId: { in: teamUserIds } },
    include: {
      enrichments: {
        orderBy: { createdAt: "asc" },
        include: {
          contact: {
            select: { id: true, name: true, linkedinUrl: true },
          },
        },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "Enrichment batch not found" }, { status: 404 });
  }

  // Auto-recover stale "enriching" items (stuck > 10 min)
  const STALE_THRESHOLD = new Date(Date.now() - 10 * 60 * 1000);
  const staleReset = await prisma.companyEnrichment.updateMany({
    where: {
      enrichmentBatchId: id,
      enrichmentStatus: "enriching",
      updatedAt: { lt: STALE_THRESHOLD },
    },
    data: { enrichmentStatus: "failed", errorMessage: "Timed out — enrichment took too long", currentStep: null },
  });
  if (staleReset.count > 0) {
    // Re-fetch with updated statuses
    const updated = await prisma.enrichmentBatch.findFirst({
      where: { id, userId: { in: teamUserIds } },
      include: {
        enrichments: {
          orderBy: { createdAt: "asc" },
          include: {
            contact: {
              select: { id: true, name: true, linkedinUrl: true },
            },
          },
        },
      },
    });
    return NextResponse.json({ batch: updated });
  }

  return NextResponse.json({ batch });
}
