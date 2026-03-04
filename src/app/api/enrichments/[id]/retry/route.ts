import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

// POST /api/enrichments/[id]/retry
// Resets a failed enrichment's retryCount to 0 and status to pending.
// Returns the enrichmentId so the caller can dispatch POST /api/enrichments/[id]/run.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  const teamUserIds = await getTeamUserIds(user);

  const enrichment = await prisma.companyEnrichment.findFirst({
    where: { id, contact: { userId: { in: teamUserIds } } },
    select: { id: true, enrichmentStatus: true, enrichmentBatchId: true },
  });

  if (!enrichment) {
    return NextResponse.json({ error: "Enrichment not found" }, { status: 404 });
  }

  if (enrichment.enrichmentStatus !== "failed" && enrichment.enrichmentStatus !== "cancelled") {
    return NextResponse.json({ error: "Only failed or cancelled enrichments can be retried" }, { status: 400 });
  }

  await prisma.companyEnrichment.update({
    where: { id },
    data: { retryCount: 0, enrichmentStatus: "pending", errorMessage: null, currentStep: null },
  });

  // Ensure parent batch is in "running" state
  if (enrichment.enrichmentBatchId) {
    await prisma.enrichmentBatch.update({
      where: { id: enrichment.enrichmentBatchId },
      data: { status: "running" },
    });
  }

  return NextResponse.json({ retrying: true, enrichmentId: id });
}
