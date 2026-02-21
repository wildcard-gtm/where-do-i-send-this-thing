import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// GET /api/enrichment-batches
// Returns all enrichment batches for the current user with per-batch counts
export async function GET() {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const batches = await prisma.enrichmentBatch.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: {
      enrichments: {
        select: { enrichmentStatus: true },
      },
    },
  });

  const result = batches.map((batch) => ({
    id: batch.id,
    name: batch.name,
    status: batch.status,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    total: batch.enrichments.length,
    completed: batch.enrichments.filter((e) => e.enrichmentStatus === "completed").length,
    failed: batch.enrichments.filter((e) => e.enrichmentStatus === "failed").length,
    running: batch.enrichments.filter((e) => e.enrichmentStatus === "enriching").length,
  }));

  return NextResponse.json({ batches: result });
}
