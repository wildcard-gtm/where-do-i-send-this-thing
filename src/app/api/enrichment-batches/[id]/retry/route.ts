import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// POST /api/enrichment-batches/[id]/retry
// Resets all failed/cancelled enrichments to pending and returns their IDs.
// The browser (enrichment detail page) dispatches individual run calls.
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
    include: {
      enrichments: {
        where: { enrichmentStatus: { in: ["failed", "cancelled"] } },
        select: { id: true },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  if (batch.enrichments.length === 0) {
    return NextResponse.json({ error: "No failed enrichments to retry" }, { status: 400 });
  }

  const ids = batch.enrichments.map((e) => e.id);

  // Reset to pending with fresh retry budget
  await prisma.companyEnrichment.updateMany({
    where: { id: { in: ids } },
    data: { retryCount: 0, enrichmentStatus: "pending", currentStep: null, errorMessage: null },
  });

  await prisma.enrichmentBatch.update({
    where: { id },
    data: { status: "running" },
  });

  return NextResponse.json({ enrichmentIds: ids, retrying: ids.length });
}
