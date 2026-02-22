import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/campaigns
// Returns scan batches with their linked enrichment + postcard batch summaries
export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const batches = await prisma.batch.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      jobs: { select: { status: true } },
      enrichmentBatches: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { enrichments: { select: { enrichmentStatus: true } } },
      },
      postcardBatches: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { postcards: { select: { status: true } } },
      },
    },
  });

  const result = batches.map((batch) => {
    const totalJobs = batch.jobs.length;
    const completedJobs = batch.jobs.filter((j) => j.status === "complete").length;
    const failedJobs = batch.jobs.filter((j) => j.status === "failed").length;

    const eb = batch.enrichmentBatches[0] ?? null;
    const enrichTotal = eb ? eb.enrichments.length : 0;
    const enrichCompleted = eb ? eb.enrichments.filter((e) => e.enrichmentStatus === "completed").length : 0;
    const enrichFailed = eb ? eb.enrichments.filter((e) => e.enrichmentStatus === "failed").length : 0;
    const enrichRunning = eb ? eb.enrichments.filter((e) => e.enrichmentStatus === "enriching").length : 0;

    const pb = batch.postcardBatches[0] ?? null;
    const postcardTotal = pb ? pb.postcards.length : 0;
    const postcardReady = pb ? pb.postcards.filter((p) => p.status === "ready" || p.status === "approved").length : 0;
    const postcardFailed = pb ? pb.postcards.filter((p) => p.status === "failed").length : 0;
    const postcardRunning = pb ? pb.postcards.filter((p) => p.status === "pending" || p.status === "generating").length : 0;

    return {
      id: batch.id,
      name: batch.name,
      status: batch.status,
      createdAt: batch.createdAt,
      totalJobs,
      completedJobs,
      failedJobs,
      enrichBatchId: eb ? eb.id : null,
      enrichStatus: eb ? eb.status : null,
      enrichTotal,
      enrichCompleted,
      enrichFailed,
      enrichRunning,
      postcardBatchId: pb ? pb.id : null,
      postcardStatus: pb ? pb.status : null,
      postcardTotal,
      postcardReady,
      postcardFailed,
      postcardRunning,
    };
  });

  return NextResponse.json({ campaigns: result });
}
