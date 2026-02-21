import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runWithRetry, MAX_ATTEMPTS } from "@/app/api/contacts/enrich-bulk/route";

const CONCURRENCY = 3;

// POST /api/enrichment-batches/[id]/retry
// Re-queues all failed enrichments in a batch that haven't hit MAX_ATTEMPTS yet.
// Also resets the retryCount to 0 for records the user manually retries (full fresh start).
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
        where: { enrichmentStatus: "failed" },
        include: {
          contact: {
            select: { id: true, name: true, company: true, linkedinUrl: true, title: true, officeAddress: true },
          },
        },
      },
    },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  if (batch.enrichments.length === 0) {
    return NextResponse.json({ error: "No failed enrichments to retry" }, { status: 400 });
  }

  // Reset retryCount to 0 so they get a fresh 5 attempts from this retry
  await prisma.companyEnrichment.updateMany({
    where: { id: { in: batch.enrichments.map((e) => e.id) } },
    data: { retryCount: 0, enrichmentStatus: "enriching", currentStep: "Queued for retry", errorMessage: null },
  });

  // Mark batch as running again
  await prisma.enrichmentBatch.update({
    where: { id },
    data: { status: "running" },
  });

  // Fire-and-forget — re-run with full retry loop
  (async () => {
    let idx = 0;
    const jobs = batch.enrichments;

    const runNext = async (): Promise<void> => {
      while (idx < jobs.length) {
        const enrichment = jobs[idx++];
        await runWithRetry({
          enrichmentRecordId: enrichment.id,
          contact: enrichment.contact,
          batchId: id,
        });
      }
    };

    const workers = Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => runNext());
    await Promise.allSettled(workers);
  })();

  return NextResponse.json({
    retrying: batch.enrichments.length,
    maxAttemptsPerContact: MAX_ATTEMPTS,
    message: `Retrying ${batch.enrichments.length} failed enrichment(s)`,
  });
}
