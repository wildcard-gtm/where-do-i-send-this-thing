import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { processJobsInParallel } from "@/app/api/batches/[id]/start/route";

export const maxDuration = 600;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;

  const batch = await prisma.batch.findFirst({
    where: { id, userId: user.id },
    include: { jobs: true },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  if (batch.status === "processing") {
    return NextResponse.json(
      { error: "Batch is already processing" },
      { status: 400 }
    );
  }

  const failedJobs = batch.jobs.filter(
    (j) => j.status === "failed" || j.status === "cancelled"
  );

  if (failedJobs.length === 0) {
    return NextResponse.json(
      { error: "No failed jobs to retry" },
      { status: 400 }
    );
  }

  // Clear events and reset failed/cancelled jobs to pending
  await prisma.agentEvent.deleteMany({
    where: { jobId: { in: failedJobs.map((j) => j.id) } },
  });

  await prisma.job.updateMany({
    where: { id: { in: failedJobs.map((j) => j.id) } },
    data: {
      status: "pending",
      recommendation: null,
      confidence: null,
      result: null,
      personName: null,
    },
  });

  // Mark batch as processing
  await prisma.batch.update({
    where: { id },
    data: { status: "processing" },
  });

  // Fire and forget with concurrency pool
  const jobsToRetry = failedJobs.map((j) => ({
    id: j.id,
    linkedinUrl: j.linkedinUrl,
    status: "pending",
  }));

  processJobsInParallel(batch.id, user.id, jobsToRetry).catch(console.error);

  return NextResponse.json({ status: "retrying", count: failedJobs.length });
}
