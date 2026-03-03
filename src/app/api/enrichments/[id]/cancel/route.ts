import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

// POST /api/enrichments/[id]/cancel
// Cancels a single enrichment and reconciles its parent batch.
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

  // Only cancel if actively running or pending
  if (enrichment.enrichmentStatus !== "enriching" && enrichment.enrichmentStatus !== "pending") {
    return NextResponse.json({ error: "Enrichment is not in a cancellable state" }, { status: 409 });
  }

  await prisma.companyEnrichment.update({
    where: { id },
    data: { enrichmentStatus: "cancelled", currentStep: null },
  });

  // Reconcile parent batch
  if (enrichment.enrichmentBatchId) {
    const remaining = await prisma.companyEnrichment.count({
      where: { enrichmentBatchId: enrichment.enrichmentBatchId, enrichmentStatus: { in: ["pending", "enriching"] } },
    });
    if (remaining === 0) {
      const failedCount = await prisma.companyEnrichment.count({
        where: { enrichmentBatchId: enrichment.enrichmentBatchId, enrichmentStatus: "failed" },
      });
      const cancelledCount = await prisma.companyEnrichment.count({
        where: { enrichmentBatchId: enrichment.enrichmentBatchId, enrichmentStatus: "cancelled" },
      });
      const status = failedCount > 0 ? "failed" : cancelledCount > 0 ? "cancelled" : "complete";
      await prisma.enrichmentBatch.update({
        where: { id: enrichment.enrichmentBatchId },
        data: { status },
      });
    }
  }

  return NextResponse.json({ success: true });
}
