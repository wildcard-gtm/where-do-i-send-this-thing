import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTeamUserIds } from "@/lib/team";

// POST /api/campaigns/[id]/process-stuck
// Finds all stuck "pending" items across scan/enrich/postcard stages
// and returns their IDs so the frontend can dispatch them.
// Also resets batch statuses that may have been prematurely finalized.
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

  const batch = await prisma.batch.findFirst({
    where: { id, userId: { in: teamUserIds } },
  });
  if (!batch) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const STALE_THRESHOLD = new Date(Date.now() - 10 * 60 * 1000);

  // ── Reset stale running items back to pending ───────────────────────────
  await prisma.job.updateMany({
    where: { batchId: id, status: "running", updatedAt: { lt: STALE_THRESHOLD } },
    data: { status: "pending" },
  });

  // ── Stuck scan jobs (pending) ─────────────────────────────────────────────
  const pendingJobs = await prisma.job.findMany({
    where: { batchId: id, status: "pending" },
    select: { id: true },
  });

  // Ensure batch is in "processing" if we have pending jobs to dispatch
  if (pendingJobs.length > 0 && batch.status === "pending") {
    await prisma.batch.update({
      where: { id },
      data: { status: "processing" },
    });
  }

  // ── Stuck enrichments (pending + stale enriching) ─────────────────────────
  const enrichmentBatches = await prisma.enrichmentBatch.findMany({
    where: { scanBatchId: id },
    select: { id: true },
  });
  const enrichmentBatchIds = enrichmentBatches.map((eb) => eb.id);

  // Reset stale enriching items back to pending
  if (enrichmentBatchIds.length > 0) {
    await prisma.companyEnrichment.updateMany({
      where: {
        enrichmentBatchId: { in: enrichmentBatchIds },
        enrichmentStatus: "enriching",
        updatedAt: { lt: STALE_THRESHOLD },
      },
      data: { enrichmentStatus: "pending", retryCount: 0, currentStep: null },
    });
  }

  const pendingEnrichments = enrichmentBatchIds.length > 0
    ? await prisma.companyEnrichment.findMany({
        where: {
          enrichmentBatchId: { in: enrichmentBatchIds },
          enrichmentStatus: "pending",
        },
        select: { id: true },
      })
    : [];

  // Reset enrichment batch status to "running" if it has pending items
  if (pendingEnrichments.length > 0) {
    for (const ebId of enrichmentBatchIds) {
      const hasPending = await prisma.companyEnrichment.count({
        where: { enrichmentBatchId: ebId, enrichmentStatus: "pending" },
      });
      if (hasPending > 0) {
        await prisma.enrichmentBatch.update({
          where: { id: ebId },
          data: { status: "running" },
        });
      }
    }
  }

  // ── Stuck postcards (pending + stale generating) ─────────────────────────
  const postcardBatches = await prisma.postcardBatch.findMany({
    where: { scanBatchId: id },
    select: { id: true },
  });
  const postcardBatchIds = postcardBatches.map((pb) => pb.id);

  // Reset stale generating postcards back to pending
  if (postcardBatchIds.length > 0) {
    await prisma.postcard.updateMany({
      where: {
        postcardBatchId: { in: postcardBatchIds },
        status: "generating",
        updatedAt: { lt: STALE_THRESHOLD },
      },
      data: { status: "pending", retryCount: 0 },
    });
  }

  const pendingPostcards = postcardBatchIds.length > 0
    ? await prisma.postcard.findMany({
        where: {
          postcardBatchId: { in: postcardBatchIds },
          status: "pending",
        },
        select: { id: true },
      })
    : [];

  // Reset postcard batch status to "running" if it has pending items
  if (pendingPostcards.length > 0) {
    for (const pbId of postcardBatchIds) {
      const hasPending = await prisma.postcard.count({
        where: { postcardBatchId: pbId, status: "pending" },
      });
      if (hasPending > 0) {
        await prisma.postcardBatch.update({
          where: { id: pbId },
          data: { status: "running" },
        });
      }
    }
  }

  return NextResponse.json({
    jobIds: pendingJobs.map((j) => j.id),
    enrichmentIds: pendingEnrichments.map((e) => e.id),
    postcardIds: pendingPostcards.map((p) => p.id),
    total: pendingJobs.length + pendingEnrichments.length + pendingPostcards.length,
  });
}
