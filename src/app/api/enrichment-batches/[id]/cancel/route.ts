import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// POST /api/enrichment-batches/[id]/cancel
// Marks all pending/enriching enrichments as cancelled and the batch as cancelled.
// The run route checks for cancellation at each tool call and will stop.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const batch = await prisma.enrichmentBatch.findFirst({
    where: { id, userId: user.id },
  });

  if (!batch) {
    return NextResponse.json({ error: "Enrichment batch not found" }, { status: 404 });
  }

  // Mark all still-running enrichments as cancelled
  await prisma.companyEnrichment.updateMany({
    where: {
      enrichmentBatchId: id,
      enrichmentStatus: { in: ["enriching"] },
    },
    data: { enrichmentStatus: "cancelled", currentStep: null },
  });

  await prisma.enrichmentBatch.update({
    where: { id },
    data: { status: "cancelled" },
  });

  return NextResponse.json({ cancelled: true });
}
