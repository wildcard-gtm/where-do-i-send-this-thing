import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> }
) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id, jobId } = await params;

  const batch = await prisma.batch.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  const job = await prisma.job.findFirst({
    where: { id: jobId, batchId: id },
  });

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "failed" && job.status !== "cancelled") {
    return NextResponse.json({ error: "Only failed or cancelled jobs can be retried" }, { status: 400 });
  }

  // Clear old events and reset job
  await prisma.agentEvent.deleteMany({ where: { jobId } });
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: "pending",
      recommendation: null,
      confidence: null,
      result: null,
      personName: null,
    },
  });

  // Also reset batch to processing if it was complete/failed/cancelled
  await prisma.batch.update({
    where: { id },
    data: { status: "processing" },
  });

  // Return jobId for frontend to dispatch via stream endpoint
  return NextResponse.json({ status: "retrying", jobId });
}
